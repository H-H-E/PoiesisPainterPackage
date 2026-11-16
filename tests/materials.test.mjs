import test from 'node:test';
import assert from 'node:assert/strict';
import {MaterialSurface,createReservoir} from '../dist/materials.js';
const mask=(w,h,alpha=255)=>{const a=new Uint8ClampedArray(w*h*4);for(let i=3;i<a.length;i+=4)a[i]=alpha;return a;};
const water={medium:'watercolor',color:'#274d65',wetness:1,load:1,granulation:.7};
const oil={medium:'oil',color:'#254f70',wetness:.9,load:1};
const near=(a,b,tol=1e-4)=>assert.ok(Math.abs(a-b)<tol,`${a} != ${b} (tolerance ${tol})`);

test('watercolor transport conserves pigment while water evaporates and coverage grows',()=>{
 const s=new MaterialSurface(64,48,{absorbency:.45},11);
 s.deposit(mask(14,14),{x:24,y:16,width:14,height:14},water);
 const initial=s.stats();s.step(32);const final=s.stats();
 near(final.pigmentMass,initial.pigmentMass,.001);
 assert.ok(final.waterMass<initial.waterMass);
 assert.ok(final.activePixels>initial.activePixels);
 assert.ok(s.rgba().some((a,i)=>i%4===3&&a>0));
});
test('seed, command order and simulation steps determine repeatable field output',()=>{
 const render=seed=>{const s=new MaterialSurface(48,48,{texture:.8},seed);s.deposit(mask(20,20),{x:12,y:12,width:20,height:20},water);s.step(12);return s.rgba();};
 assert.deepEqual(render(81),render(81));assert.notDeepEqual(render(81),render(82));
});
test('explicit drying freezes pigment and prevents later liquid transport',()=>{
 const s=new MaterialSurface(48,48);s.deposit(mask(20,20),{x:12,y:12,width:20,height:20},water);s.dry();const before=s.rgba().slice();s.step(16);
 assert.deepEqual(s.rgba(),before);assert.equal(s.stats().waterMass,0);
});
test('ordered oil chunks carry acquired pigment and conserve surface+reservoir mass',()=>{
 const s=new MaterialSurface(80,32,{},3);
 s.deposit(mask(18,12),{x:4,y:10,width:18,height:12},oil);
 const b=createReservoir({...oil,color:'#d86426',load:0});
 const before=s.stats().pigmentMass+b.remaining;
 s.deposit(mask(12,12),{x:10,y:10,width:12,height:12},{...oil,load:0},b);
 assert.ok(b.pickedUp>0);assert.ok(b.remaining>0);assert.ok(b.color[2]>b.color[0]);
 s.deposit(mask(12,12),{x:24,y:10,width:12,height:12},{...oil,load:0},b);
 const rgba=s.rgba();assert.ok(rgba[(16*80+26)*4+3]>0,'carried paint reaches a later non-overlapping region');
 near(s.stats().pigmentMass+b.remaining,before,.001);
});
test('dry oil does not transfer pigment to an empty brush',()=>{
 const s=new MaterialSurface(40,32);s.deposit(mask(24,12),{x:4,y:10,width:24,height:12},oil);s.dry();const before=s.rgba().slice(),b=createReservoir({...oil,load:0});
 s.deposit(mask(24,12),{x:4,y:10,width:24,height:12},{...oil,load:0},b);
 assert.equal(b.pickedUp,0);assert.equal(b.remaining,0);assert.deepEqual(s.rgba(),before);
});
test('water laid over dried oil does not turn the oil into a diffusing watercolor field',()=>{
 const s=new MaterialSurface(48,32);s.deposit(mask(16,12),{x:12,y:8,width:16,height:12},oil);s.dry();s.deposit(mask(16,12),{x:12,y:8,width:16,height:12},water);const before=s.rgba().slice();s.step(20);assert.deepEqual(s.rgba(),before);
});
test('malformed masks and materials fail before mutating the surface',()=>{
 const s=new MaterialSurface(32,32);const baseline=s.stats();
 assert.throws(()=>s.deposit(mask(3,3),{x:1,y:1,width:4,height:4},water),/RGBA/);
 assert.throws(()=>s.deposit(mask(3,3),{x:1,y:1,width:3,height:3},{...water,color:'blue'}),/color/);
 assert.throws(()=>s.deposit(mask(3,3),{x:1,y:1,width:3,height:3},{...water,wetness:NaN}),/finite/);
 assert.deepEqual(s.stats(),baseline);
});
test('partially off-canvas masks clip using original mask coordinates',()=>{
 const a=new MaterialSurface(12,12),b=new MaterialSurface(12,12);
 a.deposit(mask(8,8),{x:-4,y:-4,width:8,height:8},{...water,granulation:0});
 b.deposit(mask(4,4),{x:0,y:0,width:4,height:4},{...water,granulation:0});
 assert.deepEqual(a.rgba(),b.rgba());
});
test('transparent masks leave transparent output and stable bounded storage',()=>{
 const s=new MaterialSurface(16,16);s.deposit(mask(8,8,0),{x:0,y:0,width:8,height:8},oil);
 assert.equal(s.stats().pigmentMass,0);assert.ok(s.rgba().every(x=>x===0));assert.equal(s.stats().fieldBytes,16*16*33);
});
test('finite validated update count and explicit resource disposal',()=>{
 const s=new MaterialSurface(8,8);assert.throws(()=>s.step(513),/steps/);assert.throws(()=>s.step(.5),/steps/);assert.throws(()=>s.step(NaN),/steps/);
 s.dispose();s.dispose();assert.equal(s.stats().fieldBytes,0);assert.equal(s.stats().disposed,true);assert.throws(()=>s.rgba(),/disposed/);assert.throws(()=>s.step(1),/disposed/);
});
test('repeated saturation cannot consume reservoir paint that was never deposited',()=>{
 const s=new MaterialSurface(1,1);for(let n=0;n<100;n++)s.deposit(mask(1,1),{x:0,y:0,width:1,height:1},{...oil,wetness:0});
 const r=createReservoir({...oil,wetness:0});const before=s.stats().pigmentMass+r.remaining;
 s.deposit(mask(1,1),{x:0,y:0,width:1,height:1},{...oil,wetness:0},r);
 near(before,s.stats().pigmentMass+r.remaining,.001);
});
test('graphite and marker are deliberately dry media with distinct deposition',()=>{
 const render=medium=>{const s=new MaterialSurface(24,24,{texture:.8},8);s.deposit(mask(16,16),{x:4,y:4,width:16,height:16},{medium,color:'#334455',load:.6,roughness:.8,wetness:1});const before=s.rgba().slice();s.step(30);assert.deepEqual(s.rgba(),before);assert.equal(s.stats().waterMass,0);return before;};
 assert.notDeepEqual(render('graphite'),render('marker'));
});
test('aqueous paint cannot silently diffuse an existing graphite or marker passage',()=>{
 for(const medium of ['graphite','marker']){const s=new MaterialSurface(32,24);s.deposit(mask(16,16),{x:4,y:4,width:16,height:16},{medium,color:'#334455',load:1});const occupied=s.rgba().slice();s.deposit(mask(16,16),{x:4,y:4,width:16,height:16},water);const before=s.rgba().slice();s.step(20);const after=s.rgba();for(let i=0;i<occupied.length;i+=4)if(occupied[i+3]>0)assert.deepEqual(after.slice(i,i+4),before.slice(i,i+4),'Existing dry pigment remains fixed; water may flow through graphite tooth gaps');}
});

