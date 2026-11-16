import type { PaintingDocument, Command, Material, StrokeCommand, Layer } from './types.generated.js';
import type { CanvasSurface, CanvasFactory } from './canvas.js';
import { browserCanvas, context2d, releaseCanvas } from './canvas.js';
import { assertPainting, estimateWorkload, WORKLOAD_LIMITS } from './validate.js';
import { hashSeed, clamp } from './random.js';
import { samplePath, resolveIntent, expandFamily, hatchSegments, type Sample } from './geometry.js';
import { resolveMaterial } from './presets.js';
import { Rasterizer } from './rasterizer.js';
import { MaterialSurface, createReservoir, type MaterialStats } from './materials.js';

export interface RenderProgress { completed: number; total: number; layerId: string; commandId: string; elapsedMs: number }
export interface RenderOptions { signal?: AbortSignal; onProgress?: (progress: RenderProgress) => void; yieldEvery?: number }
export interface PainterOptions { canvasFactory?: CanvasFactory; historyLimit?: number }
export interface LayerReport { id: string; reused: boolean; durationMs: number; marks: number; stats: MaterialStats }
export interface RenderReport { durationMs: number; commands: number; marks: number; cacheHits: number; layers: LayerReport[] }
interface CachedLayer { key: string; canvas: CanvasSurface; report: LayerReport }

const abortError = () => { const error = new Error('Painting render cancelled; the committed document and image were retained.'); error.name = 'AbortError'; return error; };
const yieldToHost = () => new Promise<void>(resolve => setTimeout(resolve, 0));

export function capabilities() {
  return {
    version: '0.1.0', schemaVersion: '1.0', backend: 'canvas2d-cpu',
    media: ['ink', 'watercolor', 'oil', 'graphite', 'marker', 'knife'],
    commands: ['stroke', 'fill', 'hatch', 'family', 'wait'],
    supports: { pressure: true, tilt: 'contact-width approximation', rotation: 'nib orientation', speed: 'deposition multiplier', pickup: 'ordered stroke reservoir', diffusion: 'CPU conservative local transport', relief: 'height shading', spectralMixing: false, shallowWater: false, perBristleReservoir: false, svg: false, gpu: false, workers: false, bitmapTips: false },
    determinism: 'Same score, dimensions, implementation and Canvas backend. Cross-backend antialiasing may differ.',
    layerInteraction: 'Material physics is isolated per layer; blend modes are visual only.',
    limits: WORKLOAD_LIMITS,
  } as const;
}

/** An ordered, validated score with atomic staged rendering and bounded revision history. */
export class Painter {
  private target: CanvasSurface;
  private factory: CanvasFactory;
  private current?: PaintingDocument;
  private composite?: CanvasSurface;
  private cache = new Map<string, CachedLayer>();
  private past: PaintingDocument[] = [];
  private future: PaintingDocument[] = [];
  private generation = 0;
  private disposed = false;
  private historyLimit: number;
  private report?: RenderReport;

  constructor(canvas: CanvasSurface, options: PainterOptions = {}) {
    this.target = canvas; this.factory = options.canvasFactory ?? browserCanvas;
    this.historyLimit = Math.max(0, Math.min(100, options.historyLimit ?? 32));
    context2d(canvas);
  }

  get document(): PaintingDocument | undefined { return this.current ? structuredClone(this.current) : undefined; }

  private assertAlive(): void { if (this.disposed) throw new Error('Painter was disposed. Create a new Painter to paint again.'); }

  private layerKey(document: PaintingDocument, layer: Layer): string {
    const ids = [...new Set(layer.commands.flatMap(command => command.op === 'wait' ? [] : [command.material]))].sort();
    return JSON.stringify([document.width, document.height, document.seed, document.paper, layer.commands, ids.map(id => [id, document.materials[id]])]);
  }

  async render(value: unknown, options: RenderOptions = {}): Promise<RenderReport> { return this.renderDocument(value, options, true); }

