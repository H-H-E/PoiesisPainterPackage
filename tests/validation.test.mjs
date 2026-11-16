import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePainting, assertPainting, PaintingValidationError, estimateWorkload } from '../dist/validate.js';

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