test('watercolor wet-versus-dry on identical masks: transport, evaporation, and conserved pigment',()=>{
 const run=wetness=>{
  const s=new MaterialSurface(84,64,{texture:.9,absorbency:.28},42),m=mask(26,22);
  s.deposit(m,{x:29,y:18,width:26,height:22},{...water,wetness,granulation:.9});
  const initial=s.stats();
  s.step(56);
  return {surface:s,initial,final:s.stats(),pixels:s.rgba().slice()};
 };
 const a=run(1),b=run(0);
 near(a.initial.pigmentMass,a.final.pigmentMass,.005);
 near(b.initial.pigmentMass,b.final.pigmentMass,.005);
 assert.ok(a.final.waterMass<a.initial.waterMass,'water evaporates');
 assert.equal(b.final.waterMass,0,'dry watercolor has no circulating binder');
 assert.ok(a.final.activePixels>b.final.activePixels,'wet pigment extends beyond a dry mark');
 assert.notDeepEqual(a.pixels,b.pixels);
 a.surface.dispose();b.surface.dispose();
});

test('substrate-biased granulation remains conservative and seed-dependent',()=>{
 const run=(seed,texture)=>{
  const s=new MaterialSurface(64,48,{texture,absorbency:.15},seed);
  s.deposit(mask(32,20),{x:16,y:14,width:32,height:20},{...water,granulation:1,wetness:1});
  const before=s.stats();
  s.step(40);
  const after=s.stats(),pixels=s.rgba().slice();
  near(before.pigmentMass,after.pigmentMass,.005);
  assert.ok(after.activePixels>before.activePixels);
  s.dispose();
  return pixels;
 };
 assert.deepEqual(run(19,1),run(19,1));
 assert.notDeepEqual(run(19,1),run(20,1));
 assert.notDeepEqual(run(19,1),run(19,0),'paper tooth changes the wet deposition and transport');
});

