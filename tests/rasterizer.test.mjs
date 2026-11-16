import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createCanvas } from '@napi-rs/canvas';
import { Rasterizer } from '../dist/rasterizer.js';
import { samplePath } from '../dist/geometry.js';

const WIDTH = 240, HEIGHT = 160;
const material = { medium: 'ink', color: '#18354a', size: .11, load: .9, roughness: .55, bristles: 48 };
const command = { id: 'sample', op: 'stroke', material: 'sample', path: [[.1, .5], [.9, .5]] };
const raster = () => new Rasterizer(createCanvas);
const alpha = mask => mask ? mask.data.reduce((sum, value, index) => sum + (index % 4 === 3 ? value : 0), 0) : 0;
const line = count => Array.from({ length: count }, (_, i) => {
  const t = i / (count - 1);
  return { x: 18 + 184 * t, y: 80, pressure: .9, nx: 0, ny: 1, t, distance: 184 * t };
});

function assertInside(mask, width = WIDTH, height = HEIGHT) {
  assert.ok(mask);
  assert.ok(Number.isSafeInteger(mask.region.x) && Number.isSafeInteger(mask.region.y));
  assert.ok(mask.region.x >= 0 && mask.region.y >= 0);
  assert.ok(mask.region.width > 0 && mask.region.height > 0);
  assert.ok(mask.region.x + mask.region.width <= width);
  assert.ok(mask.region.y + mask.region.height <= height);
  assert.equal(mask.data.length, mask.region.width * mask.region.height * 4);
}

test('fixed arc-length phase makes a straight bristle mask invariant to sample density', () => {
  const r = raster();
  try {
    const sparse = r.stroke(line(2), material, command, WIDTH, HEIGHT, 19);
    const medium = r.stroke(line(9), material, command, WIDTH, HEIGHT, 19);
    const dense = r.stroke(line(185), material, command, WIDTH, HEIGHT, 19);
    assertInside(sparse);
    assert.deepEqual(medium.region, sparse.region);
    assert.deepEqual(dense.region, sparse.region);
    assert.deepEqual(medium.data, sparse.data);
    assert.deepEqual(dense.data, sparse.data);
  } finally { r.dispose(); }
});

test('repeat calls and unrelated strokes do not alter a seeded mark', () => {
  const r = raster();
  try {
    const samples = samplePath([[.05, .75, .1], [.3, .22, .8], [.55, .78, .98], [.93, .27, .14]], WIDTH, HEIGHT, 123);
    const before = r.stroke(samples, material, command, WIDTH, HEIGHT, 123);
    r.stroke(line(2), { ...material, medium: 'knife' }, command, WIDTH, HEIGHT, 999);
    const after = r.stroke(samples, material, command, WIDTH, HEIGHT, 123);
    assertInside(before);
    assert.deepEqual(before, after);
    assert.notDeepEqual(before.data, r.stroke(samples, material, command, WIDTH, HEIGHT, 124)?.data);
  } finally { r.dispose(); }
});

test('zero pressure, off-canvas, NaN and invalid width are safe no-ops', () => {
  const r = raster();
  try {
    const empty = samplePath([[.2, .5, 0], [.8, .5, 0]], WIDTH, HEIGHT, 1);
    assert.equal(r.stroke(empty, material, command, WIDTH, HEIGHT, 1), null);
    const off = samplePath([[-2, -2, 1], [-1, -1, 1]], WIDTH, HEIGHT, 1);
    assert.equal(r.stroke(off, material, command, WIDTH, HEIGHT, 1), null);
    assert.equal(r.stroke(line(2), material, command, WIDTH, HEIGHT, 1, NaN), null);
    assert.equal(r.stroke(line(2).map(s => ({ ...s, x: NaN })), material, command, WIDTH, HEIGHT, 1), null);
    assert.equal(r.stroke([], material, command, WIDTH, HEIGHT, 1), null);
  } finally { r.dispose(); }
});

