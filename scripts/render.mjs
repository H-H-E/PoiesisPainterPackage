import { createCanvas } from '@napi-rs/canvas';
import { writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Painter } from '../dist/index.js';
import { createScene, sceneNames } from '../examples/scenes.mjs';

const arguments_ = process.argv.slice(2);
const option = (name, fallback) => { const index = arguments_.indexOf(name); return index < 0 ? fallback : arguments_[index + 1]; };
const chosen = option('--scene', 'all'), width = Number(option('--width', 1152)), height = Number(option('--height', 768));
const out = option('--out', 'evidence/renders');
await mkdir(out, { recursive: true });
const manifest = { createdAt: new Date().toISOString(), renderer: '@napi-rs/canvas native Skia (CPU); not a browser measurement', width, height, renders: [] };
for (const name of chosen === 'all' ? sceneNames : [chosen]) {
  const canvas = createCanvas(width, height), painter = new Painter(canvas, { canvasFactory: createCanvas });
  const score = createScene(name, width, height), start = performance.now();
  const report = await painter.render(score);
  const renderMs = performance.now() - start, exportStarted = performance.now(), png = canvas.toBuffer('image/png'), exportMs = performance.now() - exportStarted;
  const path = `${out}/${name}-${width}x${height}.png`;
  await writeFile(path, png);
  const crop = painter.crop({ x: Math.floor(width * .56), y: Math.floor(height * .56), width: Math.min(240, Math.floor(width * .3)), height: Math.min(180, Math.floor(height * .3)) });
  await writeFile(`${out}/${name}-crop-100pct.png`, crop.toBuffer('image/png'));
  const enlarged = painter.crop({ x: Math.floor(width * .56), y: Math.floor(height * .56), width: Math.min(240, Math.floor(width * .3)), height: Math.min(180, Math.floor(height * .3)), scale: 3 });
  await writeFile(`${out}/${name}-crop-3x-nearest.png`, enlarged.toBuffer('image/png'));
  await writeFile(`${out}/${name}-score.json`, painter.serialize(true) + '\n');
  manifest.renders.push({ name, path, renderMs, exportMs, pngBytes: png.length, sha256: createHash('sha256').update(png).digest('hex'), report, processMemoryAfter: process.memoryUsage() });
  console.log(`${name}: ${width}x${height}, ${renderMs.toFixed(1)} ms render, ${exportMs.toFixed(1)} ms PNG, ${report.marks} marks`);
  painter.dispose();
}
await writeFile(`${out}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