test('hundreds of transport and drying steps keep every field finite, nonnegative and mobile <= pigment',()=>{
 const s=new MaterialSurface(96,72,{texture:1,absorbency:1},731);
 s.deposit(mask(24,24),{x:22,y:18,width:24,height:24},water);
 s.deposit(mask(22,20),{x:34,y:24,width:22,height:20},{...water,color:'#a86639',granulation:1});
 const mass=s.stats().pigmentMass;
 s.step(256);
 near(s.stats().pigmentMass,mass,.005);
 for(const key of ['pigment','carrier','mobile','relief','red','green','blue']){
  for(const value of s[key]){
   assert.ok(Number.isFinite(value),key+' has nonfinite value');
   assert.ok(value>=-1e-6,key+' has negative value '+value);
  }
 }
 for(let i=0;i<s.pigment.length;i++) assert.ok(s.mobile[i]<=s.pigment[i]+1e-5,'mobile pigment cannot exceed deposited pigment');
 assert.ok(s.stats().waterMass>=0);
 s.dispose();
});

test('wet oil and palette knife have real height field and dry gloss invalidates cached pixels',()=>{
 for(const medium of ['oil','knife']){
  const s=new MaterialSurface(48,42,{texture:.9},52);
  s.deposit(mask(26,22),{x:10,y:10,width:26,height:22},{...oil,medium,wetness:1});
  const wet=s.rgba().slice(),wetHeight=s.stats().heightMass;
  assert.ok(wetHeight>0);
  s.dry();
  const dry=s.rgba().slice();
  assert.notDeepEqual(wet,dry,'oil binder drying must change gloss, even when RGBA was previously cached');
  assert.deepEqual([...wet].filter((_,i)=>i%4===3),[...dry].filter((_,i)=>i%4===3),'wet gloss cannot invent opacity');
  const fixed=dry.slice();s.step(50);assert.deepEqual(s.rgba(),fixed);
  s.dispose();
 }
});

test('ordered loaded-to-depleted oil pickup/redelivery conserves finite reservoir + surface mass',()=>{
 const s=new MaterialSurface(120,44,{texture:.7},7);
 s.deposit(mask(28,24),{x:10,y:10,width:28,height:24},{...oil,color:'#305d8f',wetness:1});
 const r=createReservoir({...oil,color:'#d58a3c'});r.remaining=900;r.capacity=900;
 const mass=s.stats().pigmentMass+r.remaining,initial=r.remaining;
 for(let k=0;k<8;k++)s.deposit(mask(16,22),{x:12+k*11,y:12,width:16,height:22},oil,r);
 near(s.stats().pigmentMass+r.remaining,mass,.005);
 assert.ok(r.remaining<initial,'short consecutive chunks deplete the initially loaded paint');
 assert.ok(r.pickedUp>0,'contact with existing wet paint picks up pigment');
 assert.ok(Array.from({length:26},(_,i)=>s.pigment[20*120+62+i]).some(x=>x>0),'pigment reaches at least one later short chunk');
 for(const c of r.color)assert.ok(Number.isFinite(c)&&c>=0&&c<=1);
 s.dispose();
});

test('fresh watercolor glazing over dried pigment preserves the immobile underpainting',()=>{
 const s=new MaterialSurface(72,52,{texture:.8},81);
 s.deposit(mask(28,20),{x:10,y:14,width:28,height:20},water);
 s.dry();
 const previous=s.pigment.slice(),color=s.red.slice();
 s.deposit(mask(22,24),{x:24,y:10,width:22,height:24},{...water,color:'#a64a38',wetness:1});
 const mass=s.stats().pigmentMass;s.step(60);
 near(s.stats().pigmentMass,mass,.005);
 // Interior pixels untouched by the second stroke stay numerically unchanged.
 for(let y=17;y<30;y++)for(let x=11;x<14;x++){
  // Far outside the second mask: allow trace transported glaze, never reflow of cured pigment.
  const i=y*72+x;near(s.pigment[i],previous[i],.001);near(s.red[i],color[i],.001);
 }
 s.dispose();
});