test('stationary touches, tiny segments and zero-to-full ramps stay finite and visible', () => {
  const r = raster();
  try {
    for (const path of [
      [[.5, .5, 1], [.5, .5, 1]],
      [[.5, .5, 1], [.50001, .50001, 1]],
      [[.2, .5, 0], [.8, .5, 1]],
    ]) {
      const mask = r.stroke(samplePath(path, WIDTH, HEIGHT, 1), material, command, WIDTH, HEIGHT, 1);
      assertInside(mask);
      assert.ok(alpha(mask) > 0, 'invisible path ' + JSON.stringify(path));
    }
  } finally { r.dispose(); }
});

test('coverage is monotonically responsive to constant pressure', () => {
  const r = raster();
  try {
    const coverages = [.2, .5, .9].map(pressure => alpha(r.stroke(line(2).map(s => ({ ...s, pressure })), material, command, WIDTH, HEIGHT, 19)));
    assert.ok(coverages[0] > 0 && coverages[0] < coverages[1] && coverages[1] < coverages[2], String(coverages));
  } finally { r.dispose(); }
});

test('sharp turns, pressure changes and page-edge clipping produce bounded masks', () => {
  const r = raster();
  try {
    const samples = samplePath([[.05, .75, 1], [.5, .75, 1], [.5, .22, .35], [.85, .22, .9]], WIDTH, HEIGHT, 9);
    const bent = r.stroke(samples, material, command, WIDTH, HEIGHT, 19);
    assertInside(bent);
    assert.ok(alpha(bent) > 10_000);
    const partial = r.stroke(samplePath([[-.2, .5, 1], [.5, .6, .5], [1.2, .5, 1]], WIDTH, HEIGHT, 9), material, command, WIDTH, HEIGHT, 19);
    assertInside(partial);
    assert.ok(alpha(partial) > 0);
  } finally { r.dispose(); }
});

test('dry bristle contact creates coherent runs and genuine interruptions', () => {
  const r = raster();
  try {
    const dry = { ...material, medium: 'graphite', load: .18, roughness: .8 };
    const mask = r.stroke(line(2), dry, command, WIDTH, HEIGHT, 19);
    assertInside(mask);
    const touched = [];
    for (let x = 20; x < 203; x++) {
      let hit = false;
      for (let y = 66; y < 93; y++) {
        const ix = x - mask.region.x, iy = y - mask.region.y;
        if (ix >= 0 && iy >= 0 && ix < mask.region.width && iy < mask.region.height && mask.data[(iy * mask.region.width + ix) * 4 + 3] > 25) hit = true;
      }
      touched.push(hit);
    }
    let run = 0, longest = 0;
    for (const hit of touched) { run = hit ? run + 1 : 0; longest = Math.max(longest, run); }
    assert.ok(longest >= 12, 'longest dry bristle run = ' + longest);
    assert.ok(touched.includes(false), 'dry mask needs actual gaps');
    assert.ok(touched.filter(Boolean).length >= 60, 'dry contact should not dissolve into isolated stamps');
  } finally { r.dispose(); }
});

test('mark-study fixture generator emits native PNGs and nearest-neighbor crops', async () => {
  // npm run check runs this test in CI; existing workflow uploads evidence/renders/.
  const target = 'evidence/renders/mark-studies';
  execFileSync(process.execPath, ['scripts/mark-studies.mjs', target], { timeout: 60_000, stdio: 'pipe' });
  for (const name of ['contact-sheet-native.png', 'ink-loaded-native.png', 'ink-loaded-100pct.png', 'ink-loaded-4x-nearest.png', 'graphite-dry-native.png', 'manifest.json']) {
    const bytes = await readFile(target + '/' + name);
    assert.ok(bytes.length > 100, 'empty fixture ' + name);
    if (name.endsWith('.png')) assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  }
  assert.ok((await stat(target + '/contact-sheet-native.png')).size > 5000);
});

