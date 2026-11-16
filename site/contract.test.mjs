import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createCanvas } from '@napi-rs/canvas';
import { Painter, validatePainting } from '../dist/index.js';
import { createScene, sceneNames } from '../examples/scenes.mjs';
import { checkSiteBudget, parseScore, SITE_LIMITS, validSeed } from './budget.mjs';

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
