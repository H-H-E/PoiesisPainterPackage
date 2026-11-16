import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createSiteServer } from './serve.mjs';

const evidence = resolve('evidence/site');
await mkdir(evidence, { recursive: true });
const server = createSiteServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const base = 'http://127.0.0.1:' + port + '/';
const browser = await chromium.launch({ headless: true });
const checks = [];
const errors = [];
const record = label => { checks.push(label); console.log('PASS ' + label); };
const digest = async page => {
  const png = await page.locator('#play-canvas').evaluate(canvas => canvas.toDataURL('image/png'));
  return createHash('sha256').update(png).digest('hex');
};
const waitRendered = page => page.waitForFunction(() => {
  const status = document.getElementById('play-status');
  const render = document.getElementById('render-button');
  return status && status.textContent.startsWith('Rendered ') && !render.disabled;
}, null, { timeout: 120000 });
const checkOverflow = page => page.evaluate(() => ({
  viewport: innerWidth,
  documentWidth: document.documentElement.scrollWidth
}));
try {
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  desktop.on('pageerror', error => errors.push('desktop: ' + error.message));
  await desktop.goto(base, { waitUntil: 'load' });
  assert.match(await desktop.title(), /Poiesis Painter/);
  assert.equal(await desktop.locator('#workbench').isVisible(), false, 'heavy playground not eagerly shown');
  await desktop.waitForFunction(() => document.getElementById('hero-preview')?.dataset.rendered === 'true', null, { timeout: 120000 });
  const preview = await desktop.locator('#hero-preview').evaluate(canvas => {
    const bytes = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let varied = false;
    for (let i = 4; i < bytes.length; i += 4) if (bytes[i] !== bytes[0] || bytes[i+1] !== bytes[1] || bytes[i+2] !== bytes[2]) { varied = true; break; }
    return varied;
  });
  assert.equal(preview, true, 'real hero pixels must not be a solid placeholder');
  await desktop.screenshot({ path: resolve(evidence, 'landing-desktop.png'), animations: 'disabled' });
  record('static landing loads and the package renders a nonblank real hero preview');
  const desktopOverflow = await checkOverflow(desktop);
  assert.ok(desktopOverflow.documentWidth <= desktopOverflow.viewport + 1, JSON.stringify(desktopOverflow));
  record('desktop landing fits viewport');

  await desktop.locator('[data-open-playground]').first().click();
  await desktop.locator('#workbench').waitFor({ state: 'visible', timeout: 120000 });
  await waitRendered(desktop);
  assert.deepEqual(await desktop.locator('#play-canvas').evaluate(canvas => [canvas.width, canvas.height]), [480, 320]);
  let original = await digest(desktop);
  await desktop.locator('#render-button').click();
  await waitRendered(desktop);
  assert.equal(await digest(desktop), original);
  record('playground loads lazily, integrates real Painter and repeats same-score pixels');
  await desktop.locator('#seed-input').fill('99');
  await desktop.locator('#apply-seed').click();
  await waitRendered(desktop);
  let seeded = await digest(desktop);
  assert.notEqual(seeded, original, 'different seed changes painting');
  let good = JSON.parse(await desktop.locator('#score-editor').inputValue());
  assert.equal(good.seed, 99);
  record('seed controls change the document and produce a new native render');

  const editor = desktop.locator('#score-editor');
  await editor.fill('{not valid JSON');
  await desktop.locator('#render-button').click();
  assert.equal(await editor.getAttribute('aria-invalid'), 'true');
  assert.match(await desktop.locator('#validation-note').innerText(), /issue/);
  assert.equal(await digest(desktop), seeded);
  record('invalid JSON shows inline repair and preserves committed pixels');

  const invalid = structuredClone(good);
  invalid.layers[0].commands.push({ id: 'unresolved', op: 'stroke', material: 'not-defined', path: [[0.1,0.1],[0.5,0.5]] });
  await editor.fill(JSON.stringify(invalid));
  await desktop.locator('#validate-button').click();
  assert.match(await desktop.locator('#validation-list').innerText(), /material|not defined/);
  assert.equal(await digest(desktop), seeded);
  record('schema errors show specific missing material and preserve image');

  const oversized = structuredClone(good);
  oversized.width = 1024;
  await editor.fill(JSON.stringify(oversized));
  await desktop.locator('#render-button').click();
  assert.match(await desktop.locator('#validation-list').innerText(), /playground limit/);
  assert.equal(await digest(desktop), seeded);
  record('oversized valid score rejected by separate playground budget');

  await editor.fill(JSON.stringify(good));
  await editor.press('ControlOrMeta+Enter');
  await waitRendered(desktop);
  assert.equal(await digest(desktop), seeded);
  record('keyboard rendering recovers exact pixels after bad edits');

  await desktop.locator('#material-select').selectOption('sky');
  await desktop.locator('#medium-select').selectOption('ink');
  assert.match(await desktop.locator('#draft-indicator').innerText(), /Unrendered/);
  await desktop.locator('#render-button').click();
  await waitRendered(desktop);
  const changed = await digest(desktop);
  assert.notEqual(changed, seeded);
  good = JSON.parse(await editor.inputValue());
  assert.equal(good.materials.sky.medium, 'ink');
  record('supported material selector edits JSON and changes the actual render');

  const pngEvent = desktop.waitForEvent('download');
  await desktop.locator('#download-png').click();
  const png = await pngEvent;
  assert.match(png.suggestedFilename(), /\.png$/);
  await png.saveAs(resolve(evidence, 'playground-painting.png'));
  assert.ok((await stat(resolve(evidence, 'playground-painting.png'))).size > 800);
  const scoreEvent = desktop.waitForEvent('download');
  await desktop.locator('#download-score').click();
  const scoreDownload = await scoreEvent;
  assert.match(scoreDownload.suggestedFilename(), /\.json$/);
  await scoreDownload.saveAs(resolve(evidence, 'playground-score.json'));
  const exported = JSON.parse(await readFile(resolve(evidence, 'playground-score.json'), 'utf8'));
  assert.equal(exported.seed, 99);
  assert.equal(exported.materials.sky.medium, 'ink');
  record('PNG and exact successfully rendered JSON score download as real files');

  await desktop.locator('[data-scene="ink"]').click();
  await waitRendered(desktop);
  assert.equal(await desktop.locator('#scene-select').inputValue(), 'ink');
  record('gallery cards navigate to a live editable example');
  await desktop.locator('#playground').screenshot({ path: resolve(evidence, 'playground-desktop.png'), animations: 'disabled' });

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const mobile = await mobileContext.newPage();
  mobile.on('pageerror', error => errors.push('mobile: ' + error.message));
  await mobile.goto(base, { waitUntil: 'load' });
  const mWidth = await checkOverflow(mobile);
  assert.ok(mWidth.documentWidth <= mWidth.viewport + 1, 'mobile horizontal overflow: ' + JSON.stringify(mWidth));
  await mobile.screenshot({ path: resolve(evidence, 'landing-mobile.png'), animations: 'disabled' });
  await mobile.locator('[data-open-playground]').first().tap();
  await mobile.locator('#workbench').waitFor({ state: 'visible', timeout: 120000 });
  await waitRendered(mobile);
  const mobileWidth = await checkOverflow(mobile);
  assert.ok(mobileWidth.documentWidth <= mobileWidth.viewport + 1, 'mobile workbench overflow: ' + JSON.stringify(mobileWidth));
  assert.ok(await mobile.locator('#render-button').isVisible());
  await mobile.locator('#playground').screenshot({ path: resolve(evidence, 'playground-mobile.png'), animations: 'disabled' });
  record('touch/mobile layout, working canvas and responsive controls without sideways overflow');
  await mobileContext.close();

  assert.deepEqual(errors, [], 'browser JavaScript errors');
  record('no uncaught page errors');
  await writeFile(resolve(evidence, 'report.json'), JSON.stringify({
    kind: 'actual Chromium browser execution',
    browser: browser.version(),
    desktop: { width: 1440, height: 900 },
    mobile: { width: 390, height: 844, touch: true },
    checks,
    errors,
    pixels: { original, seeded, materialChanged: changed },
    generatedAt: new Date().toISOString()
  }, null, 2) + '\n');
  console.log('Site browser test complete; evidence/site populated.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
