import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createCanvas } from '@napi-rs/canvas';
import { Painter, validatePainting } from '../dist/index.js';
import { createScene, sceneNames } from '../examples/scenes.mjs';
import { checkSiteBudget, parseScore, SITE_LIMITS, validSeed } from './budget.mjs';
import { LANDSCAPES, generativeNames, createGenerativeLandscape, isGenerativeName } from './landscapes.mjs';

test('all five actual gallery compositions satisfy schema and smaller site budgets', () => {
  assert.deepEqual(sceneNames, ['landscape', 'ink', 'watercolor', 'oil', 'studies']);
  for (const name of sceneNames) {
    const score = createScene(name, 480, 320);
    const validation = validatePainting(score);
    assert.equal(validation.valid, true, name + ': ' + JSON.stringify(validation.errors));
    const errors = checkSiteBudget(score, validation.workload, JSON.stringify(score).length);
    assert.deepEqual(errors, [], name + ': ' + JSON.stringify(errors));
  }
});
test('bad JSON and oversized-but-schema-valid documents get actionable errors', () => {
  const invalid = parseScore('{broken');
  assert.equal(invalid.ok, false);
  assert.equal(invalid.errors[0].path, '/');
  assert.equal(invalid.errors[0].code, 'json-syntax');
  const score = createScene('ink', 1024, 800);
  const result = validatePainting(score);
  assert.equal(result.valid, true, 'library accepts dimensions outside smaller site budget');
  const issues = checkSiteBudget(score, result.workload, 100);
  assert.ok(issues.some(issue => issue.path === '/width' && issue.code === 'site-width'));
  assert.equal(validSeed(0), true);
  assert.equal(validSeed(4294967295), true);
  for (const bad of [-1, 4294967296, 1.5, NaN, Infinity]) assert.equal(validSeed(bad), false);
  assert.equal(SITE_LIMITS.pixels, 640_000);
});
test('real Canvas2D has repeatable pixels and invalid renders preserve committed output', { timeout: 120000 }, async () => {
  const canvas = createCanvas(320, 213);
  const painter = new Painter(canvas, { canvasFactory: createCanvas, historyLimit: 2 });
  const score = createScene('ink', 320, 213);
  const digest = () => createHash('sha256').update(canvas.toBuffer('image/png')).digest('hex');
  try {
    await painter.render(score);
    const first = digest();
    assert.ok(canvas.toBuffer('image/png').length > 500, 'produced a real PNG');
    await painter.render(structuredClone(score));
    assert.equal(digest(), first, 'same score and backend produce identical output');
    const invalid = structuredClone(score);
    invalid.layers[0].commands.push({ id: 'bad-ref', op: 'stroke', material: 'missing', path: [[0.1, 0.1], [0.7, 0.7]] });
    await assert.rejects(() => painter.render(invalid), /missing|not defined/i);
    assert.equal(digest(), first, 'failed batch cannot overwrite committed image');
    const cancelled = new AbortController();
    cancelled.abort();
    await assert.rejects(() => painter.render(score, { signal: cancelled.signal }), /cancelled/i);
    assert.equal(digest(), first, 'cancelled render cannot overwrite committed image');
    assert.equal(painter.document.seed, score.seed, 'committed score retained');
  } finally { painter.dispose(); }
});


test('six generative landscape grammars stay schema-valid and inside site resource budgets', () => {
  assert.equal(LANDSCAPES.length, 6);
  assert.equal(new Set(generativeNames).size, LANDSCAPES.length);
  for (const preset of LANDSCAPES) {
    const name = 'gen-' + preset.id;
    assert.equal(isGenerativeName(name), true);
    for (const seed of [preset.seed, 0, 4294967295]) {
      for (const [width, height] of [[320,213], [480,320]]) {
        const score = createGenerativeLandscape(name, width, height, seed);
        const validation = validatePainting(score);
        assert.equal(validation.valid, true, name+'@'+seed+':'+width+':'+JSON.stringify(validation.errors));
        assert.deepEqual(checkSiteBudget(score, validation.workload, JSON.stringify(score,null,2).length), [], name+'@'+seed+' site budget');
        assert.equal(score.seed, seed);
        assert.equal(score.layers.length, 4);
        assert.deepEqual(score, createGenerativeLandscape(name,width,height,seed), 'repeatable score');
        assert.ok(score.layers[3].commands.some(command => command.op === 'stroke' && command.path.some(p => p.length === 3)), 'handwork uses pressure-sensitive strokes');
      }
    }
  }
  assert.equal(isGenerativeName('unknown'), false);
  assert.throws(() => createGenerativeLandscape('gen-unknown'), /Unknown/);
  assert.throws(() => createGenerativeLandscape('gen-estuary', 480, 320, -1), /Seed/);
});

test('seed changes authored geometry, not merely pigment noise', () => {
  for (const preset of LANDSCAPES) {
    const first = createGenerativeLandscape('gen-'+preset.id, 320, 213, preset.seed);
    const next = createGenerativeLandscape('gen-'+preset.id, 320, 213, preset.seed+1);
    assert.notDeepEqual(first.layers, next.layers, preset.id+' should change marks, path or horizon');
    assert.deepEqual(first.layers, createGenerativeLandscape('gen-'+preset.id,320,213,preset.seed).layers);
  }
});

test('real native Canvas2D renders generative landscapes with stable and distinct seeded pixels', { timeout: 120000 }, async () => {
  const canvas = createCanvas(240,160);
  const painter = new Painter(canvas,{canvasFactory:createCanvas,historyLimit:0});
  const hash = () => createHash('sha256').update(canvas.toBuffer('image/png')).digest('hex');
  const base = createGenerativeLandscape('gen-estuary',240,160,1829);
  try {
    await painter.render(base); const first = hash();
    await painter.render(createGenerativeLandscape('gen-estuary',240,160,1829));
    assert.equal(hash(),first,'same generated score has identical native PNG bytes');
    await painter.render(createGenerativeLandscape('gen-estuary',240,160,1830));
    assert.notEqual(hash(),first,'next seed paints different pixels');
  } finally { painter.dispose(); }
});
