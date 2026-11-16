/** Original, bounded CPU field solver. No reference-engine code is incorporated.
 * Watercolor: conservative local pigment/water transport and drying.
 * Oil: ordered segment reservoir exchange and shaded thickness (not individual hairs).
 */
export interface MaterialRegion { x: number; y: number; width: number; height: number }
export interface FieldMaterial {
  medium: string;
  color: string;
  opacity?: number;
  load?: number;
  wetness?: number;
  roughness?: number;
  granulation?: number;
  viscosity?: number;
}
export interface PaintReservoir {
  /** Remaining paint, in pixel-coverage units. Infinity means a freshly loaded unlimited source. */
  remaining: number;
  capacity: number;
  color: [number, number, number];
  /** 0..1 share of carried paint acquired from the surface. */
  pickedUp: number;
}
export interface MaterialStats {
  width: number; height: number; fieldBytes: number;
  pigmentMass: number; waterMass: number; heightMass: number;
  activePixels: number; dirty: MaterialRegion | null; disposed: boolean;
}

const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const number = (x: number | undefined, fallback: number, name: string) => {
  const v = x ?? fallback;
  if (!Number.isFinite(v)) throw new TypeError(`${name} must be finite.`);
  return v;
};
function rgb(hex: string): [number, number, number] {
  const text = /^#[\da-f]{3}$/i.test(hex) ? '#' + hex.slice(1).split('').map(c => c + c).join('') : hex;
  if (!/^#[\da-f]{6}$/i.test(text)) throw new TypeError('Material color must be #rgb or #rrggbb.');
  return [parseInt(text.slice(1, 3), 16) / 255, parseInt(text.slice(3, 5), 16) / 255, parseInt(text.slice(5, 7), 16) / 255];
}
const linear = (c: number) => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
const srgb = (c: number) => c <= .0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - .055;
const absorb = (c: number) => -Math.log(Math.max(.002, linear(clamp(c))));
const reflect = (a: number) => clamp(srgb(Math.exp(-Math.max(0, a))));

/** A caller may scale capacity and remaining together to match estimated stroke area.
 * Keep the same reservoir for ordered chunks of ONE gesture. A new reservoir reloads
 * the brush; reuse across gestures to deliberately carry the acquired surface color.
 */
export function createReservoir(material: FieldMaterial): PaintReservoir {
  const load = clamp(number(material.load, 1, 'load'), 0, 2);
  return { remaining: 4096 * load, capacity: 4096, color: rgb(material.color), pickedUp: 0 };
}

/** Seven 32-bit scalar fields + one material tag: 29 bytes/pixel.
 * The lazily allocated RGBA presentation cache adds four bytes/pixel. In-place pair
 * fluxes conserve pigment mass (to Float32 precision) without a second field grid.
 * The update order alternates each step to limit directional splitting bias.
 */
export class MaterialSurface {
  readonly width: number;
  readonly height: number;
  private red: Float32Array;
  private green: Float32Array;
  private blue: Float32Array;
  private pigment: Float32Array;
  private carrier: Float32Array;
  private relief: Float32Array;
  private mobile: Float32Array;
  private tag: Uint8Array;
  private pixels: Uint8ClampedArray | null = null;
  private dirtyBox: MaterialRegion | null = null;
  private activeBox: MaterialRegion | null = null;
  private dead = false;
  private tick = 0;
  private readonly texture: number;
  private readonly absorbency: number;
  private readonly seed: number;

  constructor(width: number, height: number, paper: { texture?: number; absorbency?: number } = {}, seed = 1) {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > 33_554_432) {
      throw new RangeError('Material surface dimensions must be positive integers with at most 33,554,432 pixels.');
    }
    if (!Number.isFinite(seed)) throw new TypeError('Material seed must be finite.');
    this.width = width; this.height = height; this.seed = seed | 0;
    this.texture = clamp(number(paper.texture, .45, 'paper.texture'));
    this.absorbency = clamp(number(paper.absorbency, .55, 'paper.absorbency'));
    const n = width * height;
    this.red = new Float32Array(n); this.green = new Float32Array(n); this.blue = new Float32Array(n);
    this.pigment = new Float32Array(n); this.carrier = new Float32Array(n); this.relief = new Float32Array(n);
    this.mobile = new Float32Array(n); this.tag = new Uint8Array(n);
  }
  private alive() { if (this.dead) throw new Error('MaterialSurface was disposed. Create a new surface before painting.'); }
  private tooth(x: number, y: number): number {
    // Fixed surface-coordinate tooth; no per-stroke random texture or allocated grid.
    let h = Math.imul(x ^ this.seed, 374761393) ^ Math.imul(y + 31, 668265263);
    h = Math.imul(h ^ h >>> 13, 1274126177); h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
  }
  private union(a: MaterialRegion | null, b: MaterialRegion): MaterialRegion {
    if (!a) return { ...b };
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
  }
  private mark(region: MaterialRegion) {
    this.dirtyBox = this.union(this.dirtyBox, region);
    this.activeBox = this.union(this.activeBox, region);
  }
  private remove(i: number, amount: number) {
    const p = this.pigment[i];
    if (p <= 0 || amount <= 0) return;
    const keep = Math.max(0, 1 - amount / p);
    this.pigment[i] *= keep; this.red[i] *= keep; this.green[i] *= keep; this.blue[i] *= keep;
    this.mobile[i] = Math.max(0, this.mobile[i] - amount); this.relief[i] *= keep;
  }

  /** RGBA mask alpha is coverage. The RGB bytes of the mask are deliberately ignored.
   * Oil exchanges with the provided reservoir in two passes: collect then deposit.
   * Call with short ordered path chunks for spatially meaningful pickup/redeposition.
   * A whole-stroke mask gets averaged pickup, not bristle transport.
   */
  deposit(mask: Uint8ClampedArray, region: MaterialRegion, material: FieldMaterial, reservoir?: PaintReservoir): void {
    this.alive();
    const { x, y, width: rw, height: rh } = region;
    if (![x, y, rw, rh].every(Number.isSafeInteger) || rw < 0 || rh < 0 || mask.length !== rw * rh * 4) {
      throw new RangeError('Mask region must contain integer x/y/width/height and exactly width*height*4 RGBA bytes.');
    }
    const kind = material.medium === 'watercolor' ? 1 : (material.medium === 'oil' || material.medium === 'knife') ? 2 : material.medium === 'ink' ? 3 : material.medium === 'graphite' ? 4 : material.medium === 'marker' ? 5 : 0;
    if (!kind) throw new TypeError(`Field medium ${material.medium} is unsupported. Use watercolor, oil, knife, ink, graphite or marker.`);
    const base = rgb(material.color);
    const opacity = clamp(number(material.opacity, 1, 'opacity'));
    const load = clamp(number(material.load, 1, 'load'), 0, 2);
    const wetness = clamp(number(material.wetness, kind === 1 ? .8 : kind === 2 ? .65 : .3, 'wetness'));
    const granulation = clamp(number(material.granulation, .45, 'granulation'));
    const roughness = clamp(number(material.roughness, .35, 'roughness'));
    const viscosity = clamp(number(material.viscosity, .65, 'viscosity'));
    const x0 = Math.max(0, x), y0 = Math.max(0, y), x1 = Math.min(this.width, x + rw), y1 = Math.min(this.height, y + rh);
    if (x1 <= x0 || y1 <= y0 || opacity === 0) return;
    if (reservoir && (!Number.isFinite(reservoir.remaining) || !Number.isFinite(reservoir.capacity) || reservoir.remaining < 0 || reservoir.capacity <= 0 || reservoir.color.length !== 3 || !reservoir.color.every(v => Number.isFinite(v) && v >= 0 && v <= 1) || !Number.isFinite(reservoir.pickedUp))) {
      throw new TypeError('Reservoir needs finite nonnegative remaining paint, positive capacity, and three normalized color channels.');
    }
    let carried = 0, cr = 0, cg = 0, cb = 0;
    if (kind === 2 && reservoir) {
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
        const j = ((yy - y) * rw + xx - x) * 4, coverage = mask[j + 3] / 255 * opacity;
        if (!coverage) continue;
        const i = yy * this.width + xx;
        if ((this.tag[i] & 7) !== 2 || this.pigment[i] <= 1e-8 || this.mobile[i] <= 1e-8) continue;
        const pickup = Math.min(this.mobile[i] * .22, coverage * this.carrier[i] * (.06 + .12 * (1 - viscosity)));
        if (pickup <= 0) continue;
        const f = pickup / this.pigment[i];
        carried += pickup; cr += this.red[i] * f; cg += this.green[i] * f; cb += this.blue[i] * f;
        this.remove(i, pickup);
      }
      if (carried > 0) {
        const total = reservoir.remaining + carried;
        reservoir.color = [reflect((absorb(reservoir.color[0]) * reservoir.remaining + cr) / total), reflect((absorb(reservoir.color[1]) * reservoir.remaining + cg) / total), reflect((absorb(reservoir.color[2]) * reservoir.remaining + cb) / total)];
        reservoir.remaining = total; reservoir.pickedUp = clamp(reservoir.pickedUp + carried / Math.max(1, reservoir.capacity));
      }
    }
    const color = reservoir && kind === 2 ? reservoir.color : base;
    const ar = absorb(color[0]), ag = absorb(color[1]), ab = absorb(color[2]);
    const packed = kind | Math.round(granulation * 31) << 3;
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
      const j = ((yy - y) * rw + xx - x) * 4;
      let coverage = mask[j + 3] / 255 * opacity;
      if (coverage <= 0) continue;
      const i = yy * this.width + xx, tooth = this.tooth(xx, yy);
      const previousKind = this.tag[i] & 7;
      // Water over cured oil adheres poorly. Oil deposition seals any liquid water.
      const fixedUnderpaint = previousKind === 2 || previousKind >= 4;
      if ((kind === 1 || kind === 3) && fixedUnderpaint && this.pigment[i] > .08) coverage *= .15 + .2 * tooth;
      let amount: number;
      if (kind === 2) {
        const fullness = reservoir ? clamp(reservoir.remaining / reservoir.capacity, 0, 2) : load;
        const contact = fullness < .35 ? clamp((tooth + .3 - (.7 - fullness)) * 3) : 1;
        const flow = fullness < .35 ? Math.sqrt(fullness / .35) : 1;
        amount = coverage * contact * flow * (.13 + .5 * Math.min(1.4, fullness)) * (1 - roughness * this.texture * (1 - tooth) * .35);
        if (reservoir) amount = Math.min(amount, reservoir.remaining);
        else amount *= Math.min(1, load);
      } else if (kind === 4) {
        // Graphite catches substrate peaks. Pressure geometry is supplied by the mask.
        const contact = clamp((tooth - roughness * this.texture * .62) * (1.3 + load));
        amount = coverage * load * .75 * contact;
      } else if (kind === 5) {
        // Marker film accumulates optically at overlaps; it has no liquid solver state.
        amount = coverage * load * .58;
      } else {
        const grain = 1 + (tooth - .5) * granulation * this.texture * 1.5;
        amount = coverage * load * (kind === 1 ? .42 : .85) * Math.max(.1, grain);
      }
      if (amount <= 0) continue;
      // Explicit bounded saturation prevents overflow under repeated hostile marks.
      amount = Math.min(amount, Math.max(0, 32 - this.pigment[i]));
      if (reservoir && kind === 2) reservoir.remaining -= amount;
      this.red[i] += ar * amount; this.green[i] += ag * amount; this.blue[i] += ab * amount;
      this.pigment[i] += amount;
      // A water glaze may tint existing oil, but never remobilizes or diffuses it.
      const aqueousOnFixed = (kind === 1 || kind === 3) && fixedUnderpaint;
      if (!aqueousOnFixed) this.tag[i] = packed;
      if (aqueousOnFixed) continue;
      if (kind >= 4) { this.carrier[i] = 0; this.mobile[i] = 0; continue; }
      if (kind === 2) {
        this.relief[i] = Math.min(16, this.relief[i] + amount * (material.medium === 'knife' ? .95 : .6));
        this.carrier[i] = previousKind === 2 ? Math.max(this.carrier[i], wetness) : wetness;
        this.mobile[i] = Math.min(this.pigment[i], (previousKind === 2 ? this.mobile[i] : 0) + amount * wetness);
      } else {
        this.carrier[i] = Math.min(4, this.carrier[i] + coverage * wetness * (kind === 1 ? 1.8 : .45));
        this.mobile[i] = Math.min(this.pigment[i], this.mobile[i] + amount * wetness);
      }
    }
    this.mark({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
  }

  private transfer(a: number, b: number, amount: number) {
    if (amount <= 0 || this.pigment[a] <= 1e-9) return;
    amount = Math.min(amount, this.mobile[a], this.pigment[a] * .2, Math.max(0, 32 - this.pigment[b]));
    if (amount <= 0) return;
    const f = amount / this.pigment[a];
    const r = this.red[a] * f, g = this.green[a] * f, bl = this.blue[a] * f;
    this.red[a] -= r; this.green[a] -= g; this.blue[a] -= bl; this.pigment[a] -= amount; this.mobile[a] -= amount;
    this.red[b] += r; this.green[b] += g; this.blue[b] += bl; this.pigment[b] += amount; this.mobile[b] += amount;
    if (!(this.tag[b] & 7)) this.tag[b] = this.tag[a];
  }
  private flux(a: number, b: number) {
    const ta = this.tag[a] & 7, tb = this.tag[b] & 7;
    if (ta === 2 || tb === 2 || ta >= 4 || tb >= 4 || (ta === 0 && tb === 0)) return; // Oil is never a watercolor diffusion source/sink.
    const wa = this.carrier[a], wb = this.carrier[b];
    if (wa + wb < .00002) return;
    const isInk = ta === 3 || tb === 3;
    const coefficient = isInk ? .035 : .10;
    const d = (wa - wb) * coefficient;
    if (d > 0) {
      this.carrier[a] -= d; this.carrier[b] += d;
      this.transfer(a, b, d * this.mobile[a] / Math.max(.02, wa) * (isInk ? .2 : .65));
    } else if (d < 0) {
      this.carrier[b] += d; this.carrier[a] -= d;
      this.transfer(b, a, -d * this.mobile[b] / Math.max(.02, wb) * (isInk ? .2 : .65));
    }
    // Concentration diffusion while both cells remain wet; frozen pigment stays put.
    if (wa > .01 && wb > .01) {
      const c = (this.mobile[a] / wa - this.mobile[b] / wb) * Math.min(wa, wb) * coefficient * .08;
      if (c > 0) this.transfer(a, b, c); else this.transfer(b, a, -c);
    }
    // Wet watercolor particles preferentially lodge in low-tooth paper valleys.
    // This is pairwise mobile-pigment exchange, not pigment creation or a noise overlay.
    // Both cells must be wet; ink and already fixed pigment are unaffected.
    if (!isInk && this.texture > 0 && wa > .03 && wb > .03) {
      const grain = Math.max(this.tag[a] >>> 3, this.tag[b] >>> 3) / 31;
      if (grain > 0) {
        const ax = a % this.width, bx = b % this.width;
        const slope = this.tooth(ax, (a - ax) / this.width) - this.tooth(bx, (b - bx) / this.width);
        const shift = slope * grain * this.texture * Math.min(wa, wb) * .018;
        if (shift > 0) this.transfer(a, b, shift);
        else if (shift < 0) this.transfer(b, a, -shift);
      }
    }
  }
  /** n is a bounded number of solver updates, not seconds. Results are deterministic
   * for the same JS arithmetic and command order; no cross-device bit identity claim.
   */
  step(n: number): void {
    this.alive();
    if (!Number.isSafeInteger(n) || n < 0 || n > 512) throw new RangeError('Simulation steps must be an integer from 0 to 512.');
    if (!this.activeBox || n === 0) return;
    for (let iteration = 0; iteration < n; iteration++) {
      const a = this.activeBox;
      if (!a) break; // All remaining mobile carrier has evaporated.
      const x0 = Math.max(0, a.x - 1), y0 = Math.max(0, a.y - 1), x1 = Math.min(this.width, a.x + a.width + 1), y1 = Math.min(this.height, a.y + a.height + 1);
      const reverse = (++this.tick & 1) === 1;
      for (let yi = 0; yi < y1 - y0; yi++) {
        const y = reverse ? y1 - 1 - yi : y0 + yi;
        for (let xi = 0; xi < x1 - x0; xi++) {
          const x = reverse ? x1 - 1 - xi : x0 + xi, i = y * this.width + x;
          if (x + 1 < x1) this.flux(i, i + 1);
          if (y + 1 < y1) this.flux(i, i + this.width);
        }
      }
      let wetX0 = this.width, wetY0 = this.height, wetX1 = -1, wetY1 = -1;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = y * this.width + x, kind = this.tag[i] & 7;
        if (this.carrier[i] < 1e-7) { this.carrier[i] = 0; this.mobile[i] = 0; continue; }
        // Retain the active wet footprint, not every border visited in prior steps.
        // The next iteration adds a single-cell halo for conservative pair fluxes.
        wetX0 = Math.min(wetX0, x); wetY0 = Math.min(wetY0, y);
        wetX1 = Math.max(wetX1, x); wetY1 = Math.max(wetY1, y);
        const grain = (this.tag[i] >>> 3) / 31;
        if (kind === 2) { this.carrier[i] *= .997; this.mobile[i] *= .997; continue; }
        if (kind >= 4) { this.carrier[i] = this.mobile[i] = 0; continue; }
        const water = this.carrier[i];
        const surrounding = ((x > 0 ? this.carrier[i - 1] : water) + (x + 1 < this.width ? this.carrier[i + 1] : water) + (y > 0 ? this.carrier[i - this.width] : water) + (y + 1 < this.height ? this.carrier[i + this.width] : water)) * .25;
        const front = clamp((water - surrounding) / Math.max(.02, water));
        const loss = .018 + this.absorbency * .035 + front * .035;
        this.carrier[i] = water * (1 - loss);
        // Deposition speeds up at an evaporating front and in paper valleys.
        const settle = loss * (.6 + (1 - this.tooth(x, y)) * grain * 2.6 + front * (3 + grain)) + (water < .08 ? .1 : 0);
        this.mobile[i] = Math.max(0, Math.min(this.pigment[i], this.mobile[i] * (1 - Math.min(.7, settle))));
      }
      this.dirtyBox = this.union(this.dirtyBox, { x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
      this.activeBox = wetX1 < 0 ? null : { x: wetX0, y: wetY0, width: wetX1 - wetX0 + 1, height: wetY1 - wetY0 + 1 };
    }
  }
  /** Freeze all current pigment. Future marks cannot pick it up; pixels stay unchanged. */
  dry(): void {
    this.alive();
    if (this.pixels && this.activeBox) this.dirtyBox = this.union(this.dirtyBox, this.activeBox);
    this.carrier.fill(0); this.mobile.fill(0); this.activeBox = null;
  }

  /** Transparent layer presentation. This cache is owned by the surface; copy it if
   * retaining a snapshot across later deposit/step calls. No implicit simulation runs.
   */
  rgba(): Uint8ClampedArray {
    this.alive();
    if (!this.pixels) this.pixels = new Uint8ClampedArray(this.width * this.height * 4);
    if (!this.dirtyBox) return this.pixels;
    const d = this.dirtyBox, x0 = Math.max(0, d.x - 1), y0 = Math.max(0, d.y - 1), x1 = Math.min(this.width, d.x + d.width + 1), y1 = Math.min(this.height, d.y + d.height + 1);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = y * this.width + x, o = i * 4, p = this.pigment[i], kind = this.tag[i] & 7;
      if (p < 1e-8) { this.pixels[o] = this.pixels[o + 1] = this.pixels[o + 2] = this.pixels[o + 3] = 0; continue; }
      let shade = 1, specular = 0;
      if (kind === 2) {
        const dx = this.relief[y * this.width + Math.min(this.width - 1, x + 1)] - this.relief[y * this.width + Math.max(0, x - 1)];
        const dy = this.relief[Math.min(this.height - 1, y + 1) * this.width + x] - this.relief[Math.max(0, y - 1) * this.width + x];
        const normal = 1 / Math.sqrt(dx * dx + dy * dy + 1);
        const diffuse = (-dx * -.45 - dy * -.6 + .66) * normal;
        // Height gradients control the broad highlight, while fixed paper tooth
        // perturbs thin ridges. Wet binder is glossier; dry() invalidates that region.
        const height = this.relief[i], gloss = clamp(this.carrier[i]);
        const microRelief = (this.tooth(x, y) - .5) * this.texture * Math.min(.1, height * .12);
        shade = clamp(.91 + .16 * diffuse + microRelief, .72, 1.2);
        specular = Math.max(0, diffuse - .6) ** 2 * (.09 + .4 * gloss) + .028 * gloss * clamp(height * .5);
      }
      const alpha = (1 - Math.exp(-p * (kind === 1 ? 1.8 : kind === 2 ? 5 : kind === 5 ? 1.8 : kind === 4 ? 3.2 : 3.5))) * 255;
      if (alpha < .5) { this.pixels[o] = this.pixels[o + 1] = this.pixels[o + 2] = this.pixels[o + 3] = 0; continue; }
      this.pixels[o] = clamp(reflect(this.red[i] / p) * shade + specular) * 255;
      this.pixels[o + 1] = clamp(reflect(this.green[i] / p) * shade + specular) * 255;
      this.pixels[o + 2] = clamp(reflect(this.blue[i] / p) * shade + specular) * 255;
      this.pixels[o + 3] = alpha;
    }
    this.dirtyBox = null;
    return this.pixels;
  }
  stats(): MaterialStats {
    let pigmentMass = 0, waterMass = 0, heightMass = 0, activePixels = 0;
    for (let i = 0; i < this.pigment.length; i++) {
      pigmentMass += this.pigment[i]; waterMass += this.carrier[i]; heightMass += this.relief[i];
      if (this.pigment[i] > 1e-7) activePixels++;
    }
    return { width: this.width, height: this.height, fieldBytes: this.pigment.byteLength * 7 + this.tag.byteLength + (this.pixels?.byteLength ?? 0), pigmentMass, waterMass, heightMass, activePixels, dirty: this.dirtyBox ? { ...this.dirtyBox } : null, disposed: this.dead };
  }
  dispose(): void {
    if (this.dead) return;
    this.dead = true;
    this.red = this.green = this.blue = this.pigment = this.carrier = this.relief = this.mobile = new Float32Array(0);
    this.tag = new Uint8Array(0); this.pixels = null; this.dirtyBox = this.activeBox = null;
  }
}