  private async renderDocument(value: unknown, options: RenderOptions, recordHistory: boolean): Promise<RenderReport> {
    this.assertAlive(); assertPainting(value);
    const document = structuredClone(value);
    const operation = ++this.generation;
    const check = () => { if (options.signal?.aborted || operation !== this.generation || this.disposed) throw abortError(); };
    check();
    const start = performance.now();
    const candidateCache = new Map<string, CachedLayer>();
    const created: CanvasSurface[] = [];
    const stage = this.factory(document.width, document.height); created.push(stage);
    const report: RenderReport = { durationMs: 0, commands: 0, marks: 0, cacheHits: 0, layers: [] };
    const total = document.layers.reduce((sum, layer) => sum + layer.commands.length, 0);
    let completed = 0, lastYield = performance.now();
    const tick = async (layerId: string, commandId: string, force = false) => {
      check();
      if (force || performance.now() - lastYield > (options.yieldEvery ?? 12)) {
        options.onProgress?.({ completed, total, layerId, commandId, elapsedMs: performance.now() - start });
        await yieldToHost(); lastYield = performance.now(); check();
      }
    };
    try {
      const compositeContext = context2d(stage);
      compositeContext.fillStyle = document.background; compositeContext.fillRect(0, 0, document.width, document.height);
      for (const layer of document.layers) {
        check();
        const key = this.layerKey(document, layer), cached = this.cache.get(layer.id);
        let entry: CachedLayer;
        if (cached?.key === key) {
          entry = cached; report.cacheHits++; completed += layer.commands.length;
          report.commands += layer.commands.length;
          report.layers.push({ ...cached.report, reused: true, durationMs: 0 });
        } else {
          const began = performance.now(), canvas = this.factory(document.width, document.height); created.push(canvas);
          const surface = new MaterialSurface(document.width, document.height, document.paper, document.seed);
          const raster = new Rasterizer(this.factory);
          let marks = 0;
          try {
            const paintStroke = async (command: StrokeCommand) => {
              const base = resolveMaterial(document.materials[command.material]);
              const intent = resolveIntent(base, command.intent), seed = hashSeed(document.seed, command.id);
              const speed = (command.speed ?? 1) * intent.speedScale;
              const material: Material = { ...base, opacity: clamp(base.opacity * intent.opacityScale / Math.sqrt(speed)) };
              const samples = samplePath(command.path, document.width, document.height, seed, intent);
              const reservoir = createReservoir(material);
              const area = samples.at(-1)!.distance * material.size * Math.min(document.width, document.height);
              reservoir.capacity = Math.max(1, area * 1.25);
              reservoir.remaining = reservoir.capacity * (material.load ?? 1);
              const chunkLength = material.medium === 'oil' || material.medium === 'knife' ? Math.max(8, material.size * Math.min(document.width, document.height) * 1.75) : Infinity;
              let chunk: Sample[] = [samples[0]], chunkStart = samples[0].distance;
              for (let i = 1; i < samples.length; i++) {
                chunk.push(samples[i]);
                if (samples[i].distance - chunkStart >= chunkLength || i === samples.length - 1) {
                  const mask = raster.stroke(chunk, material, command, document.width, document.height, seed, intent.widthScale);
                  if (mask) surface.deposit(mask.data, mask.region, material, reservoir);
                  chunk = [samples[i]]; chunkStart = samples[i].distance;
                }
              }
              marks++;
              await tick(layer.id, command.id);
            };
            for (const command of layer.commands) {
              check();
              if (command.op === 'wait') {
                for (let step = 0; step < command.steps; step++) { surface.step(1); if (step % 2 === 1) await tick(layer.id, command.id); }
              } else if (command.op === 'fill') {
                const material = resolveMaterial(document.materials[command.material]);
                const mask = raster.fill(command.polygon.map(p => ({ x: p[0] * document.width, y: p[1] * document.height })), document.width, document.height);
                if (mask) surface.deposit(mask.data, mask.region, material);
                marks++;
              } else if (command.op === 'family') {
                for (const stroke of expandFamily(command, document.seed)) await paintStroke(stroke);
              } else if (command.op === 'hatch') {
                const lines = hatchSegments(command.polygon, command.spacing, command.angle);
                for (let i = 0; i < lines.length; i++) await paintStroke({ id: `${command.id}:${i}`, op: 'stroke', material: command.material, path: lines[i] });
              } else await paintStroke(command);
              completed++; report.commands++;
              await tick(layer.id, command.id);
            }
            const context = context2d(canvas), image = context.createImageData(document.width, document.height);
            image.data.set(surface.rgba()); context.putImageData(image, 0, 0);
            entry = { key, canvas, report: { id: layer.id, reused: false, durationMs: performance.now() - began, marks, stats: surface.stats() } };
            report.layers.push(entry.report);
          } finally { surface.dispose(); raster.dispose(); }
        }
        candidateCache.set(layer.id, entry);
        report.marks += entry.report.marks;
        compositeContext.globalAlpha = layer.opacity ?? 1;
        compositeContext.globalCompositeOperation = layer.blend === 'multiply' ? 'multiply' : layer.blend === 'screen' ? 'screen' : 'source-over';
        compositeContext.drawImage(entry.canvas as CanvasImageSource, 0, 0);
        await tick(layer.id, '', true);
      }
      check();
      // Observer callbacks run before the commit boundary; a thrown callback is a failed transaction.
      options.onProgress?.({ completed: total, total, layerId: '', commandId: '', elapsedMs: performance.now() - start });
      check();
      // This last copy is the commit boundary. The old composite remains available for recovery.
      try {
        this.target.width = document.width; this.target.height = document.height;
        context2d(this.target).drawImage(stage as CanvasImageSource, 0, 0);
      } catch (error) {
        if (this.composite) {
          try { this.target.width = this.composite.width; this.target.height = this.composite.height; context2d(this.target).drawImage(this.composite as CanvasImageSource, 0, 0); } catch { /* context may need recover(newCanvas) */ }
        }
        throw error;
      }
      if (recordHistory && this.current && this.historyLimit) {
        this.past.push(this.current); if (this.past.length > this.historyLimit) this.past.shift();
        this.future = [];
      }
      for (const [id, old] of this.cache) if (candidateCache.get(id)?.canvas !== old.canvas) releaseCanvas(old.canvas);
      if (this.composite) releaseCanvas(this.composite);
      this.current = document; this.composite = stage; this.cache = candidateCache;
      report.durationMs = performance.now() - start; this.report = report;
      return structuredClone(report);
    } catch (error) {
      for (const canvas of created) releaseCanvas(canvas);
      throw error;
    }
  }

