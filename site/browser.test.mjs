import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createSiteServer } from './serve.mjs';
import { compilePlan } from './ai-plan.mjs';

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
  const mockPlan = { landscape:'estuary', lighting:'dawn', weather:'mist', palette:'cool', focal:'boat', placement:'center', accent:'ochre', density:'sparse' };
  let failPrompt = false;
  let promptApiPosts = 0;
  await desktop.route('**/api/paint', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({enabled:true,model:'nvidia/nemotron-3.5-lightning-free',experimental:true})});
      return;
    }
    promptApiPosts++;
    const body = route.request().postDataJSON();
    const score = failPrompt ? {version:'wrong'} : compilePlan(mockPlan,body.seed);
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({score,plan:mockPlan,model:'nvidia/nemotron-3.5-lightning-free',attempts:1})});
  });
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
  await desktop.locator('#reset-button').click();
  await waitRendered(desktop);
  const resetScore = JSON.parse(await editor.inputValue());
  assert.equal(resetScore.seed, 97);
  assert.equal(resetScore.materials.sky.medium, 'watercolor');
  assert.equal(await digest(desktop), original);
  record('reset restores original seeded example and exact original pixels');

  await desktop.locator('[data-scene="ink"]').click();
  await waitRendered(desktop);
  assert.equal(await desktop.locator('#scene-select').inputValue(), 'ink');
  record('gallery cards navigate to a live editable example');
  await desktop.locator('#playground').screenshot({ path: resolve(evidence, 'playground-desktop.png'), animations: 'disabled' });

  const landscapeIds = ['estuary', 'valley', 'headland', 'alpine', 'marsh', 'desert'];
  assert.equal(await desktop.locator('.landscape-card').count(), landscapeIds.length);
  for (const id of landscapeIds) {
    const canvas = desktop.locator('#preview-gen-' + id);
    await canvas.scrollIntoViewIfNeeded();
    await desktop.waitForFunction(id => document.getElementById('preview-gen-' + id)?.dataset.rendered === 'true', id, { timeout: 180000 });
  }
  await desktop.locator('#landscape-collection').screenshot({ path: resolve(evidence, 'landscape-collection-desktop.png'), animations: 'disabled' });
  record('six procedural landscapes all paint with real package pixels in the gallery');

  await desktop.locator('[data-scene="gen-estuary"]').click();
  await waitRendered(desktop);
  assert.equal(await desktop.locator('#scene-select').inputValue(), 'gen-estuary');
  assert.equal(await desktop.locator('#variation-button').isEnabled(), true);
  const genOriginal = JSON.parse(await editor.inputValue());
  const genHash = await digest(desktop);
  assert.equal(genOriginal.seed, 1829);
  assert.ok(genOriginal.layers.some(layer => layer.commands.some(command => command.op === 'stroke')));
  await desktop.locator('#variation-button').click();
  await waitRendered(desktop);
  const genNext = JSON.parse(await editor.inputValue());
  assert.equal(genNext.seed, 1830);
  assert.notDeepEqual(genNext.layers, genOriginal.layers, 'new seed re-composes the landscape');
  assert.notEqual(await digest(desktop), genHash);
  record('variation button changes both geometry and rendered painting');

  await desktop.locator('#seed-input').fill('42');
  await desktop.locator('#apply-seed').click();
  await waitRendered(desktop);
  const genChosen = JSON.parse(await editor.inputValue());
  assert.equal(genChosen.seed, 42);
  assert.notDeepEqual(genChosen.layers, genNext.layers, 'manual seed re-composes the landscape');
  const manualHash = await digest(desktop);
  await desktop.locator('#render-button').click();
  await waitRendered(desktop);
  assert.equal(await digest(desktop), manualHash);
  const genScoreEvent = desktop.waitForEvent('download');
  await desktop.locator('#download-score').click();
  const genScore = await genScoreEvent;
  await genScore.saveAs(resolve(evidence, 'landscape-estuary-score.json'));
  assert.deepEqual(JSON.parse(await readFile(resolve(evidence, 'landscape-estuary-score.json'), 'utf8')), genChosen);
  const genPngEvent = desktop.waitForEvent('download');
  await desktop.locator('#download-png').click();
  const genPng = await genPngEvent;
  await genPng.saveAs(resolve(evidence, 'landscape-estuary.png'));
  assert.ok((await stat(resolve(evidence, 'landscape-estuary.png'))).size > 800);
  await desktop.locator('#playground').screenshot({ path: resolve(evidence, 'landscape-editor-desktop.png'), animations: 'disabled' });
  record('manual generative seed gives repeatable pixels, with exact PNG and score exports');

  await desktop.locator('[data-scene="gen-desert"]').click();
  await waitRendered(desktop);
  assert.equal(await desktop.locator('#scene-select').inputValue(), 'gen-desert');
  assert.equal(JSON.parse(await editor.inputValue()).seed, 9018);
  await desktop.locator('#reset-button').click();
  await waitRendered(desktop);
  assert.equal(JSON.parse(await editor.inputValue()).seed, 9018);
  record('distinct landscape designs can be selected and reset to their curated seed');

  // Synthetic PageTransitionEvents verify the branch; they do NOT prove BFCache.
  const beforeHistoryScore = JSON.parse(await editor.inputValue());
  const beforeHistoryPixels = await digest(desktop);
  await desktop.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await desktop.locator('#render-button').click();
  await waitRendered(desktop);
  assert.equal(await digest(desktop), beforeHistoryPixels);
  assert.deepEqual(JSON.parse(await editor.inputValue()), beforeHistoryScore);
  record('synthetic persisted pagehide/pageshow retains a usable Painter and exact pixels');

  // Actual navigation away and browser Back (not a synthetic event).
  // Playwright can interfere with bfcache, so capture pageshow.persisted.
  await desktop.evaluate(() => {
    window.__historyProbe = { token: 'live-painter', shows: [], hides: [] };
    window.addEventListener('pageshow', event => window.__historyProbe?.shows.push(event.persisted));
    window.addEventListener('pagehide', event => window.__historyProbe?.hides.push(event.persisted));
  });
  await desktop.goto(base + 'away.html', { waitUntil: 'load' });
  assert.match(await desktop.title(), /History navigation test/);
  await desktop.goBack({ waitUntil: 'domcontentloaded', timeout: 120000 });
  const historyProbe = await desktop.evaluate(() => window.__historyProbe || null);
  const actuallyRestoredFromBFCache = !!historyProbe?.shows?.includes(true);
  if (actuallyRestoredFromBFCache) {
    assert.equal(await digest(desktop), beforeHistoryPixels, 'cached page retains canvas pixels');
    assert.deepEqual(JSON.parse(await editor.inputValue()), beforeHistoryScore, 'cached page retains edited score');
    record('actual Chromium back-forward cache restored live score and pixels');
  } else {
    record('real browser Back succeeded; actual bfcache restoration NOT observed');
    await desktop.locator('[data-open-playground]').first().click();
    await desktop.locator('#workbench').waitFor({ state: 'visible', timeout: 120000 });
    await waitRendered(desktop);
  }
  const afterBack = desktop.locator('#score-editor');
  const documentAfterBack = JSON.parse(await afterBack.inputValue());
  documentAfterBack.seed = (documentAfterBack.seed + 1) >>> 0;
  await afterBack.fill(JSON.stringify(documentAfterBack));
  await desktop.locator('#render-button').click();
  await waitRendered(desktop);
  assert.equal(JSON.parse(await afterBack.inputValue()).seed, documentAfterBack.seed);
  const backPNGEvent = desktop.waitForEvent('download');
  await desktop.locator('#download-png').click();
  const backPNG = await backPNGEvent;
  await backPNG.saveAs(resolve(evidence, 'after-browser-back.png'));
  assert.ok((await stat(resolve(evidence, 'after-browser-back.png'))).size > 800);
  const backJSONEvent = desktop.waitForEvent('download');
  await desktop.locator('#download-score').click();
  const backJSON = await backJSONEvent;
  await backJSON.saveAs(resolve(evidence, 'after-browser-back.json'));
  assert.equal(JSON.parse(await readFile(resolve(evidence, 'after-browser-back.json'), 'utf8')).seed, documentAfterBack.seed);
  record('real Back navigation supports editing, rendering and PNG/JSON exports');

  // Browser UI uses a deterministic mocked Gateway response; no real provider call.
  await desktop.locator('#prompt-to-paint').scrollIntoViewIfNeeded();
  await desktop.waitForFunction(() => !document.getElementById('ai-submit').disabled, null, { timeout: 20000 });
  await desktop.locator('#ai-description').fill('A lonely boat on a misty coast at dawn, with soft blue water');
  await desktop.locator('#ai-seed').fill('104');
  await desktop.locator('#ai-submit').click();
  await desktop.waitForFunction(() => document.getElementById('ai-status')?.textContent?.startsWith('Scene painted'), null, {timeout:120000});
  assert.equal(await desktop.locator('#scene-select').inputValue(),'prompt');
  const promptScore = JSON.parse(await desktop.locator('#score-editor').inputValue());
  assert.equal(promptScore.seed,104);
  assert.ok(promptScore.layers.some(l => l.commands.some(c => c.id?.startsWith('ai-'))));
  const promptPixels = await digest(desktop);
  await desktop.locator('#render-button').click();
  await waitRendered(desktop);
  assert.equal(await digest(desktop),promptPixels,'prompted painting rerenders exactly');
  const promptExport = desktop.waitForEvent('download');
  await desktop.locator('#download-score').click();
  const promptFile = await promptExport;
  await promptFile.saveAs(resolve(evidence,'prompt-painting-score.json'));
  assert.deepEqual(JSON.parse(await readFile(resolve(evidence,'prompt-painting-score.json'),'utf8')),promptScore);
  await desktop.locator('#prompt-to-paint').screenshot({path:resolve(evidence,'prompt-panel-desktop.png'),animations:'disabled'});
  assert.equal(promptApiPosts,1);
  const promptPNGDownload = desktop.waitForEvent('download');
  await desktop.locator('#download-png').click();
  const promptPNG = await promptPNGDownload;
  await promptPNG.saveAs(resolve(evidence,'prompt-painting.png'));
  assert.ok((await stat(resolve(evidence,'prompt-painting.png'))).size > 800);
  record('mocked Gateway prompt becomes editable deterministic Painter JSON and exports');
  await desktop.locator('#ai-repaint').click();
  await desktop.waitForFunction(() => document.getElementById('ai-status')?.textContent?.startsWith('New variation painted'),null,{timeout:120000});
  const locallyVaried = JSON.parse(await desktop.locator('#score-editor').inputValue());
  const variedPixels = await digest(desktop);
  assert.equal(locallyVaried.seed,105);
  assert.notEqual(variedPixels,promptPixels);
  assert.equal(promptApiPosts,1,'seed-only variation cannot invoke Gateway');
  record('local variation changes pixels and score with zero additional Gateway calls');
  // Invalid server payload must not replace the completed painting.
  failPrompt = true;
  await desktop.locator('#ai-submit').click();
  await desktop.waitForFunction(() => document.getElementById('ai-status')?.getAttribute('role') === 'alert', null, {timeout:30000});
  assert.equal(await digest(desktop),variedPixels);
  assert.equal(promptApiPosts,2);
  record('invalid AI response preserves committed canvas and exported score');

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
  await mobile.locator('#landscape-collection').scrollIntoViewIfNeeded();
  assert.equal(await mobile.locator('.landscape-card').count(), 6);
  const landscapeOverflow = await checkOverflow(mobile);
  assert.ok(landscapeOverflow.documentWidth <= landscapeOverflow.viewport + 1, 'mobile landscape grid overflow');
  await mobile.locator('[data-scene="gen-valley"]').tap();
  await waitRendered(mobile);
  assert.equal(await mobile.locator('#scene-select').inputValue(), 'gen-valley');
  assert.equal(await mobile.locator('#variation-button').isEnabled(), true);
  await mobile.locator('#playground').screenshot({ path: resolve(evidence, 'landscape-editor-mobile.png'), animations: 'disabled' });
  record('landscape selection, seed-variation affordance and editor work on mobile touch');
  await mobileContext.close();

  const unsupported = await browser.newPage({ viewport: { width: 800, height: 650 } });
  await unsupported.addInitScript(() => { Object.defineProperty(window, 'structuredClone', { configurable: true, value: undefined }); });
  await unsupported.goto(base, { waitUntil: 'load' });
  await unsupported.locator('[data-open-playground]').first().click();
  assert.match(await unsupported.locator('#playground-loading').innerText(), /could not start|are required/i);
  assert.equal(await unsupported.locator('#workbench').isVisible(), false);
  await unsupported.close();
  record('unsupported browser receives accessible recovery explanation, not an empty workbench');

  assert.deepEqual(errors, [], 'browser JavaScript errors');
  record('no uncaught page errors');
  await writeFile(resolve(evidence, 'report.json'), JSON.stringify({
    kind: 'actual Chromium browser execution',
    browser: browser.version(),
    desktop: { width: 1440, height: 900 },
    mobile: { width: 390, height: 844, touch: true },
    checks,
    errors,
    bfcache: { actualPageShowPersisted: actuallyRestoredFromBFCache, observedHistoryProbe: historyProbe, syntheticPersistedEventTest: true },
    pixels: { original, seeded, materialChanged: changed },
    generatedAt: new Date().toISOString()
  }, null, 2) + '\n');
  console.log('Site browser test complete; evidence/site populated.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
