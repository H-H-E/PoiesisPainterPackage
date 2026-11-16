import type { Material, StrokeCommand } from './types.generated.js';
import type { CanvasFactory, CanvasSurface, DrawingContext } from './canvas.js';
import { context2d, releaseCanvas } from './canvas.js';
import { sampleBounds, type Sample, type Bounds } from './geometry.js';
import { coherent, random, clamp } from './random.js';

export interface RasterMask { data: Uint8ClampedArray; region: Bounds }

/**
 * Reconstruct a centerline on a fixed physical-pixel grid, rather than at the
 * caller's path-sampling intervals. Noise/contact are evaluated using absolute
 * arc length: dense and sparse samples of the same line get the same bristles.
 * Oil/knife chunks already carry full-gesture Sample.distance from painter.ts.
 */
function strokeTrace(samples: readonly Sample[]): Sample[] {
  const first = samples[0], last = samples[samples.length - 1];
  const length = last.distance - first.distance;
  if (!(length > 1e-8)) {
    // A stationary press can change pressure without moving. Preserve contact.
    let strongest = first;
    for (const sample of samples) if (sample.pressure > strongest.pressure) strongest = sample;
    return [strongest, strongest];
  }

  // A subpixel pressure peak can sit entirely between two grid points. Keep
  // pressure turning points (including both sides of a plateau) as exact knots;
  // otherwise a 0 -> 1 -> 0 press may turn into an all-zero trace. Only these
  // features interrupt the uniform physical grid, so adding redundant constant-
  // pressure samples never changes its phase or resulting pixels.
  const extrema: Sample[] = [];
  for (let i = 1; i < samples.length - 1; i++) {
    const before = samples[i - 1].pressure, current = samples[i].pressure, after = samples[i + 1].pressure;
    if ((current > before && current >= after) || (current >= before && current > after) ||
        (current < before && current <= after) || (current <= before && current < after)) {
      extrema.push(samples[i]);
    }
  }

  // Reserve space for every input pressure extremum and both endpoints. With
  // at most 16,385 incoming samples, this also bounds the merged trace to 16,385.
  const gridBudget = 16383 - extrema.length;
  const step = gridBudget > 0 ? Math.max(1.25, length / gridBudget) : Infinity;
  const path: Sample[] = [first];
  let index = 1;
  let nextGrid = Number.isFinite(step) ? (Math.floor(first.distance / step) + 1) * step : Infinity;
  // Merge extrema into the distance-sorted grid, preferring exact input knots
  // when a regular grid point coincides with a pressure feature.
  for (let i = 0; i <= extrema.length; i++) {
    const critical = i < extrema.length ? extrema[i] : last;
    while (nextGrid < critical.distance - 1e-7 && nextGrid < last.distance - 1e-7) {
      while (index < samples.length - 1 && samples[index].distance < nextGrid) index++;
      const a = samples[index - 1], b = samples[index];
      const delta = b.distance - a.distance;
      if (delta >= 1e-8) {
        const fraction = clamp((nextGrid - a.distance) / delta);
        const x = a.x + (b.x - a.x) * fraction, y = a.y + (b.y - a.y) * fraction;
        let nx = a.nx + (b.nx - a.nx) * fraction, ny = a.ny + (b.ny - a.ny) * fraction;
        const magnitude = Math.hypot(nx, ny);
        if (magnitude < 1e-7) { nx = a.nx; ny = a.ny; }
        else { nx /= magnitude; ny /= magnitude; }
        path.push({ x, y, nx, ny, distance: nextGrid,
          t: a.t + (b.t - a.t) * fraction,
          pressure: a.pressure + (b.pressure - a.pressure) * fraction });
      }
      nextGrid += step;
    }
    if (i < extrema.length) {
      path.push(critical);
      if (Math.abs(nextGrid - critical.distance) <= 1e-7) nextGrid += step;
    }
  }
  path.push(last);
  return path;
}

/** Connected swept ribbons with arc-length anchored, grouped bristles. */
export class Rasterizer {
  private canvas: CanvasSurface;
  constructor(private factory: CanvasFactory) { this.canvas = factory(1, 1); }

  private prepare(region: Bounds): DrawingContext {
    this.canvas.width = Math.max(1, region.width); this.canvas.height = Math.max(1, region.height);
    const context = context2d(this.canvas);
    context.translate(-region.x, -region.y);
    context.fillStyle = '#ffffff'; context.strokeStyle = '#ffffff';
    context.lineJoin = 'round'; context.lineCap = 'round';
    return context;
  }