  async transact(edit: (document: PaintingDocument) => void, options: RenderOptions = {}): Promise<RenderReport> {
    this.assertAlive();
    if (!this.current) throw new Error('Render a document before editing it.');
    const candidate = structuredClone(this.current); edit(candidate);
    return this.render(candidate, options);
  }

  async apply(layerId: string, commands: Command[], options: RenderOptions = {}): Promise<RenderReport> {
    return this.transact(document => {
      const layer = document.layers.find(layer => layer.id === layerId);
      if (!layer) throw new Error(`Layer ${layerId} does not exist. Choose an ID from inspect().layers.`);
      layer.commands.push(...structuredClone(commands));
    }, options);
  }

  async revise(id: string, patch: Partial<Command> | Partial<Layer>, options: RenderOptions = {}): Promise<RenderReport> {
    return this.transact(document => {
      if ('id' in patch && patch.id !== id) throw new Error('Revision preserves the stable ID. Remove and add to rename.');
      for (const layer of document.layers) {
        if (layer.id === id) { Object.assign(layer, structuredClone(patch)); return; }
        const command = layer.commands.find(command => command.id === id);
        if (command) { Object.assign(command, structuredClone(patch)); return; }
      }
      throw new Error(`ID ${id} does not exist. Use inspect() or document to select a stable ID.`);
    }, options);
  }

