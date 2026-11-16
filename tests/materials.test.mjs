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
