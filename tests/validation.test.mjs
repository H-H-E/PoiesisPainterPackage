import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePainting, assertPainting, PaintingValidationError, estimateWorkload, WORKLOAD_LIMITS } from '../dist/validate.js';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createCanvas } from '@napi-rs/canvas';
import { Painter } from '../dist/painter.js';
import generatedValidator from '../dist/validator.generated.js';
import Ajv from 'ajv';


const document = () => ({ version: '1.0', width: 800, height: 600, seed: 19, background: '#eff0e7', materials: { ink: { medium: 'ink', color: '#102030', size: 0.01 } }, layers: [{ id: 'foreground', commands: [{ id: 'reed', op: 'stroke', material: 'ink', path: [[0.1, 0.8, 1], [0.2, 0.3, 0.1]] }] }] });

test('valid compact document is accepted without mutation', () => {
  const painting = document();
  const before = JSON.stringify(painting);
  assert.equal(validatePainting(painting).valid, true);
  assert.equal(JSON.stringify(painting), before);
});

test('unknown controls and operations are rejected with paths', () => {
  const painting = document();
  painting.layers[0].commands[0].magic = true;
  const result = validatePainting(painting);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.path.endsWith('/magic')));
  assert.equal(result.errors.length, 1, 'only the actual operation branch should supply repair advice');
  painting.layers[0].commands[0].op = 'eval';
  assert.equal(validatePainting(painting).valid, false);
});

test('nonfinite numbers through the typed API and malformed colors reject', () => {
  for (const invalid of [NaN, Infinity, -Infinity]) {
    const painting = document();
    painting.layers[0].commands[0].path[0][0] = invalid;
    assert.equal(validatePainting(painting).valid, false);
  }
  const painting = document();
  painting.materials.ink.color = 'red;fetch("https://example.invalid")';
  assert.equal(validatePainting(painting).valid, false);
});

test('global IDs, reserved names and references are checked semantically', () => {
  const painting = document();
  painting.layers[0].commands.push({ ...painting.layers[0].commands[0] });
  assert.ok(validatePainting(painting).errors.some(error => error.code === 'duplicate-id'));
  painting.layers[0].commands[1].id = 'constructor';
  assert.ok(validatePainting(painting).errors.some(error => error.code === 'reserved-id'));
  painting.layers[0].commands[1].id = 'other';
  painting.layers[0].commands[1].material = 'missing';
  assert.ok(validatePainting(painting).errors.some(error => error.code === 'missing-material'));
  const dangerous = JSON.parse(JSON.stringify(document()).replace('"ink":', '"__proto__":'));
  assert.equal(validatePainting(dangerous).valid, false);
});

test('pixel, aggregate layer and family expansion budgets reject before rendering', () => {
  const painting = document();
  painting.width = 8192;
  painting.height = 8192;
  assert.ok(validatePainting(painting).errors.some(error => error.code === 'workload-pixels'));
  const layered = document();
  layered.width = 4096;
  layered.height = 4096;
  layered.layers = Array.from({ length: 4 }, (_, index) => ({ id: `layer${index}`, commands: [] }));
  assert.ok(validatePainting(layered).errors.some(error => error.code === 'workload-layerPixels'));
  const expanded = document();
  expanded.layers[0].commands = [{ id: 'family', op: 'family', material: 'ink', path: Array.from({ length: 1000 }, (_, index) => [index / 1000, 0.5]), count: 2000, spread: [0, 0.2], jitter: 0.01 }];
  assert.ok(validatePainting(expanded).errors.some(error => error.code === 'workload-expandedPoints'));
});

test('hatch intersection work and explicit simulation steps enter workload estimate', () => {
  const painting = document();
  painting.layers[0].commands.push({ id: 'hatch', op: 'hatch', material: 'ink', polygon: [[0, 0], [1, 0], [1, 1], [0, 1]], spacing: 0.1, angle: 45 });
  painting.layers[0].commands.push({ id: 'dry', op: 'wait', steps: 10 });
  const workload = estimateWorkload(painting);
  assert.equal(workload.commands, 3);
  assert.equal(workload.simulationSteps, 10);
  assert.equal(workload.simulationCellSteps, painting.width * painting.height * 10);
  assert.ok(workload.expandedMarks > 1);
  assert.ok(workload.expandedPoints > 4);
});

