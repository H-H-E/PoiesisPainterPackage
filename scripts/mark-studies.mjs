#!/usr/bin/env node
/** Reproducible, native-pixel geometry and material contact sheet.
 * Run after npm run build: node scripts/mark-studies.mjs [output-directory]
 * npm run check also invokes this through tests/rasterizer.test.mjs, placing
 * evidence under evidence/renders/mark-studies for the existing CI artifact.
 */
import { createCanvas, ImageData } from '@napi-rs/canvas';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { Rasterizer } from '../dist/rasterizer.js';
import { samplePath } from '../dist/geometry.js';
import { MaterialSurface, createReservoir } from '../dist/materials.js';

const output = process.argv[2] || 'evidence/renders/mark-studies';
await mkdir(output, { recursive: true });
const W = 420, H = 142, SW = 900, SH = 760, seed = 120;
const paper = '#eeeae1';
const gesture = [[.06, .55, .06], [.24, .15, .88], [.43, .74, 1], [.55, .19, .25], [.70, .70, .84], [.92, .36, .06]];
const media = ['watercolor', 'ink', 'graphite', 'oil', 'knife'];
const colors = ['#416b94', '#253b52', '#383c43', '#78604c', '#596274'];
const crop = { x: 155, y: 28, width: 148, height: 88 };
const hash = buffer => createHash('sha256').update(buffer).digest('hex');
const sheet = createCanvas(SW, SH), sheetContext = sheet.getContext('2d');
sheetContext.fillStyle = paper; sheetContext.fillRect(0, 0, SW, SH);
sheetContext.fillStyle = '#344052'; sheetContext.font = '13px sans-serif';
sheetContext.fillText('Loaded 0.95', 22, 16); sheetContext.fillText('Dry 0.18', 462, 16);
const raster = new Rasterizer(createCanvas);
const fixture = { version: 1, seed, width: W, height: H, gesture,
  legend: 'Five media; same path, seed, dimensions, pressure and bristle count. Left loaded; right dry.',
  loaded: .95, dry: .18, roughness: .65, size: .13, bristles: 42, paper, crop, media };
const cases = [];
for (let row = 0; row < media.length; row++) for (let column = 0; column < 2; column++) {
  const medium = media[row], dry = column === 1, load = dry ? .18 : .95;
  const name = medium + '-' + (dry ? 'dry' : 'loaded');
  const material = { medium, color: colors[row], size: fixture.size, opacity: .93,
    load, roughness: fixture.roughness, bristles: fixture.bristles,
    wetness: medium === 'watercolor' ? .85 : medium === 'oil' || medium === 'knife' ? .65 : .1,
    granulation: medium === 'watercolor' ? .55 : .2, viscosity: .8 };
  const samples = samplePath(gesture, W, H, seed);
  const command = { id: name, op: 'stroke', material: name, path: gesture };
  const start = performance.now();
  const mask = raster.stroke(samples, material, command, W, H, seed);
  const rasterMs = performance.now() - start;
  if (!mask) throw new Error('Expected positive native mask for ' + name);
  // Paint-surface interaction is the existing implementation, not replaced by
  // this geometry workstream. Each case is isolated on the same paper.
  const surface = new MaterialSurface(W, H, { texture: .6, absorbency: .5 }, seed);
  const reservoir = medium === 'oil' || medium === 'knife' ? createReservoir(material) : undefined;
  try {
    surface.deposit(mask.data, mask.region, material, reservoir);
    if (medium === 'watercolor') surface.step(3);
    const pixels = surface.rgba();
    const film = createCanvas(W, H);
    film.getContext('2d').putImageData(new ImageData(pixels, W, H), 0, 0);
    const native = createCanvas(W, H), nctx = native.getContext('2d');
    nctx.fillStyle = paper; nctx.fillRect(0, 0, W, H); nctx.drawImage(film, 0, 0);
    const nativePNG = native.toBuffer('image/png');
    await writeFile(output + '/' + name + '-native.png', nativePNG);
    const cropNative = createCanvas(crop.width, crop.height);
    const cn = cropNative.getContext('2d');
    cn.drawImage(native, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
    const cropPNG = cropNative.toBuffer('image/png');
    await writeFile(output + '/' + name + '-100pct.png', cropPNG);
    const nearest = createCanvas(crop.width * 4, crop.height * 4);
    const nc = nearest.getContext('2d');
    nc.imageSmoothingEnabled = false;
    nc.drawImage(cropNative, 0, 0, nearest.width, nearest.height);
    await writeFile(output + '/' + name + '-4x-nearest.png', nearest.toBuffer('image/png'));
    const sheetX = 22 + column * 440, sheetY = 23 + row * 148;
    sheetContext.drawImage(native, sheetX, sheetY);
    cases.push({ name, medium, load, region: mask.region, inputSamples: samples.length,
      maskSha256: hash(Buffer.from(mask.data.buffer, mask.data.byteOffset, mask.data.byteLength)),
      nativePngSha256: hash(nativePNG), cropPngSha256: hash(cropPNG),
      rasterMs: +rasterMs.toFixed(3) });
  } finally { surface.dispose(); }
}
raster.dispose();
const sheetPNG = sheet.toBuffer('image/png');
await writeFile(output + '/contact-sheet-native.png', sheetPNG);
await writeFile(output + '/fixture.json', JSON.stringify(fixture, null, 2) + '\n');
await writeFile(output + '/manifest.json', JSON.stringify({
  outputKind: 'Actual Skia Canvas2D pixels; native PNGs and 4x nearest-neighbor copies of raw 100% crops',
  sourceCommit: process.env.GITHUB_SHA ?? null,
  platform: { node: process.version, platform: process.platform, arch: process.arch,
    cpu: os.cpus()[0]?.model ?? 'unavailable' },
  sheet: { width: SW, height: SH, pngSha256: hash(sheetPNG) },
  fixture, cases,
  limits: ['One mask per gesture; does not exercise painter.ts oil/knife chunk transitions.',
    'Single-run timings are observational, not performance comparisons.'],
}, null, 2) + '\n');
console.log('Native-pixel mark studies saved: ' + output + ' (' + cases.length + ' matched marks).');
