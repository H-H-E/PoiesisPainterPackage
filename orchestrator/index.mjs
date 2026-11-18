/** Dependency-free, data-only routing of the Poiesis v1 score to isolated painting adapters. */
const LEVEL = Object.freeze({ none: 0, approximate: 1, native: 2 });
const FEATURES = ['pressure', 'tilt', 'rotation', 'speed', 'intent'];
const COMPOSITE = { normal: 'source-over', multiply: 'multiply', screen: 'screen' };

function factoryDefault(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    return canvas;
  }
  throw new Error('No browser canvas: supply canvasFactory for Node or headless use.');
}
function context(canvas) {
  const ctx = canvas?.getContext?.('2d');
  if (!ctx) throw new Error('A Canvas2D compositor is required.');
  return ctx;
}
function cancelIfNeeded(signal) {
  if (signal?.aborted) {
    const error = new Error('Orchestration cancelled; existing output retained.');
    error.name = 'AbortError';
    throw error;
  }
}
function checkAdapter(adapter) {
  if (!adapter || typeof adapter.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(adapter.id) ||
      !adapter.capabilities || typeof adapter.renderLayer !== 'function' ||
      adapter.capabilities.transparent !== true) {
    throw new TypeError('Adapter must provide a safe id, transparent output capability, capabilities and renderLayer().');
  }
  for (const group of ['media', 'operations', 'features']) {
    if (!adapter.capabilities[group] || typeof adapter.capabilities[group] !== 'object') {
      throw new TypeError(`Adapter ${adapter.id}: missing ${group} capability table.`);
    }
    for (const v of Object.values(adapter.capabilities[group])) {
      if (!Object.hasOwn(LEVEL, v)) throw new TypeError(`Adapter ${adapter.id}: invalid capability level ${v}.`);
    }
  }
}
function needs(layer, score) {
  const media = new Set(), operations = new Set(), features = new Set();
  for (const command of layer.commands) {
    operations.add(command.op);
    if (command.op !== 'wait') media.add(score.materials[command.material].medium);
    if (command.op === 'stroke' || command.op === 'family') {
      if (command.path.some(point => point.length > 2)) features.add('pressure');
      for (const feature of FEATURES.slice(1)) if (command[feature] !== undefined) features.add(feature);
    }
  }
  return { media: [...media].sort(), operations: [...operations].sort(), features: [...features].sort() };
}
function inspect(adapter, requirement, minimum) {
  const failed = [], warnings = [];
  const status = (() => {
    try {
      const result = typeof adapter.available === 'function' ? adapter.available() : true;
      if (result && typeof result.then === 'function') return 'availability() must be synchronous';
      return result === true ? '' : typeof result === 'string' ? result : 'unavailable in this runtime';
    } catch (error) { return `availability check failed: ${String(error)}`; }
  })();
  if (status) failed.push(status);
  let confidence = Number.isFinite(adapter.priority) ? adapter.priority : 0;
  for (const category of ['media', 'operations', 'features']) {
    for (const key of requirement[category]) {
      const level = adapter.capabilities[category][key] ?? 'none';
      if (LEVEL[level] < LEVEL[minimum]) failed.push(`${category}.${key}: ${level}; requires ${minimum}`);
      else if (level === 'approximate') warnings.push(`${category}.${key}: approximation by ${adapter.id}`);
      confidence += LEVEL[level];
    }
  }
  return { id: adapter.id, eligible: failed.length === 0, failed, warnings, priority: confidence };
}
function validateScore(score, validate) {
  if (typeof validate !== 'function') throw new Error('Pass the package validatePainting function to PaintingOrchestrator.');
  const result = validate(score);
  if (!result?.valid) {
    const errors = (result?.errors || []).slice(0, 5).map(x => `${x.path}: ${x.message}`).join('; ');
    throw new Error('Painting score rejected: ' + (errors || 'invalid schema or workload'));
  }
}
function release(canvas) {
  try { canvas.width = 1; canvas.height = 1; } catch { /* best-effort only */ }
}