  async remove(id: string, options: RenderOptions = {}): Promise<RenderReport> {
    return this.transact(document => {
      const layerIndex = document.layers.findIndex(layer => layer.id === id);
      if (layerIndex >= 0) { document.layers.splice(layerIndex, 1); return; }
      for (const layer of document.layers) { const index = layer.commands.findIndex(command => command.id === id); if (index >= 0) { layer.commands.splice(index, 1); return; } }
      throw new Error(`ID ${id} does not exist.`);
    }, options);
  }

  async undo(options: RenderOptions = {}): Promise<boolean> {
    this.assertAlive(); const previous = this.past.at(-1); if (!previous || !this.current) return false;
    const current = this.current; await this.renderDocument(previous, options, false); this.past.pop(); this.future.push(current); return true;
  }

  async redo(options: RenderOptions = {}): Promise<boolean> {
    this.assertAlive(); const next = this.future.at(-1); if (!next || !this.current) return false;
    const current = this.current; await this.renderDocument(next, options, false); this.future.pop(); this.past.push(current); return true;
  }

  serialize(pretty = false): string { this.assertAlive(); if (!this.current) throw new Error('No committed painting.'); return JSON.stringify(this.current, null, pretty ? 2 : undefined); }

  inspect() {
    this.assertAlive();
    return { width: this.current?.width ?? 0, height: this.current?.height ?? 0, layerCount: this.current?.layers.length ?? 0, commandCount: this.current?.layers.reduce((n, layer) => n + layer.commands.length, 0) ?? 0, workload: this.current ? estimateWorkload(this.current) : null, history: { canUndo: !!this.past.length, canRedo: !!this.future.length }, lastRender: this.report ? structuredClone(this.report) : null, layers: this.current?.layers.map(layer => ({ id: layer.id, commands: layer.commands.map(command => command.id), stats: structuredClone(this.cache.get(layer.id)?.report.stats) })) ?? [], capabilities: capabilities() };
  }

  crop({ x, y, width, height, scale = 1 }: { x: number; y: number; width: number; height: number; scale?: number }): CanvasSurface {
    this.assertAlive(); if (!this.composite) throw new Error('Render before requesting a crop.');
    if (![x, y, width, height, scale].every(Number.isFinite) || x < 0 || y < 0 || width < 1 || height < 1 || scale < 1 || scale > 8 || x + width > this.composite.width || y + height > this.composite.height || width * height * scale * scale > 24_000_000) throw new Error('Crop must stay within the image, use scale 1..8 and at most 24 million output pixels.');
    const canvas = this.factory(Math.round(width * scale), Math.round(height * scale)), context = context2d(canvas);
    context.imageSmoothingEnabled = false;
    context.drawImage(this.composite as CanvasImageSource, x, y, width, height, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  async export(width: number, height: number, options: RenderOptions = {}): Promise<CanvasSurface> {
    this.assertAlive(); if (!this.current) throw new Error('Render before exporting.');
    const document = { ...structuredClone(this.current), width, height };
    assertPainting(document);
    const canvas = this.factory(width, height), painter = new Painter(canvas, { canvasFactory: this.factory, historyLimit: 0 });
    try { await painter.render(document, options); return canvas; } catch (error) { releaseCanvas(canvas); throw error; } finally { painter.dispose(); }
  }

  /** Restore the committed image to a fresh context after the browser loses a canvas. */
  recover(canvas: CanvasSurface): void {
    this.assertAlive(); context2d(canvas); this.target = canvas;
    if (this.composite) { canvas.width = this.composite.width; canvas.height = this.composite.height; context2d(canvas).drawImage(this.composite as CanvasImageSource, 0, 0); }
  }

  cancel(): void { this.generation++; }

  dispose(): void {
    if (this.disposed) return;
    this.generation++; this.disposed = true;
    for (const entry of this.cache.values()) releaseCanvas(entry.canvas);
    this.cache.clear(); if (this.composite) releaseCanvas(this.composite);
    this.composite = undefined; this.current = undefined; this.past = []; this.future = [];
  }
}

export async function paint(canvas: CanvasSurface, document: PaintingDocument, options: PainterOptions & RenderOptions = {}): Promise<Painter> {
  const painter = new Painter(canvas, options); await painter.render(document, options); return painter;
}