test('simulation cell-step budget combines resolution and requested evolution', () => {
  const painting = document();
  painting.width = 4096;
  painting.height = 4096;
  painting.layers[0].commands = [{ id: 'dry', op: 'wait', steps: 100 }];
  assert.ok(validatePainting(painting).errors.some(error => error.code === 'workload-simulationCellSteps'));
});

test('ribbon budget rejects costly tessellation even when raw expanded points fit', () => {
  const painting = document();
  painting.width = painting.height = 512;
  painting.materials.ink.bristles = 128;
  painting.materials.ink.size = 0.5;
  painting.layers[0].commands = [{ id: 'adversarial', op: 'family', material: 'ink', path: Array.from({ length: 500 }, (_, i) => i % 2 ? [1, 1] : [0, 0]), count: 2000, spread: [0, 0], jitter: 0 }];
  const result = validatePainting(painting);
  assert.equal(result.workload.expandedPoints, 1_000_000);
  assert.ok(result.errors.some(error => error.code === 'workload-ribbonVertices'));
});

test('raster budget rejects many very broad marks at print dimensions', () => {
  const painting = document();
  painting.width = 4096; painting.height = 4096;
  painting.materials.ink.size = 0.5;
  painting.layers[0].commands = [{ id: 'broad', op: 'family', material: 'ink', path: [[0, 0], [1, 1]], count: 2000, spread: [0, 0], jitter: 0 }];
  assert.ok(validatePainting(painting).errors.some(error => error.code === 'workload-rasterPixels'));
});

test('assertPainting returns a structured repairable error', () => {
  assert.throws(() => assertPainting({ version: '99' }), error => error instanceof PaintingValidationError && error.errors.every(issue => issue.path && issue.suggestion));
});


const root = new URL('../', import.meta.url);
const guide = readFileSync(new URL('../docs/agent-guide.md', import.meta.url), 'utf8');
const scoreBlocks = [...guide.matchAll(/<!-- score-example -->\s*\x60\x60\x60json\s*\n([\s\S]*?)\n\x60\x60\x60/g)];

test('generated validator matches source schema and three complete guide scores parse', () => {
  // --check recomputes both generated TypeScript and standalone Ajv output.
  execFileSync(process.execPath, ['scripts/generate-schema.mjs', '--check'], { cwd: root, stdio: 'pipe' });
  const schema = JSON.parse(readFileSync(new URL('../src/schema.json', import.meta.url), 'utf8'));
  assert.equal(schema.properties.version.const, '1.0');
  const optimized = structuredClone(schema);
  optimized.definitions.Command.discriminator = { propertyName: 'op' };
  const fresh = new Ajv({ allErrors: true, strict: true, strictTuples: false, discriminator: true }).compile(optimized);
  assert.equal(scoreBlocks.length, 3, 'the guide must provide three labeled full scores');
  const scores = [
    document(),
    ...scoreBlocks.map(match => JSON.parse(match[1])),
    JSON.parse(readFileSync(new URL('../examples/agent-challenge.json', import.meta.url), 'utf8')),
    ...['ink', 'landscape', 'watercolor', 'oil', 'studies'].map(name => JSON.parse(readFileSync(new URL(`../examples/${name}.json`, import.meta.url), 'utf8'))),
  ];
  for (const score of scores) {
    assert.equal(Boolean(generatedValidator(score)), Boolean(fresh(score)), 'generated and source schemas disagree');
    assert.equal(validatePainting(score).valid, true, `score rejected: ${JSON.stringify(validatePainting(score).errors)}`);
  }
  const invalid = structuredClone(document());
  invalid.layers[0].commands[0].op = 'eval';
  assert.equal(Boolean(generatedValidator(invalid)), Boolean(fresh(invalid)));
  invalid.layers[0].commands[0].op = 'stroke';
  invalid.layers[0].commands[0].path[0] = [1, 2, -1];
  assert.equal(Boolean(generatedValidator(invalid)), Boolean(fresh(invalid)));
});

