import type { GesturePoint, Point, Intent, Material, FamilyCommand, StrokeCommand } from './types.generated.js';
import { clamp, random, hashSeed, coherent } from './random.js';

export interface Sample { x: number; y: number; pressure: number; nx: number; ny: number; t: number; distance: number }
export interface Bounds { x: number; y: number; width: number; height: number }
export interface ResolvedIntent { pressureScale: number; widthScale: number; opacityScale: number; tremor: number; speedScale: number; explanation: string[] }

export function resolveIntent(material: Material, intent: Intent = {}): ResolvedIntent {
  const force = intent.force ?? .5, restraint = intent.restraint ?? 0, hesitation = intent.hesitation ?? 0;
  return {
    pressureScale: .65 + force * .7,
    widthScale: (1 - restraint * .38) * (.85 + force * .3),
    opacityScale: 1 - restraint * .42,
    tremor: hesitation * material.size * .13,
    speedScale: 1 - hesitation * .6,
    explanation: [
      `force ${force.toFixed(2)} scales pressure by ${(.65 + force * .7).toFixed(2)}`,
      `restraint ${restraint.toFixed(2)} narrows the contact and reduces deposition`,
      `hesitation ${hesitation.toFixed(2)} adds correlated transverse motion and lowers effective speed`,
    ],
  };
}

/** Centripetal Catmull–Rom with chord subdivision, clamped pressure and bounded vertex count. */
export function samplePath(path: readonly GesturePoint[], width: number, height: number, seed = 0, intent?: ResolvedIntent): Sample[] {
  const points = path.map(p => ({ x: p[0] * width, y: p[1] * height, p: p[2] ?? 1 }));
  const sampled: Sample[] = [];
  const spacing = Math.max(.8, Math.min(width, height) / 640);
  const maxPerSegment = Math.max(1, Math.floor(16384 / Math.max(1, points.length - 1)));
  let distance = 0;
  for (let segment = 0; segment < points.length - 1; segment++) {
    const b = points[segment], c = points[segment + 1];
    const a = segment > 0 ? points[segment - 1] : { x: b.x * 2 - c.x, y: b.y * 2 - c.y, p: b.p };
    const d = segment + 2 < points.length ? points[segment + 2] : { x: c.x * 2 - b.x, y: c.y * 2 - b.y, p: c.p };
    const t0 = 0, t1 = Math.max(1e-4, Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y)));
    const t2 = t1 + Math.max(1e-4, Math.sqrt(Math.hypot(c.x - b.x, c.y - b.y)));
    const t3 = t2 + Math.max(1e-4, Math.sqrt(Math.hypot(d.x - c.x, d.y - c.y)));
    const interpolate = (axis: 'x' | 'y', t: number) => {
      const u = t1 + (t2 - t1) * t;
      const mix = (v: number, w: number, lo: number, hi: number) => ((hi - u) * v + (u - lo) * w) / (hi - lo);
      const a1 = mix(a[axis], b[axis], t0, t1), a2 = mix(b[axis], c[axis], t1, t2), a3 = mix(c[axis], d[axis], t2, t3);
      return mix(mix(a1, a2, t0, t2), mix(a2, a3, t1, t3), t1, t2);
    };
    const steps = Math.min(maxPerSegment, Math.max(1, Math.ceil(Math.hypot(c.x - b.x, c.y - b.y) / spacing)));
    for (let j = 0; j < steps; j++) {
      const t = j / steps;
      const x = interpolate('x', t), y = interpolate('y', t);
      const previous = sampled.at(-1);
      if (previous) distance += Math.hypot(x - previous.x, y - previous.y);
      sampled.push({ x, y, pressure: clamp((b.p * (1 - t) + c.p * t) * (intent?.pressureScale ?? 1)), nx: 0, ny: 0, t: 0, distance });
    }
  }
  const last = points.at(-1)!;
  const previous = sampled.at(-1)!;
  distance += Math.hypot(last.x - previous.x, last.y - previous.y);
  sampled.push({ x: last.x, y: last.y, pressure: clamp(last.p * (intent?.pressureScale ?? 1)), nx: 0, ny: 0, t: 1, distance });
  for (let i = 0; i < sampled.length; i++) {
    const p = sampled[i], before = sampled[Math.max(0, i - 1)], after = sampled[Math.min(sampled.length - 1, i + 1)];
    const dx = after.x - before.x, dy = after.y - before.y, length = Math.hypot(dx, dy);
    p.nx = length > 1e-9 ? -dy / length : 0;
    p.ny = length > 1e-9 ? dx / length : 1;
    p.t = distance > 1e-9 ? p.distance / distance : i / (sampled.length - 1);
    const tremor = (intent?.tremor ?? 0) * Math.min(width, height) * (coherent(p.t * 19, seed) - .5);
    p.x += p.nx * tremor; p.y += p.ny * tremor;
  }
  return sampled;
}

export function sampleBounds(samples: readonly { x: number; y: number }[], radius: number, width: number, height: number): Bounds {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const p of samples) { left = Math.min(left, p.x); top = Math.min(top, p.y); right = Math.max(right, p.x); bottom = Math.max(bottom, p.y); }
  const x = clamp(Math.floor(left - radius - 2), 0, width), y = clamp(Math.floor(top - radius - 2), 0, height);
  return { x, y, width: Math.max(0, clamp(Math.ceil(right + radius + 2), 0, width) - x), height: Math.max(0, clamp(Math.ceil(bottom + radius + 2), 0, height) - y) };
}

/** Even/odd scan-line intersections handle concave polygons without painting outside them. */
export function hatchSegments(polygon: readonly Point[], spacing: number, angle: number): [Point, Point][] {
  const radians = angle * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians);
  const rotated = polygon.map(([x, y]) => [x * cos + y * sin, -x * sin + y * cos] as Point);
  const min = Math.min(...rotated.map(p => p[1])), max = Math.max(...rotated.map(p => p[1]));
  const inverse = (x: number, y: number): Point => [x * cos - y * sin, x * sin + y * cos];
  const lines: [Point, Point][] = [];
  for (let y = Math.ceil(min / spacing) * spacing; y < max; y += spacing) {
    const hits: number[] = [];
    for (let i = 0; i < rotated.length; i++) {
      const a = rotated[i], b = rotated[(i + 1) % rotated.length];
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) hits.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
    }
    hits.sort((a, b) => a - b);
    for (let i = 0; i + 1 < hits.length; i += 2) lines.push([inverse(hits[i], y), inverse(hits[i + 1], y)]);
  }
  return lines;
}

export function expandFamily(command: FamilyCommand, seed: number): StrokeCommand[] {
  const rng = random(hashSeed(seed, command.id));
  return Array.from({ length: command.count }, (_, index) => {
    const t = command.count === 1 ? 0 : index / (command.count - 1);
    const dx = command.spread[0] * t, dy = command.spread[1] * t;
    const phaseX = (rng() - .5) * command.jitter, phaseY = (rng() - .5) * command.jitter;
    const pressure = .8 + rng() * .4;
    const path = command.path.map(([x, y, p = 1]) => [x + dx + phaseX, y + dy + phaseY, clamp(p * pressure)] as GesturePoint);
    return { op: 'stroke', id: `${command.id}:${index}`, material: command.material, path: path as StrokeCommand['path'], intent: command.intent };
  });
}