  private finish(context: DrawingContext, region: Bounds): RasterMask {
    return { data: context.getImageData(0, 0, region.width, region.height).data, region };
  }

  fill(points: readonly { x: number; y: number }[], width: number, height: number): RasterMask | null {
    const region = sampleBounds(points, 0, width, height);
    if (points.length < 3 || !region.width || !region.height) return null;
    const context = this.prepare(region);
    context.beginPath(); context.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) context.lineTo(points[i].x, points[i].y);
    context.closePath(); context.fill('evenodd');
    return this.finish(context, region);
  }

  stroke(samples: readonly Sample[], material: Material, command: StrokeCommand, width: number, height: number, seed: number, widthScale = 1): RasterMask | null {
    if (samples.length < 2 || samples.length > 16385 || !Number.isFinite(widthScale) || widthScale <= 0 ||
        samples.some((s, i) => !Number.isFinite(s.x + s.y + s.nx + s.ny + s.pressure + s.distance + s.t) ||
          s.distance < (i ? samples[i - 1].distance : -Infinity))) return null;
    const brushWidth = material.size * Math.min(width, height) * widthScale;
    if (!Number.isFinite(brushWidth) || brushWidth <= 0 || !samples.some(s => s.pressure > .002)) return null;
    const region = sampleBounds(samples, brushWidth * .67, width, height);
    if (!region.width || !region.height) return null;
    const context = this.prepare(region);
    const path = strokeTrace(samples);
    const rng = random(seed), load = clamp(material.load ?? .85), roughness = clamp(material.roughness ?? .35);
    const dry = material.medium === 'graphite' || (material.medium !== 'marker' && load < .4);
    const bristles = Math.min(128, Math.max(2, Math.floor(material.bristles ?? (material.medium === 'knife' ? 16 : material.medium === 'graphite' ? 28 : 42))));
    const tilt = clamp(command.tilt ?? 0), angle = (command.rotation ?? 0) * Math.PI / 180;
    const a = Math.cos(angle), b = Math.sin(angle);
    const noiseLength = Math.max(7, brushWidth * .7), groupLength = Math.max(9, brushWidth * 1.4);

    const radius = (s: Sample): number => {
      const nib = 1 - tilt * .55 * Math.abs(s.nx * a + s.ny * b);
      // Physical-pixel noise keeps the same frequency across resolution changes.
      return brushWidth * .5 * clamp(s.pressure) * nib * (.96 + .07 * coherent(s.distance / noiseLength, seed));
    };

    // A gate controls deposition, not the path coordinates. Its frequency is
    // independent of the number of points, and the same evaluation is used on
    // both edges, yielding coherent longitudinal dry-contact interruptions.
    const contact = (s: Sample, localSeed: number): number => {
      const depletion = 1 - (1 - load) * clamp(s.t) * .55;
      const threshold = clamp(.20 + load * depletion * .68 - roughness * .12, .1, .96);
      const grain = coherent(s.distance / Math.max(5, brushWidth * .58), localSeed + 173);
      return clamp((threshold - grain) * 7);
    };

    /** Fill a whole continuous band or a single run of bristle contact. */
    const band = (start: number, end: number, offset: number, thickness: number, localSeed: number, groupSeed: number, gated: boolean) => {
      if (end <= start) return;
      const filament = (s: Sample) => {
        const r = radius(s);
        // A bristle has a physical minimum footprint, but never at zero pressure.
        const hair = Math.min(r * .35, Math.max(.16, brushWidth * thickness)) * Math.min(1, s.pressure * 4);
        return gated ? hair * Math.sqrt(contact(s, localSeed)) : (thickness > .2 ? r * thickness : hair);
      };
      const lane = (s: Sample) => {
        const r = radius(s);
        const group = (coherent(s.distance / groupLength, groupSeed) - .5) * roughness * .16 * brushWidth;
        const individual = (coherent(s.distance / noiseLength, localSeed) - .5) * roughness * .045 * brushWidth;
        return clamp(offset * r + group + individual, -r * .94, r * .94);
      };
      context.beginPath();
      // Avoid allocating a vertex pair or a Sample[] per bristle.
      for (let k = start; k <= end; k++) {
        const s = path[k], across = lane(s) + filament(s);
        if (k === start) context.moveTo(s.x + s.nx * across, s.y + s.ny * across);
        else context.lineTo(s.x + s.nx * across, s.y + s.ny * across);
      }
      const tip = path[end], tipLane = lane(tip), tipHalf = filament(tip);
      context.quadraticCurveTo(tip.x + tip.nx * tipLane + tip.ny * tipHalf,
        tip.y + tip.ny * tipLane - tip.nx * tipHalf,
        tip.x + tip.nx * (tipLane - tipHalf), tip.y + tip.ny * (tipLane - tipHalf));
      for (let k = end - 1; k >= start; k--) {
        const s = path[k], across = lane(s) - filament(s);
        context.lineTo(s.x + s.nx * across, s.y + s.ny * across);
      }
      const head = path[start], headLane = lane(head), headHalf = filament(head);
      context.quadraticCurveTo(head.x + head.nx * headLane - head.ny * headHalf,
        head.y + head.ny * headLane + head.nx * headHalf,
        head.x + head.nx * (headLane + headHalf), head.y + head.ny * (headLane + headHalf));
      context.closePath(); context.fill();
    };

    // Subpixel presses are contact dabs, not zero-area ribbons. Choose peak
    // pressure even if both gesture endpoints are zero; do this once per tiny
    // gesture, never once per path sample or bristle.
    if (path.at(-1)!.distance - path[0].distance < 1.25) {
      let strongest = path[0];
      for (const sample of path) if (sample.pressure > strongest.pressure) strongest = sample;
      const r = radius(strongest);
      if (r > 0) { context.globalAlpha = dry ? .25 : .75 * (.5 + .5 * load); context.beginPath(); context.arc(strongest.x, strongest.y, r, 0, Math.PI * 2); context.fill(); }
      return this.finish(context, region);
    }

    const base = material.medium === 'marker' ? .9 : material.medium === 'watercolor' ? .48 : material.medium === 'knife' ? .85 : material.medium === 'oil' ? .57 : .52;
    // A faint continuous core is appropriate for loaded paint, but ruins dry graphite.
    if (!dry) { context.globalAlpha = base * (.35 + load * .55); band(0, path.length - 1, 0, .87, seed, seed, false); }
    for (let i = 0; i < bristles; i++) {
      const offset = ((i + .5) / bristles * 2 - 1) * (.91 + rng() * .06);
      const thickness = (.48 + rng() * .92) / bristles;
      const localSeed = (seed + Math.imul(i + 1, 1103)) | 0;
      const groupSeed = (seed + Math.imul(Math.floor(i / 4) + 1, 7919)) | 0;
      const gated = dry || material.medium === 'oil' || load < .7;
      context.globalAlpha = (dry ? .20 : .19) + rng() * (dry ? .67 : .52);
      if (!gated) {
        band(0, path.length - 1, offset, thickness, localSeed, groupSeed, false);
      } else {
        let begin = -1;
        for (let k = 0; k < path.length; k++) {
          const touches = path[k].pressure > .002 && contact(path[k], localSeed) > .045;
          if (touches && begin < 0) begin = k;
          if ((!touches || k === path.length - 1) && begin >= 0) {
            const end = touches ? k : k - 1;
            // Ignore isolated contact-noise dots on otherwise active dry lanes.
            // A *pressure* pulse bounded by zero pressure is different: retain
            // its tapered contact, even when the whole pulse is subpixel.
            if (path[end].distance - path[begin].distance >= 1.25) {
              band(begin, end, offset, thickness, localSeed, groupSeed, true);
            } else if ((begin === 0 || path[begin - 1].pressure <= .002) &&
                       (end === path.length - 1 || path[end + 1].pressure <= .002)) {
              band(Math.max(0, begin - 1), Math.min(path.length - 1, end + 1), offset, thickness, localSeed, groupSeed, true);
            }
            begin = -1;
          }
        }
      }
    }
    if (material.medium === 'oil' || material.medium === 'knife') {
      // Longitudinal negative-space grooves: not regularly spaced cross-stamps.
      context.globalCompositeOperation = 'destination-out';
      context.globalAlpha = material.medium === 'knife' ? .22 : .19 + roughness * .13;
      for (let i = 0; i < Math.max(2, Math.round(bristles / 7)); i++) {
        band(0, path.length - 1, rng() * 1.65 - .825, .009 + rng() * .016, seed + i * 7717, seed + i * 3319, false);
      }
    }
    return this.finish(context, region);
  }

  dispose(): void { releaseCanvas(this.canvas); }
}