test('every guide score renders actual non-background pixels with the supported commands', async () => {
  for (const [index, match] of scoreBlocks.entries()) {
    const score = JSON.parse(match[1]), canvas = createCanvas(score.width, score.height);
    const painter = new Painter(canvas, { canvasFactory: createCanvas, historyLimit: 0 });
    try {
      const report = await painter.render(score);
      assert.equal(report.commands, score.layers.reduce((n, layer) => n + layer.commands.length, 0));
      const pixels = canvas.getContext('2d').getImageData(0, 0, score.width, score.height).data;
      const background = [1, 3, 5].map(start => parseInt(score.background.slice(start, start + 2), 16));
      let changed = false;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] !== background[0] || pixels[i+1] !== background[1] || pixels[i+2] !== background[2]) { changed = true; break; }
      }
      assert.ok(changed, `guide score ${index + 1} did not paint any visible pixels`);
      // Actual native pixels and unfiltered nearest-neighbor crops, uploaded
      // by the existing CI evidence artifact. No simulated screenshots.
      const output = new URL('../evidence/browser/', import.meta.url);
      mkdirSync(output, { recursive: true });
      const prefix = `agent-guide-${index + 1}`;
      writeFileSync(new URL(`../evidence/browser/${prefix}-score.json`, import.meta.url), painter.serialize(true) + '\n');
      writeFileSync(new URL(`../evidence/browser/${prefix}-native.png`, import.meta.url), canvas.toBuffer('image/png'));
      const size = Math.min(96, score.width, score.height);
      const x = Math.floor((score.width - size) * 0.5), y = Math.floor((score.height - size) * 0.5);
      const crop = painter.crop({ x, y, width: size, height: size, scale: 1 });
      const enlarged = painter.crop({ x, y, width: size, height: size, scale: 4 });
      writeFileSync(new URL(`../evidence/browser/${prefix}-crop-100pct.png`, import.meta.url), crop.toBuffer('image/png'));
      writeFileSync(new URL(`../evidence/browser/${prefix}-crop-4x-nearest.png`, import.meta.url), enlarged.toBuffer('image/png'));
    } finally {
      painter.dispose();
    }
  }
});

test('missing required fields, unknown operations and deeply malformed branches identify JSON pointers', () => {
  const scenarios = [
    { name: 'wrong op', edit: score => { score.layers[0].commands[0].op = 'shader'; }, path: '/layers/0/commands/0/op', code: 'discriminator' },
    { name: 'missing polygon', edit: score => { score.layers[0].commands[0] = { id: 'shape', op: 'fill', material: 'ink' }; }, path: '/layers/0/commands/0/polygon', code: 'required' },
    { name: 'invalid pressure', edit: score => { score.layers[0].commands[0].path[1] = [0.2,0.3,-0.1]; }, path: '/layers/0/commands/0/path/1/2', code: 'minimum' },
    { name: 'excess coordinate', edit: score => { score.layers[0].commands[0].path[0] = [0.1,0.2,0.3,0.4]; }, path: '/layers/0/commands/0/path/0', code: 'maxItems' },
    { name: 'nested type', edit: score => { score.layers[0].commands[0].path[0] = null; }, path: '/layers/0/commands/0/path/0', code: 'type' },
    { name: 'invalid blend', edit: score => { score.layers[0].blend = 'overlay'; }, path: '/layers/0/blend', code: 'enum' },
    { name: 'invalid material key', edit: score => { score.materials['bad/name'] = score.materials.ink; }, path: '/materials/bad~1name', code: 'propertyNames' },
    { name: 'reserved material key', edit: score => { score.materials = JSON.parse('{"__proto__":{"medium":"ink","color":"#102030","size":0.01}}'); }, path: '/materials/__proto__', code: 'propertyNames' },
  ];
  for (const scenario of scenarios) {
    const score = document();
    scenario.edit(score);
    const result = validatePainting(score);
    assert.equal(result.valid, false, scenario.name);
    const error = result.errors.find(issue => issue.path === scenario.path && issue.code === scenario.code);
    assert.ok(error, `${scenario.name}: ${JSON.stringify(result.errors)}`);
    assert.ok(error.suggestion.length > 15, scenario.name);
  }
});

