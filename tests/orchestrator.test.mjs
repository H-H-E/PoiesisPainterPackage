import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PaintingOrchestrator, createPoiesisAdapter, createCanvasReferenceAdapter,
  createP5BrushAdapter, createPerfectFreehandAdapter, comparisonScore,
} from '../orchestrator/index.mjs';

const validatePainting = score => score?.version === '1.0' && score.layers?.length
  ? { valid: true, errors: [] }
  : { valid: false, errors: [{ path: '/version', message: 'Expected painting v1.0' }] };

class FakeCanvas {
  constructor(width, height) { this.width = width; this.height = height; this.calls = []; }
  getContext(kind) {
    if (kind !== '2d') return null;
    if (!this.ctx) {
      const canvas = this;
      this.ctx = {
        globalAlpha: 1, globalCompositeOperation: 'source-over',
        drawImage(source) { canvas.calls.push(['drawImage', source.width, source.height, this.globalCompositeOperation, this.globalAlpha]); },
        fillRect() { canvas.calls.push(['fillRect']); },
        save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {},
        clip() {}, translate() {}, rotate() {}, closePath() {},
      };
    }
    return this.ctx;
  }
}
const makeCanvas = (w, h) => new FakeCanvas(w, h);
const fakeAdapter = (id, { ops = ['stroke', 'fill', 'wait'], media = ['ink', 'watercolor', 'oil', 'graphite'], features = ['pressure'], onRender, available = true, priority = 0 } = {}) => ({
  id, priority, available: () => available,
  capabilities: {
    transparent: true,
    media: Object.fromEntries(media.map(m => [m, 'native'])),
    operations: Object.fromEntries(ops.map(op => [op, 'native'])),
    features: Object.fromEntries(features.map(k => [k, 'native'])),
  },
  async renderLayer(args) { if (onRender) await onRender(args); },
});
const fixture = comparisonScore();

test('selected adapters give deterministic route with complete rejected-candidate explanation', () => {
  const route = new PaintingOrchestrator({ adapters: [createCanvasReferenceAdapter(), fakeAdapter('native', { priority: 3 })], validatePainting, canvasFactory: makeCanvas });
  const a = route.plan(fixture);
  assert.deepEqual(a, route.plan(fixture));
  assert.equal(a.layers.length, 4);
  assert.ok(a.layers.every(x => x.engine === 'native'));
  assert.equal(a.layers[0].requirements.operations.includes('wait'), true);
  const pinned = route.plan(fixture, { pins: { linework: 'canvas2d-reference' } });
  assert.equal(pinned.layers[2].engine, 'canvas2d-reference');
  assert.ok(pinned.layers[2].warnings.some(x => x.includes('pressure')));
  assert.ok(pinned.layers[2].candidates.some(x => x.id === 'native'));
  assert.match(pinned.layers[2].reason, /Explicit compatible pin/);
});

test('strict minimum and forced unsupported/absent backend fail loudly, not with substitution', () => {
  const route = new PaintingOrchestrator({ adapters: [fakeAdapter('thin', { ops: ['stroke'], features: [] })], validatePainting, canvasFactory: makeCanvas });
  assert.throws(() => route.plan(fixture), /No compatible adapter for layer atmosphere.*operations.fill/);
  assert.throws(() => route.plan(fixture, { pins: { linework: 'missing' } }), /Unknown adapter/);
  assert.throws(() => route.plan(fixture, { pins: { wrong: 'thin' } }), /Unknown pinned layer/);
  const simplified = new PaintingOrchestrator({ adapters: [createCanvasReferenceAdapter()], validatePainting, canvasFactory: makeCanvas });
  assert.throws(() => simplified.plan(fixture, { minimum: 'native' }), /No compatible adapter/);
  assert.throws(() => simplified.plan(fixture, { minimum: 'banana' }), /minimum must/);
  assert.throws(() => simplified.plan({}), /Painting score rejected/);
});

test('missing external modules are not silently presented as installed engines', () => {
  const route = new PaintingOrchestrator({ adapters: [createP5BrushAdapter(), createPerfectFreehandAdapter(), createCanvasReferenceAdapter()], validatePainting, canvasFactory: makeCanvas });
  const caps = route.capabilities();
  assert.equal(caps[0].available, false);
  assert.equal(caps[1].available, false);
  assert.equal(caps[2].available, true);
  const plan = route.plan(fixture);
  assert.ok(plan.layers.every(layer => layer.engine === 'canvas2d-reference'));
  assert.ok(plan.layers[2].candidates.some(c => c.id === 'p5-brush' && c.failed.some(x => x.includes('not supplied'))));
});

