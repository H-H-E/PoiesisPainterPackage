#!/usr/bin/env node
/** Isolated process: module imports and first render are not warm-trial samples. */
import { fixtureDefinitions, makeFixture } from './fixtures.mjs';

const fixtureId = process.argv[2];
const smoke = process.argv.includes('--smoke');
const spec = fixtureDefinitions(smoke).find(fixture => fixture.id === fixtureId);
if (!spec) throw new Error(`Unknown cold-probe fixture ${fixtureId}`);
const beforeImports = performance.now();
const [{ createCanvas }, { Painter }] = await Promise.all([
  import('@napi-rs/canvas'), import('../dist/index.js'),
]);
const afterImports = performance.now();
const doc = makeFixture(spec), canvas = createCanvas(spec.width, spec.height);
const painter = new Painter(canvas, { canvasFactory: createCanvas, historyLimit: 0 });
try {
  const begin = performance.now();
  const report = await painter.render(doc);
  process.stdout.write(JSON.stringify({
    dynamicImportMs: afterImports - beforeImports,
    firstRenderMs: performance.now() - begin,
    firstRenderReport: report,
    note: 'Fresh Node process; dynamic imports exclude some Node bootstrap/ESM initialization.',
  }));
} finally {
  painter.dispose();
}
