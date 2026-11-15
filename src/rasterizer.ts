import type { Material, StrokeCommand } from './types.generated.js';
import type { CanvasFactory, CanvasSurface, DrawingContext } from './canvas.js';
import { context2d, releaseCanvas } from './canvas.js';
import { sampleBounds, type Sample, type Bounds } from './geometry.js';
import { coherent, random, clamp } from './random.js';

export interface RasterMask { data: Uint8ClampedArray; region: Bounds }

/** Continuous ribbon rasterizer. Every bristle follows a connected longitudinal path. */
export class Rasterizer {
  private canvas: CanvasSurface;
  constructor(private factory: CanvasFactory) { this.canvas = factory(1, 1); }

  private prepare(region: Bounds): DrawingContext {
    this.canvas.width = Math.max(1, region.width); this.canvas.height = Math.max(1, region.height);
    const context = context2d(this.canvas);
    context.translate(-region.x, -region.y);
    context.fillStyle = '#ffffff'; context.strokeStyle = '#ffffff';
    context.lineJoin = 'round'; context.lineCap = 'butt';
    return context;
  }

  private finish(context: DrawingContext, region: Bounds): RasterMask {
    return { data: context.getImageData(0, 0, region.width, region.height).data, region };
  }

  fill(points: readonly { x: number; y: number }[], width: number, height: number): RasterMask | null {
    const region = sampleBounds(points, 0, width, height);
    if (!region.width || !region.height) return null;
    const context = this.prepare(region);
    context.beginPath(); context.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) context.lineTo(points[i].x, points[i].y);
    context.closePath(); context.fill('evenodd');
    return this.finish(context, region);
  }

  stroke(samples: readonly Sample[], material: Material, command: StrokeCommand, width: number, height: number, seed: number, widthScale = 1): RasterMask | null {
    const brushWidth = material.size * Math.min(width, height) * widthScale;
    const region = sampleBounds(samples, brushWidth * .65, width, height);
    if (!region.width || !region.height || samples.length < 2) return null;
    const context = this.prepare(region);
    const rng = random(seed), load = material.load ?? .85, roughness = material.roughness ?? .35;
    const dry = material.medium === 'graphite' || (material.medium !== 'marker' && load < .4);
    const bristles = material.bristles ?? (material.medium === 'knife' ? 16 : material.medium === 'graphite' ? 28 : 42);
    const tilt = command.tilt ?? 0;
    const nibAngle = (command.rotation ?? 0) * Math.PI / 180;
    const radius = (s: Sample) => {
      const nib = 1 - tilt * .55 * Math.abs(s.nx * Math.cos(nibAngle) + s.ny * Math.sin(nibAngle));
      return brushWidth * .5 * s.pressure * nib * (.94 + .1 * coherent(s.t * 8, seed));
    };
    const ribbon = (offset: number, thickness: number, wander: number, localSeed: number, contact = false) => {
      let active: Sample[] = [];
      const flush = () => {
        if (active.length < 2) { active = []; return; }
        context.beginPath();
        for (let side = 0; side < 2; side++) {
          for (let k = 0; k < active.length; k++) {
            const s = active[side ? active.length - 1 - k : k];
            const r = radius(s);
            const lane = offset * r + (coherent(s.t * 13, localSeed) - .5) * wander * brushWidth;
            const filament = thickness < .5 ? Math.max(.22, r * thickness) : r * thickness;
            const across = lane + (side ? -filament : filament);
            const x = s.x + s.nx * across, y = s.y + s.ny * across;
            if (!side && k === 0) context.moveTo(x, y); else context.lineTo(x, y);
          }
        }
        context.closePath(); context.fill(); active = [];
      };
      for (const s of samples) {
        const depletion = 1 - (1 - load) * s.t * .82;
        const touches = !contact || coherent(s.t * (11 + roughness * 23), localSeed + 173) < clamp(load * depletion + .28 - roughness * .12, .07, 1);
        if (touches && s.pressure > .002) active.push(s); else flush();
      }
      flush();
    };

    const base = material.medium === 'marker' ? .96 : material.medium === 'watercolor' ? .55 : material.medium === 'knife' ? .94 : material.medium === 'oil' ? .62 : .58;
    context.globalAlpha = dry ? .025 : base * (.55 + load * .45);
    ribbon(0, .97, .015, seed);
    for (let i = 0; i < bristles; i++) {
      const offset = ((i + .5) / bristles * 2 - 1) * (.91 + rng() * .07);
      const hairWidth = (1.1 + rng() * 1.1) / bristles;
      context.globalAlpha = (dry ? .2 : .22) + rng() * (dry ? .72 : .58);
      ribbon(offset, hairWidth, roughness * .045, seed + i * 1103, dry || material.medium === 'oil' || load < .7);
    }
    // Sparse longitudinal grooves show contact continuity without repeated circular tips.
    if (material.medium === 'oil' || material.medium === 'knife' || dry) {
      context.globalCompositeOperation = 'destination-out';
      context.globalAlpha = material.medium === 'knife' ? .15 : .2 + roughness * .18;
      for (let i = 0; i < Math.max(2, Math.round(bristles / 6)); i++) ribbon(rng() * 1.8 - .9, .006 + rng() * .014, roughness * .02, seed + i * 7777, false);
    }
    return this.finish(context, region);
  }

  dispose(): void { releaseCanvas(this.canvas); }
}
