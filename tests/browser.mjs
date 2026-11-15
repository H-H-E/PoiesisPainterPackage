#!/usr/bin/env node
/** Actual browser integration checks; no DOM or Canvas mock.
 * npm run build && npm run test:browser
 * BROWSER_EXECUTABLE=/path/to/chromium npm run test:browser
 * STUDIO_URL=http://127.0.0.1:4173 npm run test:browser  # also verifies routing
 * Default is the self-contained release HTML, so no local server is required.
 * A blocked browser launch writes status=blocked and exits nonzero. It is never
 * counted as a passing browser test. BROWSER_CDP_URL is an explicitly supplied
 * managed browser endpoint; the runner creates its own isolated context.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import os from 'node:os';
import {chromium} from 'playwright';

const output=resolve(process.env.BROWSER_EVIDENCE_DIR||'evidence/browser');
await mkdir(output,{recursive:true});
const url=process.env.STUDIO_URL||pathToFileURL(resolve('release/poiesis-studio.html')).href;
const report={recordedAt:new Date().toISOString(),status:'not-run',host:{platform:process.platform,arch:process.arch,node:process.version,cpu:os.cpus()[0]?.model},url,checks:[],consoleErrors:[],pageErrors:[],requestsFailed:[]};
let browser,context,phase='launch';
const started=performance.now();
const record=(name,details={})=>{report.checks.push({name,passed:true,...details});console.log('PASS '+name);};
try{
 let executable=process.env.BROWSER_EXECUTABLE;
 if(!executable){try{await access('/usr/bin/chromium');executable='/usr/bin/chromium';}catch{/* Playwright-managed browser default. */}}
 browser=process.env.BROWSER_CDP_URL?await chromium.connectOverCDP(process.env.BROWSER_CDP_URL):await chromium.launch({headless:process.env.HEADFUL!=='1',...(executable?{executablePath:executable}:{}),args:['--no-sandbox']});
 context=await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1,acceptDownloads:true,reducedMotion:'reduce'});
 const page=await context.newPage();
 page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(30000);
 page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});
 page.on('pageerror',e=>report.pageErrors.push(e.message));
 page.on('requestfailed',request=>report.requestsFailed.push({url:request.url(),failure:request.failure()?.errorText}));
 phase='navigation';await page.goto(url,{waitUntil:'load'});
 phase='assertions';
 const waitIdle=async(expected)=>{await page.waitForFunction(()=>!document.getElementById('apply').disabled&&document.getElementById('render-overlay').hidden,null,{timeout:60000});if(expected)assert.match(await page.locator('#status').innerText(),expected);};
 const fingerprint=async()=>createHash('sha256').update(await page.locator('#painting').evaluate(canvas=>canvas.toDataURL('image/png'))).digest('hex');
 const enter=async document=>{await page.locator('#score').fill(JSON.stringify(document));await page.locator('#apply').click();await waitIdle(/Score applied/);};
 await waitIdle(/Score rendered/);
 report.browser=browser.version();report.environment=await page.evaluate(()=>({ua:navigator.userAgent,dpr:devicePixelRatio,canvas2d:!!document.createElement('canvas').getContext('2d'),offscreen:typeof OffscreenCanvas!=='undefined',backend:document.getElementById('backend-label').textContent}));
 assert.match(report.environment.backend,/canvas2d-cpu/);record('standalone or served studio starts with real Canvas2D output');
 await page.screenshot({path:join(output,'studio-desktop.png'),fullPage:true});
 await page.locator('#painting').screenshot({path:join(output,'landscape-browser.png')});

 const doc={version:'1.0',width:384,height:256,seed:531,background:'#eef0e8',paper:{texture:.35,absorbency:.5},materials:{ink:{medium:'ink',color:'#21394b',size:.07},wash:{medium:'watercolor',color:'#567f97',size:.12}},layers:[{id:'water',commands:[{id:'wash-a',op:'stroke',material:'wash',path:[[.1,.4,.2],[.5,.3,1],[.9,.4,.1]]},{id:'settle-a',op:'wait',steps:4}]},{id:'marks',commands:[{id:'stroke-a',op:'stroke',material:'ink',path:[[.2,.9,1],[.36,.65,.6],[.4,.45,.1]]}]}]};
 await enter(doc);const original=await fingerprint();
 assert.deepEqual(await page.locator('#painting').evaluate(c=>[c.width,c.height]),[384,256]);record('editor applies complete score and updates native dimensions');
 const invalid=structuredClone(doc);invalid.layers[1].commands.push({id:'broken',op:'stroke',material:'missing',path:[[.1,.1],[.3,.2]]});
 await page.locator('#score').fill(JSON.stringify(invalid));await page.locator('#apply').click();await waitIdle();assert.equal(await page.locator('#status').getAttribute('role'),'alert');assert.match(await page.locator('#status').innerText(),/missing|not defined/);assert.equal(await fingerprint(),original);record('invalid batch shows a repairable error and preserves actual pixels');
 await page.locator('#score').fill('{not valid JSON');await page.locator('#apply').click();assert.match(await page.locator('#status').innerText(),/JSON could not be read/);assert.equal(await fingerprint(),original);record('malformed JSON preserves previous painting');
 await page.locator('#score').fill(JSON.stringify(doc));
 await page.locator('.revision-section > summary').click();await page.locator('#command-id').selectOption('stroke-a');await page.locator('#patch').fill(JSON.stringify({intent:{restraint:.9}}));await page.locator('#revise').click();await waitIdle(/Revised stroke-a/);const revised=await fingerprint();assert.notEqual(revised,original);record('revision by stable ID changes the selected passage');
 await page.locator('#undo').click();await waitIdle(/Previous document/);assert.equal(await fingerprint(),original);await page.locator('#redo').click();await waitIdle(/reapplied/);assert.equal(await fingerprint(),revised);record('Undo and Redo restore exact same-browser pixels');

 await page.locator('#crop-toggle').click();assert.equal(await page.locator('#crop-panel').isVisible(),true);await page.locator('#painting').click({position:{x:150,y:70}});assert.deepEqual(await page.locator('#crop-canvas').evaluate(c=>[c.width,c.height]),[320,320]);assert.match(await page.locator('#crop-position').innerText(),/160 × 160 px/);record('crop inspector selects an unprocessed 160-square region at 2x');
 const download=async(selector,file)=>{const event=page.waitForEvent('download');await page.locator(selector).click();const item=await event;await item.saveAs(join(output,file));return readFile(join(output,file));};
 const png=await download('#export-png','downloaded-painting.png');assert.equal(png.subarray(1,4).toString(),'PNG');assert.equal(png.readUInt32BE(16),384);assert.equal(png.readUInt32BE(20),256);
 const crop=await download('#export-crop','downloaded-crop.png');assert.equal(crop.readUInt32BE(16),320);assert.equal(crop.readUInt32BE(20),320);
 const json=JSON.parse((await download('#export-json','downloaded-score.json')).toString());assert.equal(json.layers[1].commands[0].id,'stroke-a');assert.equal(json.layers[1].commands[0].intent.restraint,.9);record('PNG, crop and reproducible JSON downloads contain actual requested output');

 const beforeCancel=await fingerprint();const slow=structuredClone(doc);slow.layers[1].commands=[{id:'many',op:'family',material:'ink',path:[[.1,.9,.8],[.13,.5,.1]],count:900,spread:[.7,0],jitter:.01}];
 await page.locator('#score').fill(JSON.stringify(slow));
 // Both real UI events occur in one browser turn, making cancellation timing
 // deterministic even on a fast GPU/CPU or a distant managed browser.
 await page.evaluate(()=>{document.getElementById('apply').click();document.getElementById('cancel').click();});await waitIdle(/canceled/);assert.equal(await fingerprint(),beforeCancel);record('Cancel leaves the committed painting visible');

 for(const [width,height,name]of [[1440,1000,'desktop'],[768,1024,'tablet'],[390,844,'mobile']]){
  await page.setViewportSize({width,height});const size=await page.evaluate(()=>({document:document.documentElement.scrollWidth,viewport:innerWidth}));assert.ok(size.document<=size.viewport+2,`${name} horizontal overflow ${size.document}/${size.viewport}`);assert.ok(await page.locator('#apply').isVisible());await page.screenshot({path:join(output,`studio-${name}-controls.png`),fullPage:true});record(`${name} layout has no horizontal overflow`);
 }
 assert.deepEqual(report.pageErrors,[],'uncaught browser errors');assert.deepEqual(report.consoleErrors,[],'console errors');assert.deepEqual(report.requestsFailed,[],'failed resource requests');record('no console errors, uncaught exceptions or failed requests');report.status='passed';
}catch(error){report.status=phase==='launch'?'blocked':'failed';report.failure={phase,name:error.name,message:error.message,stack:error.stack?.split('\n').slice(0,10).join('\n')};console.error(`${report.status.toUpperCase()}: ${error.message.split('\n')[0]}`);process.exitCode=1;}
finally{await context?.close();await browser?.close();report.durationMs=performance.now()-started;await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log('Browser evidence: '+join(output,'report.json'));}