/** Capability planning is deterministic, inspectable, and requires no model or paid service. */
export class PaintingOrchestrator {
  constructor({ adapters, validatePainting, canvasFactory = factoryDefault }) {
    if (!Array.isArray(adapters) || adapters.length === 0) throw new Error('At least one adapter is required.');
    for (const adapter of adapters) checkAdapter(adapter);
    if (new Set(adapters.map(x => x.id)).size !== adapters.length) throw new Error('Duplicate adapter IDs.');
    if (typeof canvasFactory !== 'function') throw new TypeError('canvasFactory must be a function.');
    this.adapters = [...adapters];
    this.validatePainting = validatePainting;
    this.canvasFactory = canvasFactory;
  }
  capabilities() {
    return this.adapters.map(({ id, label, capabilities, priority, available }) => ({
      id, label: label ?? id, capabilities: structuredClone(capabilities), priority: priority ?? 0,
      available: typeof available === 'function' ? (() => { try { return available() === true; } catch { return false; } })() : true,
    }));
  }
  plan(score, { pins = {}, minimum = 'approximate' } = {}) {
    validateScore(score, this.validatePainting);
    if (!Object.hasOwn(LEVEL, minimum) || minimum === 'none') throw new Error('minimum must be approximate or native.');
    for (const [key, id] of Object.entries(pins)) {
      if (!score.layers.some(layer => layer.id === key)) throw new Error(`Unknown pinned layer: ${key}`);
      if (!this.adapters.some(adapter => adapter.id === id)) throw new Error(`Unknown adapter ${id} pinned to ${key}`);
    }
    const layers = score.layers.map(layer => {
      const requirement = needs(layer, score);
      const candidates = this.adapters.map(adapter => inspect(adapter, requirement, minimum));
      const requested = pins[layer.id];
      if (requested && !this.adapters.some(adapter => adapter.id === requested)) throw new Error(`Unknown adapter ${requested} pinned to ${layer.id}`);
      const eligible = candidates.filter(x => x.eligible && (!requested || requested === x.id));
      eligible.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
      if (!eligible.length) {
        const reasons = candidates.map(x => x.id + ': ' + (x.failed.join(', ') || 'not selected')).join(' | ');
        throw new Error(`No compatible adapter for layer ${layer.id}: ${reasons}`);
      }
      const selected = eligible[0];
      return {
        id: layer.id, engine: selected.id,
        requirements: requirement, warnings: selected.warnings,
        reason: requested ? `Explicit compatible pin to ${requested}` : `Highest declared capability fit (${selected.priority}); not a measured quality or speed ranking`,
        candidates,
      };
    });
    return { version: '1.0', policy: { minimum, pins: { ...pins } }, layers };
  }
  async render(score, target, { pins = {}, minimum = 'approximate', signal, onLayer } = {}) {
    const plan = this.plan(score, { pins, minimum });
    cancelIfNeeded(signal);
    const start = performance.now();
    const stage = this.canvasFactory(score.width, score.height);
    const stagedCtx = context(stage);
    const previous = this.canvasFactory(target.width, target.height);
    const previousCtx = context(previous);
    previousCtx.drawImage(target, 0, 0);
    const reports = [];
    try {
      stagedCtx.fillStyle = score.background;
      stagedCtx.fillRect(0, 0, score.width, score.height);
      for (const decision of plan.layers) {
        cancelIfNeeded(signal);
        const layer = score.layers.find(x => x.id === decision.id);
        const adapter = this.adapters.find(x => x.id === decision.engine);
        const surface = this.canvasFactory(score.width, score.height);
        try {
          const time = performance.now();
          // Each renderer must output raw premultiplied/ordinary RGBA to a *clear* surface.
          // Blend and layer opacity happen ONCE here, never in the individual renderer.
          await adapter.renderLayer({ score, layer, canvas: surface, signal, canvasFactory: this.canvasFactory });
          cancelIfNeeded(signal);
          stagedCtx.globalAlpha = layer.opacity ?? 1;
          stagedCtx.globalCompositeOperation = COMPOSITE[layer.blend ?? 'normal'];
          stagedCtx.drawImage(surface, 0, 0);
          reports.push({ id: layer.id, engine: decision.engine, elapsedMs: performance.now() - time, warnings: decision.warnings });
          if (onLayer) await onLayer(reports.at(-1));
          cancelIfNeeded(signal);
        } finally { release(surface); }
      }
      stagedCtx.globalAlpha = 1;
      stagedCtx.globalCompositeOperation = 'source-over';
      cancelIfNeeded(signal);
      // Output is not touched until every adapter and progress callback succeeds.
      try {
        target.width = score.width; target.height = score.height;
        context(target).drawImage(stage, 0, 0);
      } catch (error) {
        try {
          target.width = previous.width; target.height = previous.height;
          context(target).drawImage(previous, 0, 0);
        } catch { /* context loss may require a new target */ }
        throw error;
      }
      return { plan, layers: reports, elapsedMs: performance.now() - start, measured: true };
    } finally {
      release(stage);
      release(previous);
    }
  }
}

const levels = (names, level) => Object.fromEntries(names.map(name => [name, level]));
const allMedia = ['ink', 'watercolor', 'oil', 'graphite', 'marker', 'knife'];
const allOps = ['stroke', 'fill', 'hatch', 'family', 'wait'];

