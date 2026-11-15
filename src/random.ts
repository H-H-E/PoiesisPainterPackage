/** Stable seed derivation keeps unrelated ID insertions from changing existing marks. */
export function hashSeed(seed: number, text: string): number {
  let h = (seed ^ 2166136261) >>> 0;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h;
}

export function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let x = state;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (value: number, low = 0, high = 1): number => Math.max(low, Math.min(high, value));

/** Smooth, deterministic one-dimensional noise; no per-stamp randomness. */
export function coherent(t: number, seed: number): number {
  const i = Math.floor(t), f = t - i, u = f * f * (3 - 2 * f);
  const value = (k: number) => {
    let x = Math.imul((k ^ seed) >>> 0, 0x45d9f3b);
    x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
    return ((x ^ (x >>> 16)) >>> 0) / 4294967295;
  };
  return value(i) * (1 - u) + value(i + 1) * u;
}
