import test from 'node:test';
import assert from 'node:assert/strict';
import { samplePath, sampleBounds, hatchSegments, expandFamily, resolveIntent } from '../dist/geometry.js';
import { random, hashSeed, coherent } from '../dist/random.js';

const near = (actual, expected, epsilon = 1e-8) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} is not near ${expected}`);
const inside = (point, polygon) => {
  let yes = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [x, y] = point, a = polygon[i], b = polygon[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) yes = !yes;
  }
  return yes;
};

test('stroke sampling preserves endpoints, pressure bounds, monotone distance and finite unit normals', () => {
  const samples = samplePath([[.1,.7,.1],[.25,.1,.8],[.7,.8,1],[.9,.25,.2]], 640, 480, 27);
  near(samples[0].x,64); near(samples[0].y,336); near(samples.at(-1).x,576); near(samples.at(-1).y,120);
  near(samples[0].pressure,.1); near(samples.at(-1).pressure,.2);
  near(samples[0].t,0); near(samples.at(-1).t,1);
  for(let i=0;i<samples.length;i++){
    const s=samples[i];
    assert.ok(Object.values(s).every(Number.isFinite));
    assert.ok(s.pressure>=0&&s.pressure<=1);
    near(Math.hypot(s.nx,s.ny),1,1e-6);
    if(i) assert.ok(s.distance>=samples[i-1].distance&&s.t>=samples[i-1].t);
  }
});

test('duplicate and highly uneven input points remain finite without spurious large excursions', () => {
  for(const path of [ [[.4,.5],[.4,.5]], [[.1,.5],[.1,.5],[.10001,.50001],[.9,.5]], [[.1,.2],[.11,.201],[.111,.2011],[.9,.8]] ]){
    const samples=samplePath(path,1000,700,1);
    assert.ok(samples.length>=2);
    assert.ok(samples.every(p=>Object.values(p).every(Number.isFinite)));
    assert.ok(samples.every(p=>p.x>=-10&&p.x<=1010&&p.y>=-10&&p.y<=710));
  }
});

test('path sampling has a real output bound for the largest accepted path', () => {
  const path=Array.from({length:4096},(_,i)=>[i%2?2:-1,(i%7)/6]);
  const points=samplePath(path,8192,1024,18);
  assert.ok(points.length<=16385, `unexpected allocation of ${points.length} samples`);
  assert.ok(points.every(p=>Number.isFinite(p.x+p.y+p.distance)));
});

test('hatch intersections keep every segment inside a concave polygon', () => {
  const polygon=[[.1,.1],[.9,.1],[.9,.9],[.7,.9],[.7,.3],[.3,.3],[.3,.9],[.1,.9]];
  for(const angle of [0,27,90,143]){
    const lines=hatchSegments(polygon,.031,angle);
    assert.ok(lines.length>5);
    for(const [a,b] of lines){
      assert.ok(Math.hypot(b[0]-a[0],b[1]-a[1])>1e-10);
      for(const t of [.05,.25,.5,.75,.95])assert.ok(inside([a[0]*(1-t)+b[0]*t,a[1]*(1-t)+b[1]*t],polygon), `segment crosses exterior at angle ${angle}`);
    }
  }
});

test('hatch rotates its actual direction and avoids degenerate zero length segments', () => {
  const lines=hatchSegments([[0,0],[1,0],[1,1],[0,1]],.07,37);
  const radians=37*Math.PI/180;
  for(const [a,b] of lines){const dx=b[0]-a[0],dy=b[1]-a[1];near(dx*Math.sin(radians)-dy*Math.cos(radians),0);}
});

test('sample bounds clip off-page paths before raster allocation', () => {
  assert.deepEqual(sampleBounds([{x:-100,y:-50},{x:-80,y:-20}],5,128,96),{x:0,y:0,width:0,height:0});
  const b=sampleBounds([{x:10.2,y:20.6},{x:120,y:90}],10,128,96);
  assert.ok(b.x>=0&&b.y>=0&&b.x+b.width<=128&&b.y+b.height<=96);
  assert.ok(b.width*b.height<=128*96);
});

test('stable family IDs and seeds reproduce marks independently of unrelated calls', () => {
  const command={id:'reeds',op:'family',material:'ink',path:[[.1,.8,.8],[.11,.4,.05]],count:7,spread:[.5,0],jitter:.02};
  const a=expandFamily(command,42);
  expandFamily({...command,id:'unrelated'},7);
  const b=expandFamily(command,42);
  assert.deepEqual(a,b); assert.equal(new Set(a.map(x=>x.id)).size,7);
  assert.notDeepEqual(a,expandFamily(command,43));
  assert.notDeepEqual(a,expandFamily({...command,id:'another'},42));
  const single=expandFamily({...command,count:1},42);
  assert.ok(single.flatMap(x=>x.path).flat().every(Number.isFinite));
});

test('seeded random sequence and smooth noise are stable, bounded, and continuous', () => {
  const a=random(hashSeed(7,'lake')),b=random(hashSeed(7,'lake'));
  for(let i=0;i<200;i++){const x=a();assert.equal(x,b());assert.ok(x>=0&&x<1);}
  for(const t of [-10,-1,0,1,12.5,100]){const y=coherent(t,18);assert.ok(y>=0&&y<=1);near(coherent(t-1e-6,18),coherent(t+1e-6,18),1e-5);}
});

test('intent controls expose inspectable effects without choosing a composition', () => {
  const mat={medium:'ink',color:'#123456',size:.03};
  const gentle=resolveIntent(mat,{force:0,restraint:1,hesitation:1}),strong=resolveIntent(mat,{force:1,restraint:0,hesitation:0});
  assert.ok(gentle.pressureScale<strong.pressureScale&&gentle.widthScale<strong.widthScale&&gentle.opacityScale<strong.opacityScale);
  assert.ok(gentle.tremor>strong.tremor&&gentle.speedScale<strong.speedScale);
  assert.ok(gentle.explanation.every(x=>typeof x==='string'&&x.length>10));
});