/** Existing Poiesis Painter, rendered transparently one score layer at a time. */
export function createPoiesisAdapter({ Painter, canvasFactory }) {
  if (typeof Painter !== 'function') throw new TypeError('Pass the existing Painter class explicitly.');
  return {
    id: 'poiesis', label: 'Poiesis Canvas2D / material-field engine', priority: 2,
    capabilities: {
      transparent: true,
      media: { ...levels(allMedia, 'native') }, operations: { ...levels(allOps, 'native') },
      features: { pressure: 'native', tilt: 'approximate', rotation: 'native', speed: 'approximate', intent: 'approximate' },
      notes: 'Layer-local wet and oil effects; material models remain stylized; no cross-layer wet interaction.',
    },
    async renderLayer({ score, layer, canvas, signal }) {
      const painter = new Painter(canvas, { canvasFactory, historyLimit: 0 });
      try {
        const isolated = { ...score, layers: [{ ...layer, opacity: 1, blend: 'normal' }] };
        await painter.render(isolated, { signal, transparentBackground: true });
      } finally { painter.dispose(); }
    },
  };
}

/** Intentionally reduced Canvas2D comparator: never claims to simulate water or oil. */
export function createCanvasReferenceAdapter() {
  return {
    id: 'canvas2d-reference', label: 'Plain Canvas2D approximation (not a brush framework)', priority: -10,
    capabilities: {
      transparent: true, media: levels(allMedia, 'approximate'), operations: levels(allOps, 'approximate'),
      features: levels(FEATURES, 'approximate'),
      notes: 'Wait is a no-op; pressure is averaged; no pigment movement, bristle physics or impasto. A deliberately lossy comparator.',
    },
    async renderLayer({ score, layer, canvas, signal }) {
      const ctx = context(canvas), min = Math.min(score.width, score.height);
      function stroke(command, offsetX = 0, offsetY = 0) {
        if (command.path.length < 2) return;
        const material = score.materials[command.material];
        const pressure = command.path.reduce((sum, p) => sum + (p[2] ?? 1), 0) / command.path.length;
        ctx.save(); ctx.globalAlpha = material.opacity ?? 1;
        ctx.strokeStyle = material.color; ctx.lineWidth = Math.max(0.2, material.size * min * pressure);
        ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath();
        for (let i = 0; i < command.path.length; i++) {
          const p = command.path[i], x = (p[0] + offsetX) * score.width, y = (p[1] + offsetY) * score.height;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke(); ctx.restore();
      }
      function polygonPath(polygon) {
        ctx.beginPath();
        polygon.forEach((p, i) => { if (i === 0) ctx.moveTo(p[0] * score.width, p[1] * score.height); else ctx.lineTo(p[0] * score.width, p[1] * score.height); });
        ctx.closePath();
      }
      for (const command of layer.commands) {
        cancelIfNeeded(signal);
        if (command.op === 'wait') continue; // Identified as an approximation in the plan.
        const material = score.materials[command.material];
        if (command.op === 'stroke') stroke(command);
        else if (command.op === 'family') {
          for (let i = 0; i < command.count; i++) {
            const t = command.count === 1 ? 0 : i / (command.count - 1);
            stroke(command, command.spread[0] * t, command.spread[1] * t);
          }
        } else if (command.op === 'fill') {
          ctx.save(); ctx.globalAlpha = material.opacity ?? 1; ctx.fillStyle = material.color;
          polygonPath(command.polygon); ctx.fill(); ctx.restore();
        } else if (command.op === 'hatch') {
          ctx.save(); polygonPath(command.polygon); ctx.clip();
          ctx.globalAlpha = material.opacity ?? 1; ctx.strokeStyle = material.color;
          ctx.lineWidth = Math.max(0.3, material.size * min); ctx.translate(score.width / 2, score.height / 2);
          ctx.rotate(command.angle * Math.PI / 180);
          const extent = Math.hypot(score.width, score.height), step = Math.max(1, command.spacing * min);
          for (let y = -extent, n = 0; y <= extent && n < 2048; y += step, n++) {
            ctx.beginPath(); ctx.moveTo(-extent, y); ctx.lineTo(extent, y); ctx.stroke();
          }
          ctx.restore();
        }
      }
    },
  };
}

/** Optional p5.brush standalone adapter; the library must be supplied by the consumer. */
export function createP5BrushAdapter({ brush, brushName = 'HB' } = {}) {
  return {
    id: 'p5-brush', label: 'p5.brush standalone / WebGL2', priority: 1,
    available: () => brush && ['load', 'clear', 'push', 'translate', 'set', 'line', 'pop', 'render'].every(k => typeof brush[k] === 'function') ? true : 'p5.brush standalone module not supplied',
    capabilities: {
      transparent: true, media: { ink: 'approximate', graphite: 'approximate' }, operations: { stroke: 'approximate' },
      features: { pressure: 'approximate', tilt: 'none', rotation: 'none', speed: 'none', intent: 'none' },
      notes: 'Polyline segments use a single named brush and do not reproduce pointwise pressure or Poiesis pigment physics.',
    },
    async renderLayer({ score, layer, canvas, signal }) {
      cancelIfNeeded(signal);
      brush.load(canvas); brush.clear(); brush.push();
      try {
        brush.translate(-score.width / 2, -score.height / 2);
        for (const command of layer.commands) {
          cancelIfNeeded(signal);
          const material = score.materials[command.material];
          brush.set(brushName, material.color, material.size * Math.min(score.width, score.height) / 10);
          for (let i = 1; i < command.path.length; i++) {
            const prev = command.path[i - 1], next = command.path[i];
            brush.line(prev[0] * score.width, prev[1] * score.height, next[0] * score.width, next[1] * score.height);
          }
        }
      } finally { brush.pop(); }
      brush.render();
      if (typeof brush.ready === 'function') await brush.ready();
    },
  };
}

/** Optional perfect-freehand geometry adapter; renderer draws its returned pressure outlines. */
export function createPerfectFreehandAdapter({ getStroke } = {}) {
  return {
    id: 'perfect-freehand', label: 'perfect-freehand / Canvas2D outline renderer', priority: 3,
    available: () => typeof getStroke === 'function' ? true : 'perfect-freehand getStroke not supplied',
    capabilities: {
      transparent: true, media: { ink: 'approximate', marker: 'approximate', graphite: 'approximate' },
      operations: { stroke: 'native' },
      features: { pressure: 'native', tilt: 'none', rotation: 'none', speed: 'none', intent: 'none' },
      notes: 'Geometry-only stroke outlines; no simulated pigment transport or brush-tip texture.',
    },
    async renderLayer({ score, layer, canvas, signal }) {
      const ctx = context(canvas), min = Math.min(score.width, score.height);
      for (const command of layer.commands) {
        cancelIfNeeded(signal);
        const material = score.materials[command.material];
        const points = command.path.map(([x, y, pressure = 1]) => [x * score.width, y * score.height, pressure]);
        const outline = getStroke(points, { size: material.size * min, thinning: 0.7, smoothing: 0.55, streamline: 0.3, simulatePressure: false });
        if (!outline.length) continue;
        ctx.save(); ctx.globalAlpha = material.opacity ?? 1; ctx.fillStyle = material.color; ctx.beginPath();
        outline.forEach(([x, y], i) => { if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
        ctx.closePath(); ctx.fill(); ctx.restore();
      }
    },
  };
}

/** Compact comparison fixture; same source geometry is sent to all three demo modes. */
export function comparisonScore() {
  return {
    version: '1.0', width: 480, height: 320, seed: 147, background: '#eee6d7',
    paper: { texture: 0.55, absorbency: 0.65 },
    materials: {
      haze: { medium: 'watercolor', color: '#759aaf', size: 0.14, opacity: 0.54, wetness: 0.88 },
      earth: { medium: 'oil', color: '#3e5260', size: 0.08, opacity: 0.95, roughness: 0.5 },
      pencil: { medium: 'graphite', color: '#263d4b', size: 0.01, opacity: 0.9, roughness: 0.6 },
      sun: { medium: 'ink', color: '#d4994d', size: 0.028, opacity: 0.85 },
    },
    layers: [
      { id: 'atmosphere', commands: [
        { id: 'sky', op: 'fill', material: 'haze', polygon: [[0, 0], [1, 0], [1, 0.70], [0, 0.64]] },
        { id: 'sky-wet', op: 'stroke', material: 'haze', path: [[0.02, 0.42, 0.3], [0.4, 0.39, 0.6], [0.98, 0.43, 0.2]] },
        { id: 'settle', op: 'wait', steps: 6 },
      ] },
      { id: 'distant-shapes', commands: [
        { id: 'ridge', op: 'fill', material: 'earth', polygon: [[0, 0.68], [0.14, 0.55], [0.28, 0.65], [0.55, 0.43], [0.75, 0.55], [1, 0.48], [1, 1], [0, 1]] },
      ] },
      { id: 'linework', commands: [
        { id: 'reed1', op: 'stroke', material: 'pencil', path: [[0.15, 0.99, 0.7], [0.2, 0.78, 0.9], [0.25, 0.64, 0.1]] },
        { id: 'reed2', op: 'stroke', material: 'pencil', path: [[0.22, 0.97, 0.9], [0.25, 0.84, 0.6], [0.31, 0.72, 0.1]] },
        { id: 'reed3', op: 'stroke', material: 'pencil', path: [[0.79, 0.96, 0.8], [0.74, 0.82, 0.6], [0.75, 0.69, 0.1]] },
      ] },
      { id: 'light', commands: [
        { id: 'glow', op: 'stroke', material: 'sun', path: [[0.67, 0.38, 0.1], [0.72, 0.38, 1], [0.77, 0.39, 0.1]] },
      ] },
    ],
  };
}
