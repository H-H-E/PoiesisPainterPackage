import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createCanvas} from '@napi-rs/canvas';
import {Painter, capabilities} from '../dist/painter.js';
import {PaintingValidationError, validatePainting} from '../dist/validate.js';

const factory=(w,h)=>createCanvas(w,h);
const hash=canvas=>createHash('sha256').update(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data).digest('hex');
const make=()=>{const canvas=factory(128,96);return {canvas,painter:new Painter(canvas,{canvasFactory:factory})};};
const score=()=>({version:'1.0',width:128,height:96,seed:42,background:'#eef0eb',paper:{texture:.3,absorbency:.5},materials:{ink:{medium:'ink',color:'#1d3045',size:.07},wash:{medium:'watercolor',color:'#627f9c',size:.12}},layers:[{id:'sky',commands:[{id:'skyline',op:'stroke',material:'wash',path:[[.1,.3,.3],[.5,.23,1],[.9,.38,.1]]},{id:'settle',op:'wait',steps:2}]},{id:'foreground',commands:[{id:'reed',op:'stroke',material:'ink',path:[[.3,.9,1],[.4,.65,.5],[.42,.5,.05]]}]}]});

test('data-only score paints actual nonuniform pixels, with deterministic serialization and replay',async()=>{
 const {painter,canvas}=make(),other=make();const doc=score();
 try{const report=await painter.render(doc);assert.equal(report.commands,3);assert.equal(report.marks,2);assert.notEqual(hash(canvas),hash(factory(128,96)));
 const bytes=canvas.getContext('2d').getImageData(0,0,128,96).data;assert.ok(new Set(bytes).size>20);
 const encoded=painter.serialize();assert.deepEqual(JSON.parse(encoded),doc);await other.painter.render(JSON.parse(encoded));assert.equal(hash(canvas),hash(other.canvas));
 doc.seed=77;doc.layers[0].commands.length=0;const detached=painter.document;detached.seed=88;assert.equal(painter.document.seed,42);assert.equal(painter.document.layers[0].commands.length,2);
 }finally{painter.dispose();other.painter.dispose();}
});

test('all advertised media complete real rendering',async()=>{
 for(const medium of capabilities().media){const {painter,canvas}=make();try{const doc=score();doc.materials.ink.medium=medium;doc.layers=[doc.layers[1]];const r=await painter.render(doc);assert.ok(r.layers[0].stats.pigmentMass>0,medium);assert.ok(new Set(canvas.getContext('2d').getImageData(0,0,128,96).data).size>10,medium);}finally{painter.dispose();}}
});

test('invalid command in a batch changes neither image, score nor history',async()=>{
 const {painter,canvas}=make();try{await painter.render(score());const before=painter.serialize(),pixels=hash(canvas),history=painter.inspect().history;
 await assert.rejects(painter.apply('foreground',[{id:'valid',op:'stroke',material:'ink',path:[[.2,.8],[.5,.4]]},{id:'bad',op:'stroke',material:'missing',path:[[.1,.2],[.3,.4]]}]),PaintingValidationError);
 assert.equal(painter.serialize(),before);assert.equal(hash(canvas),pixels);assert.deepEqual(painter.inspect().history,history);
 await assert.rejects(painter.revise('reed',{id:'renamed'}),/stable ID/);assert.equal(painter.serialize(),before);
 }finally{painter.dispose();}
});

test('revision by ID, undo and redo replay actual wet history and clear redo after a new edit',async()=>{
 const {painter,canvas}=make();try{await painter.render(score());const original=hash(canvas),serialized=painter.serialize();
 await painter.revise('skyline',{path:[[.1,.4,.3],[.55,.4,1],[.8,.5,.1]]});const revised=hash(canvas);assert.notEqual(revised,original);assert.equal(painter.document.layers[0].commands[0].id,'skyline');
 assert.equal(await painter.undo(),true);assert.equal(hash(canvas),original);assert.equal(painter.serialize(),serialized);
 assert.equal(await painter.redo(),true);assert.equal(hash(canvas),revised);
 await painter.undo();await painter.revise('reed',{speed:2});assert.equal(await painter.redo(),false);
 }finally{painter.dispose();}
});