test('render stages and composites by ordered layer, actual blend mode and opacity', async () => {
  const score = structuredClone(fixture);
  score.layers[1].blend = 'multiply'; score.layers[1].opacity = 0.4;
  score.layers[2].blend = 'screen';
  let rendered = [];
  const adapter = fakeAdapter('native', { priority: 5, onRender: ({ layer, canvas }) => {
    rendered.push(layer.id); canvas.getContext('2d').fillRect(0, 0, 1, 1);
  } });
  const route = new PaintingOrchestrator({ adapters: [adapter], validatePainting, canvasFactory: makeCanvas });
  const target = makeCanvas(10, 10);
  const result = await route.render(score, target);
  assert.deepEqual(rendered, ['atmosphere', 'distant-shapes', 'linework', 'light']);
  assert.equal(result.layers.length, 4);
  assert.equal(target.width, 480); assert.equal(target.height, 320);
  assert.ok(result.measured);
  assert.ok(target.calls.some(call => call[0] === 'drawImage'));
});

test('failure or cancellation prior to commit leaves target dimensions and drawn image unchanged', async () => {
  const bad = fakeAdapter('broken', { priority: 99, onRender: ({ layer }) => {
    if (layer.id === 'linework') throw new Error('GPU context lost');
  } });
  const route = new PaintingOrchestrator({ adapters: [bad], validatePainting, canvasFactory: makeCanvas });
  const target = makeCanvas(80, 50); target.getContext('2d').fillRect(0, 0, 80, 50);
  const before = structuredClone(target.calls);
  await assert.rejects(route.render(fixture, target), /GPU context lost/);
  assert.deepEqual(target.calls, before); assert.equal(target.width, 80); assert.equal(target.height, 50);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(route.render(fixture, target, { signal: controller.signal }), { name: 'AbortError' });
  assert.deepEqual(target.calls, before);
  await assert.rejects(route.render(fixture, target, { onLayer: () => { throw new Error('progress failed'); } }), /progress failed/);
  assert.deepEqual(target.calls, before);
});

test('native adapter isolates a layer, disables background only for that call, and disposes renderer', async () => {
  const calls = [];
  class StubPainter {
    constructor(target, options) { calls.push(['constructor', options.historyLimit]); }
    async render(doc, opts) { calls.push(['render', doc.layers.length, doc.layers[0].opacity, doc.layers[0].blend, opts.transparentBackground]); }
    dispose() { calls.push(['dispose']); }
  }
  const adapter = createPoiesisAdapter({ Painter: StubPainter, canvasFactory: makeCanvas });
  await adapter.renderLayer({ score: fixture, layer: fixture.layers[0], canvas: makeCanvas(480, 320) });
  assert.deepEqual(calls, [['constructor', 0], ['render', 1, 1, 'normal', true], ['dispose']]);
});

test('perfect-freehand injected geometry is actually invoked and drawn; p5 adapter is injectable', async () => {
  const passed = [];
  const geometry = createPerfectFreehandAdapter({ getStroke: (points, options) => {
    passed.push([points, options]); return [[0, 0], [10, 0], [5, 10]];
  } });
  const score = structuredClone(fixture);
  const layer = score.layers[2];
  const canvas = makeCanvas(score.width, score.height);
  await geometry.renderLayer({ score, layer, canvas });
  assert.equal(passed[0][0][0][0], 0.15 * score.width);
  assert.equal(passed[0][1].simulatePressure, false);
  const used = [];
  const brush = Object.fromEntries(['load', 'clear', 'push', 'translate', 'set', 'line', 'pop', 'render'].map(name => [name, (...args) => { used.push(name); }]));
  const p5 = createP5BrushAdapter({ brush });
  await p5.renderLayer({ score, layer, canvas, signal: undefined });
  assert.ok(used.includes('line')); assert.equal(used.at(-1), 'render');
});

test('native renderer pixel equivalence on exact same score (if built dependencies available)', async t => {
  let core, canvasLibrary;
  try {
    core = await import('../dist/index.js');
    canvasLibrary = await import('@napi-rs/canvas');
  } catch (error) {
    t.skip('Built dist and @napi-rs/canvas unavailable in this environment: ' + (error?.code || error?.message));
    return;
  }
  const score = comparisonScore();
  const normal = canvasLibrary.createCanvas(score.width, score.height);
  const mixed = canvasLibrary.createCanvas(score.width, score.height);
  const painter = new core.Painter(normal, { canvasFactory: canvasLibrary.createCanvas });
  try {
    await painter.render(score);
    const engine = new PaintingOrchestrator({
      adapters: [createPoiesisAdapter({ Painter: core.Painter, canvasFactory: canvasLibrary.createCanvas })],
      validatePainting: core.validatePainting, canvasFactory: canvasLibrary.createCanvas,
    });
    await engine.render(score, mixed);
    const one = normal.getContext('2d').getImageData(0, 0, score.width, score.height).data;
    const two = mixed.getContext('2d').getImageData(0, 0, score.width, score.height).data;
    let sum = 0, max = 0;
    for (let i = 0; i < one.length; i++) { const diff = Math.abs(one[i] - two[i]); sum += diff; max = Math.max(max, diff); }
    assert.ok(sum / one.length < 1.5, `Native routing must be near-pixel-equivalent (mean diff ${sum / one.length}, max ${max})`);
  } finally { painter.dispose(); }
});