test('semantic repairs identify the first duplicate and list actual material alternatives', () => {
  const score = document();
  score.layers.push({ id: 'reed', commands: [] });
  score.layers[0].commands[0].material = 'ghost';
  const result = validatePainting(score);
  assert.equal(result.valid, false);
  const duplicate = result.errors.find(issue => issue.code === 'duplicate-id');
  assert.equal(duplicate.path, '/layers/1/id');
  assert.match(duplicate.message, /\/layers\/0\/commands\/0\/id/);
  const material = result.errors.find(issue => issue.code === 'missing-material');
  assert.equal(material.path, '/layers/0/commands/0/material');
  assert.match(material.suggestion, /"ink"/);
});

test('aggregate command counts short-circuit before costly geometric estimates', () => {
  const score = document();
  score.layers = [
    { id: 'a', commands: Array.from({length: 5001}, (_, i) => ({id: `w${i}`,op:'wait',steps:1})) },
    { id: 'b', commands: Array.from({length: 5000}, (_, i) => ({id: `w${i+5001}`,op:'wait',steps:1})) },
  ];
  const result = validatePainting(score);
  assert.equal(result.valid, false);
  assert.equal(result.errors[0]?.code, 'workload-commands');
  assert.equal(result.errors[0]?.path, '/layers');
  assert.match(result.errors[0].message, new RegExp(String(WORKLOAD_LIMITS.commands)));
});

test('material refs and JSON errors are surfaced without mutation, not silently repaired', () => {
  const score = document();
  const snapshot = JSON.stringify(score);
  score.layers[0].commands[0].material = 'not-defined';
  const first = validatePainting(score), second = validatePainting(score);
  assert.deepEqual(first, second);
  assert.equal(first.errors[0].path, '/layers/0/commands/0/material');
  assert.equal(JSON.stringify(score).includes('not-defined'), true);
  assert.notEqual(JSON.stringify(score), snapshot);
  const malformed = document();
  malformed.layers[0].commands[0].path = Array.from({length: 50}, () => [3,3,-1]);
  const errors = validatePainting(malformed).errors;
  assert.ok(errors.length > 0 && errors.length <= 40, 'schema errors must be bounded');
});

test('the published npm tarball includes the actual llms.txt asset', () => {
  const result = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: root, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }));
  const names = result[0].files.map(file => file.path);
  assert.ok(names.includes('llms.txt'), `missing from pack: ${names.join(', ')}`);
  assert.match(readFileSync(new URL('../llms.txt', import.meta.url),'utf8'), /JSON v1\.0/);
});

test('checked-in generated artifacts remain unchanged after npm run generate', () => {
  execFileSync('git', ['diff', '--exit-code', '--', 'src/types.generated.ts', 'src/validator.generated.ts'], { cwd: root, stdio: 'pipe' });
});

test('full small-agent setup and command byte accounting is reproducible', () => {
  const setup = readFileSync(new URL('../llms.txt', import.meta.url), 'utf8');
  const prompt = readFileSync(new URL('../examples/agent-challenge-prompt.txt', import.meta.url), 'utf8');
  const response = readFileSync(new URL('../examples/agent-challenge.json', import.meta.url), 'utf8');
  const totalBytes = Buffer.byteLength(setup) + 1 + Buffer.byteLength(prompt);
  const totalChars = setup.length + 1 + prompt.length;
  const exampleBytes = totalBytes + 1 + Buffer.byteLength(response);
  const exampleChars = totalChars + 1 + response.length;
  assert.equal(totalBytes, 3334);
  assert.equal(totalChars, 3332);
  assert.equal(exampleBytes, 4189);
  assert.equal(exampleChars, 4187);
  assert.ok(guide.includes(`${totalBytes} UTF-8 bytes / ${totalChars} characters`));
  assert.ok(guide.includes(`${exampleBytes} UTF-8 bytes / ${exampleChars} characters`));
});