test('layer cache keys invalidate material and geometry while compositing edits safely reuse pixels',async()=>{
 const {painter,canvas}=make();try{const doc=score();await painter.render(doc);const base=hash(canvas);
 const warm=await painter.render(doc);assert.equal(warm.cacheHits,2);assert.equal(warm.commands,3);assert.equal(hash(canvas),base);
 const opacity=await painter.revise('foreground',{opacity:.2});assert.equal(opacity.cacheHits,2);assert.notEqual(hash(canvas),base);
 const changed=await painter.transact(d=>{d.materials.ink.color='#a34022';});assert.equal(changed.cacheHits,1);assert.equal(changed.layers.find(l=>l.id==='foreground').reused,false);
 const unused=await painter.transact(d=>{d.materials.unused={medium:'ink',color:'#123456',size:.01};});assert.equal(unused.cacheHits,2);
 }finally{painter.dispose();}
});

test('inserting an invisible unrelated command does not perturb established mark randomness',async()=>{
 const {painter,canvas}=make();try{await painter.render(score());const before=hash(canvas);
 await painter.apply('foreground',[{id:'outside',op:'stroke',material:'ink',path:[[-.9,-.9],[-.5,-.7]]}]);assert.equal(hash(canvas),before);
 }finally{painter.dispose();}
});

test('abort midway through a mark family preserves previous image/document/history',async()=>{
 const {painter,canvas}=make();try{await painter.render(score());const before=painter.serialize(),pixels=hash(canvas),history=painter.inspect().history;const controller=new AbortController();const next=score();next.seed=8;next.layers[1].commands=[{id:'many',op:'family',material:'ink',path:[[.1,.95],[.12,.6]],count:40,spread:[.7,0],jitter:.01}];let calls=0;
 await assert.rejects(painter.render(next,{signal:controller.signal,yieldEvery:0,onProgress:()=>{calls++;controller.abort();}}),{name:'AbortError'});
 assert.ok(calls>0);assert.equal(painter.serialize(),before);assert.equal(hash(canvas),pixels);assert.deepEqual(painter.inspect().history,history);
 const rerun=await painter.render(score());assert.equal(rerun.cacheHits,2);assert.equal(hash(canvas),pixels);
 }finally{painter.dispose();}
});

test('throwing final progress observer cannot corrupt the committed cache',async()=>{
 const {painter,canvas}=make();try{await painter.render(score());const before=painter.serialize(),pixels=hash(canvas);const changed=score();changed.materials.ink.color='#cc2222';
 await assert.rejects(painter.render(changed,{onProgress:p=>{if(p.completed===p.total&&!p.layerId)throw Error('observer failed');}}),/observer failed/);
 assert.equal(painter.serialize(),before);assert.equal(hash(canvas),pixels);
 await painter.render(score());assert.equal(hash(canvas),pixels);assert.equal(painter.crop({x:0,y:0,width:64,height:48}).width,64);
 }finally{painter.dispose();}
});

test('the latest concurrent render wins and older rendering rejects without publishing its score',async()=>{
 const {painter,canvas}=make();try{await painter.render(score());const old=score();old.seed=11;old.layers[1].commands=[{id:'slow',op:'family',material:'ink',path:[[.1,.9],[.11,.6]],count:60,spread:[.7,0],jitter:.01}];
 const first=painter.render(old,{yieldEvery:0}).then(()=>({completed:true}),error=>({error}));
 const newest=score();newest.seed=12;newest.materials.ink.color='#885511';await painter.render(newest,{yieldEvery:0});const stopped=await first;assert.equal(stopped.error?.name,'AbortError');assert.deepEqual(painter.document,newest);
 const independent=make();try{await independent.painter.render(newest);assert.equal(hash(canvas),hash(independent.canvas));}finally{independent.painter.dispose();}
 }finally{painter.dispose();}
});

test('high resolution export rerenders geometry and returns a live native canvas without resizing the original',async()=>{
 const {painter,canvas}=make();try{await painter.render(score());const before=hash(canvas);const big=await painter.export(512,384);assert.equal(big.width,512);assert.equal(big.height,384);assert.equal(canvas.width,128);assert.equal(hash(canvas),before);assert.ok(new Set(big.getContext('2d').getImageData(0,0,512,384).data).size>20);
 const independent=new Painter(factory(512,384),{canvasFactory:factory});try{const d=score();d.width=512;d.height=384;await independent.render(d);const expected=independent.crop({x:0,y:0,width:512,height:384});assert.equal(hash(big),hash(expected));}finally{independent.dispose();}
 const png=big.toBuffer('image/png');assert.equal(png.readUInt32BE(16),512);assert.equal(png.readUInt32BE(20),384);
 }finally{painter.dispose();}
});