test('print-scale fields have a fixed 29-byte-per-pixel storage bound and one reusable RGBA cache',()=>{
 const w=1024,h=1536,n=w*h,s=new MaterialSurface(w,h,{texture:.8},5);
 assert.equal(s.stats().fieldBytes,n*29);
 s.deposit(mask(34,30),{x:400,y:500,width:34,height:30},water);
 s.step(8);
 const first=s.rgba();
 for(let i=0;i<24;i++)assert.equal(s.rgba(),first,'RGBA must not allocate a new buffer');
 assert.equal(s.stats().fieldBytes,n*33,'seven Float32 fields + tag + one RGBA cache');
 s.dry();s.rgba();assert.equal(s.stats().fieldBytes,n*33);
 s.dispose();s.dispose();assert.equal(s.stats().fieldBytes,0);
});

test('regional update stops tracking dry pigment after explicit drying',()=>{
 const s=new MaterialSurface(160,90,{texture:.95},41);
 s.deposit(mask(10,10),{x:70,y:40,width:10,height:10},water);
 s.step(8);
 assert.ok(s.activeBox,'wet footprint is tracked');
 s.dry();
 assert.equal(s.activeBox,null,'dry pigment must not keep the simulation active');
 const image=s.rgba().slice();s.step(512);assert.deepEqual(s.rgba(),image);
 s.dispose();
});

// Enable these native-pixel studies in the GitHub CI run so its existing artifact
// upload collects evidence/renders/material-studies, without editing shared CI files.
test('render reproducible native material evidence and machine-readable paired manifest',{
 skip:!process.env.CI&&process.env.RUN_MATERIAL_STUDIES!=='1',
 timeout:240000
},async()=>{
 const {promisify}=await import('node:util'),{execFile}=await import('node:child_process');
 const {readFile}=await import('node:fs/promises');
 const {createCanvas,loadImage}=await import('@napi-rs/canvas');
 const run=promisify(execFile),dir='evidence/renders/material-studies';
 await run(process.execPath,['scripts/material-studies.mjs',dir],{timeout:210000,maxBuffer:2_000_000});
 const manifest=JSON.parse(await readFile(dir+'/manifest.json','utf8'));
 assert.equal(manifest.formatVersion,2);
 assert.equal(manifest.experiments.length,6);
 assert.ok(manifest.afterSource.sha256);
 for(const e of manifest.experiments){
  assert.equal(e.after.raw.nonFinite,0,e.id+' NaN/Infinity');
  assert.equal(e.after.raw.negative,0,e.id+' negative fields');
  assert.equal(e.after.raw.mobileOverPigment,0,e.id+' mobile excess');
  assert.ok(Math.abs(e.after.massDelta)<.005,e.id+' nonconservative '+e.after.massDelta);
  assert.ok(e.evidence.after.native.sha256&&e.evidence.after['3x-nearest'].sha256);
 }
 const image=await loadImage(await readFile(dir+'/water-wet-after-crop-100pct.png'));
 const enlarged=await loadImage(await readFile(dir+'/water-wet-after-crop-3x-nearest.png'));
 assert.equal(image.width*3,enlarged.width);
 assert.equal(image.height*3,enlarged.height);
 const read=img=>{const cv=createCanvas(img.width,img.height);cv.getContext('2d').drawImage(img,0,0);return cv.getContext('2d').getImageData(0,0,img.width,img.height).data;};
 const native=read(image),zoom=read(enlarged);
 for(const [x,y] of [[0,0],[12,30],[68,55],[129,99]]){
  const i=(y*image.width+x)*4,k=((y*3+1)*enlarged.width+x*3+1)*4;
  assert.deepEqual(zoom.slice(k,k+4),native.slice(i,i+4),'3x pixel must equal its native source without smoothing');
 }
 if(process.env.CI) assert.equal(manifest.beforeSource.status,'available','Pinned baseline images required in CI; '+manifest.beforeSource.reason);
});
