/** Real Chromium smoke/evidence for the comparison page. No third-party engine is simulated. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createSiteServer } from './serve.mjs';

const evidence = resolve('evidence/site');
await mkdir(evidence, { recursive: true });
const server = createSiteServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const url = `http://127.0.0.1:${address.port}/compare/`;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
  assert.equal(response.status(), 200, '/compare/ must resolve to the new HTML page');
  await page.locator('#hybrid-result').getByText(/Completed in/).waitFor({ timeout: 180000 });
  assert.match(await page.locator('#poiesis-result').textContent(), /Completed in/);
  assert.match(await page.locator('#reference-result').textContent(), /Completed in/);
  assert.deepEqual(errors, [], 'actual page scripts must not throw');

  const route = JSON.parse(await page.locator('#routing-log').textContent());
  assert.equal(route.selected.length, 4);
  assert.equal(route.selected.find(layer => layer.layer === 'linework').renderer, 'canvas2d-reference');
  assert.deepEqual(route.thirdPartyEnginesExecuted, []);
  assert.ok(route.selected.find(layer => layer.layer === 'atmosphere').renderer === 'poiesis');

  const evidenceFor = id => page.locator(`#${id}`).evaluate(canvas => {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let dark = 0, bright = 0, alpha = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] + data[i + 1] + data[i + 2] < 300) dark++;
      if (data[i] + data[i + 1] + data[i + 2] > 550) bright++;
      if (data[i + 3] === 255) alpha++;
    }
    return { dark, bright, alpha, width: canvas.width, height: canvas.height };
  });
  const pixels = {
    poiesis: await evidenceFor('poiesis'), reference: await evidenceFor('reference'), hybrid: await evidenceFor('hybrid'),
  };
  for (const [name, counts] of Object.entries(pixels)) {
    assert.equal(counts.alpha, counts.width * counts.height, name + ' has an opaque composited background');
    assert.ok(counts.dark > 10 && counts.bright > 10, name + ' has meaningful nonuniform pixels');
  }
  await page.screenshot({ path: resolve(evidence, 'meta-compare-desktop.png'), fullPage: true, animations: 'disabled' });
  await page.locator('#zoom').check();
  await page.locator('.paintings').screenshot({ path: resolve(evidence, 'meta-compare-2x-nearest.png'), animations: 'disabled' });
  await page.locator('#linework-engine').selectOption('poiesis');
  await page.locator('#run').click();
  await page.waitForFunction(() => {
    if (document.querySelector('#run')?.disabled) return false;
    try {
      const data = JSON.parse(document.querySelector('#routing-log')?.textContent || '{}');
      return data.selected?.find(layer => layer.layer === 'linework')?.renderer === 'poiesis';
    } catch { return false; }
  }, undefined, { timeout: 180000 });
  const reroute = JSON.parse(await page.locator('#routing-log').textContent());
  assert.equal(reroute.selected.find(layer => layer.layer === 'linework').renderer, 'poiesis');
  await writeFile(resolve(evidence, 'meta-compare-report.json'), JSON.stringify({ url, route, reroute, pixels, errors, browser: browser.version() }, null, 2));
  console.log('Comparison lab: actual Chromium completed three surfaces, route switch, raw image statistics and screenshots.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