test('crop samples the committed image and rejects invalid bounds',async()=>{
 const {painter,canvas}=make();try{await painter.render(score());const crop=painter.crop({x:20,y:20,width:40,height:30,scale:4});assert.equal(crop.width,160);assert.equal(crop.height,120);
 const a=canvas.getContext('2d').getImageData(20,20,1,1).data,b=crop.getContext('2d').getImageData(0,0,1,1).data;assert.deepEqual([...a],[...b]);
 for(const bad of [{x:-1,y:0,width:10,height:10},{x:120,y:90,width:10,height:10},{x:0,y:0,width:10,height:10,scale:9},{x:NaN,y:0,width:10,height:10}])assert.throws(()=>painter.crop(bad),/Crop/);
 }finally{painter.dispose();}
});

test('resource disposal is idempotent, preserves caller canvas, and rejects subsequent operations',async()=>{
 const {painter,canvas}=make();await painter.render(score());const pixels=hash(canvas);painter.dispose();painter.dispose();assert.equal(hash(canvas),pixels);assert.throws(()=>painter.serialize(),/disposed/);assert.throws(()=>painter.crop({x:0,y:0,width:10,height:10}),/disposed/);await assert.rejects(painter.render(score()),/disposed/);
});

test('recover copies the committed image to a fresh context',async()=>{
 const {painter,canvas}=make();try{await painter.render(score());const recovered=factory(2,2);painter.recover(recovered);assert.equal(recovered.width,128);assert.equal(recovered.height,96);assert.equal(hash(recovered),hash(canvas));}finally{painter.dispose();}
});

test('a finite history limit bounds reachable undo states',async()=>{
 const canvas=factory(128,96),painter=new Painter(canvas,{canvasFactory:factory,historyLimit:2});
 try{for(let seed=1;seed<=4;seed++){const d=score();d.seed=seed;await painter.render(d);}assert.equal(await painter.undo(),true);assert.equal(painter.document.seed,3);assert.equal(await painter.undo(),true);assert.equal(painter.document.seed,2);assert.equal(await painter.undo(),false);}finally{painter.dispose();}
});

test('inspect returns detached feedback so callers cannot corrupt cached material reports',async()=>{
 const {painter}=make();try{await painter.render(score());const initial=painter.inspect().layers[0].stats.pigmentMass;const feedback=painter.inspect();feedback.layers[0].stats.pigmentMass=-999;assert.equal(painter.inspect().layers[0].stats.pigmentMass,initial);}finally{painter.dispose();}
});

test('context failure during staging keeps the committed image recoverable',async()=>{
 const canvas=factory(128,96);let fail=false;let failedCanvas;
 const f=(w,h)=>{const c=factory(w,h);if(fail){fail=false;failedCanvas=c;return {get width(){return c.width;},set width(x){c.width=x;},get height(){return c.height;},set height(x){c.height=x;},getContext(){return null;}};}return c;};
 const painter=new Painter(canvas,{canvasFactory:f});
 try{await painter.render(score());const before=hash(canvas),serialized=painter.serialize();fail=true;const d=score();d.seed=77;await assert.rejects(painter.render(d),/Canvas2D/);assert.equal(hash(canvas),before);assert.equal(painter.serialize(),serialized);const restored=factory(1,1);painter.recover(restored);assert.equal(hash(restored),before);
 assert.equal(failedCanvas.width*failedCanvas.height,1,'failed staging allocation is released');
 }finally{painter.dispose();}
});

test('expanded brush work is rejected before any staged canvas or material field is allocated',async()=>{
 const canvas=factory(128,96);let allocations=0;
 const painter=new Painter(canvas,{canvasFactory:(w,h)=>{allocations++;return factory(w,h);}});
 try{await painter.render(score());const countBefore=allocations,bytesBefore=hash(canvas),stateBefore=painter.serialize();const hostile=score();
 hostile.materials.ink.bristles=128;
 hostile.layers[1].commands=[{id:'work-bomb',op:'family',material:'ink',path:Array.from({length:500},(_,i)=>i%2?[1,1]:[0,0]),count:2000,spread:[0,0],jitter:0}];
 const validation=validatePainting(hostile);assert.equal(validation.valid,false);assert.ok(validation.errors.some(error=>error.code==='workload-ribbonVertices'));
 await assert.rejects(painter.render(hostile),PaintingValidationError);assert.equal(allocations,countBefore);assert.equal(hash(canvas),bytesBefore);assert.equal(painter.serialize(),stateBefore);
 }finally{painter.dispose();}
});