test('subpixel zero-to-full-to-zero pressure peak leaves a real deterministic mark', () => {
  // Reviewer regression: this entire 0.24px gesture falls between 1.25px grid nodes.
  const gesture = [[.5, .5, 0], [.5005, .5, 1], [.501, .5, 0]];
  const samples = samplePath(gesture, WIDTH, HEIGHT, 12);
  assert.deepEqual(samples.map(s => s.pressure), [0, 1, 0]);
  assert.ok(samples.at(-1).distance < 1.25);
  const r = raster();
  try {
    for (const medium of ['marker', 'graphite', 'oil']) {
      const pigment = { ...material, medium, load: medium === 'graphite' ? .18 : .95 };
      const mark = r.stroke(samples, pigment, command, WIDTH, HEIGHT, 12);
      assertInside(mark);
      assert.ok(alpha(mark) > 0, medium + ' lost all intermediate pressure contact');
      assert.deepEqual(r.stroke(samples, pigment, command, WIDTH, HEIGHT, 12), mark);
      const zero = samples.map(s => ({ ...s, pressure: 0 }));
      assert.equal(r.stroke(zero, pigment, command, WIDTH, HEIGHT, 12), null);
    }
  } finally { r.dispose(); }
});

test('stationary pressure pulses retain their peak instead of zero-pressure endpoints', () => {
  const r = raster();
  try {
    const gesture = [[.5, .5, 0], [.5, .5, 1], [.5, .5, 0]];
    const mask = r.stroke(samplePath(gesture, WIDTH, HEIGHT, 12),
      { ...material, medium: 'marker' }, command, WIDTH, HEIGHT, 12);
    assertInside(mask);
    assert.ok(alpha(mask) > 0);
  } finally { r.dispose(); }
});

test('interior pressure spikes and dips survive resampling without painting distant zero-pressure spans', () => {
  const r = raster();
  try {
    const ink = { ...material, medium: 'marker', load: .95 };
    const pulse = [[.1, .5, 0], [.5, .5, 0], [.5005, .5, 1], [.501, .5, 0], [.9, .5, 0]];
    const pulseMask = r.stroke(samplePath(pulse, WIDTH, HEIGHT, 12), ink, command, WIDTH, HEIGHT, 12);
    assertInside(pulseMask);
    assert.ok(alpha(pulseMask) > 0, 'subpixel pressure contact vanished inside a long stroke');
    let painted = 0;
    for (let y = 0; y < pulseMask.region.height; y++) for (let x = 0; x < pulseMask.region.width; x++) {
      if (pulseMask.data[(y * pulseMask.region.width + x) * 4 + 3] === 0) continue;
      painted++;
      assert.ok(Math.abs(x + pulseMask.region.x - 120) < 15, 'paint escaped isolated peak');
    }
    assert.ok(painted > 0);

    const constant = [[.1, .5, .9], [.9, .5, .9]];
    const notch = [[.1, .5, .9], [.5, .5, .9], [.5005, .5, 0], [.501, .5, .9], [.9, .5, .9]];
    const full = r.stroke(samplePath(constant, WIDTH, HEIGHT, 12), ink, command, WIDTH, HEIGHT, 12);
    const lowered = r.stroke(samplePath(notch, WIDTH, HEIGHT, 12), ink, command, WIDTH, HEIGHT, 12);
    assertInside(full);
    assertInside(lowered);
    assert.deepEqual(lowered.region, full.region);
    assert.ok(alpha(lowered) < alpha(full), 'subpixel pressure trough was discarded');
  } finally { r.dispose(); }
});

test('alternating pressure extrema at the maximum accepted sample count remain bounded', () => {
  const r = raster();
  try {
    const n = 16385;
    const samples = Array.from({ length: n }, (_, i) => {
      const t = i / (n - 1);
      return { x: 18 + 184 * t, y: 80, pressure: i % 2 ? 1 : 0, nx: 0, ny: 1, t, distance: 184 * t };
    });
    const mark = r.stroke(samples, { ...material, medium: 'marker', size: .02, bristles: 2 },
      command, WIDTH, HEIGHT, 12);
    assertInside(mark);
    assert.ok(alpha(mark) > 0);
  } finally { r.dispose(); }
});
