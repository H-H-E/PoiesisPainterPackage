/**
 * Reproducible material-field studies. No mock pixels: native Canvas2D output
 * from the ORIGINAL solver and (when available) the pinned pre-change source.
 * Run: node scripts/material-studies.mjs evidence/renders/material-studies
 * Optionally supply MATERIAL_BASELINE_SOURCE=/path/to/old/materials.ts.
 */
import {createCanvas, ImageData} from '@napi-rs/canvas';
import {Painter} from '../dist/index.js';
import {MaterialSurface, createReservoir} from '../dist/materials.js';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import ts from 'typescript';

const out=process.argv[2] || 'evidence/renders/material-studies';
const baselineSHA='8665223329eedb138d90e81e1e8254fdc92cc99d';
await mkdir(out,{recursive:true});
const hash=value=>createHash('sha256').update(value).digest('hex');
const sum=array=>{let result=0;for(const v of array)result+=v;return result;};
const mask=(w,h,edge=2)=>{
 const data=new Uint8ClampedArray(w*h*4);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const coverage=Math.min(1,Math.min(x,w-1-x,y,h-1-y)/Math.max(1,edge));
  data[(y*w+x)*4+3]=Math.round(coverage*255);
 }
 return data;
};
const region=(x,y,width,height)=>({x,y,width,height});
const masks={
 horizontal:{area:region(18,67,204,48),data:mask(204,48,3)},
 vertical:{area:region(100,18,44,144),data:mask(44,144,3)},
};
const wet={medium:'watercolor',color:'#315b82',opacity:.95,load:1,wetness:1,granulation:.95};
const crossing={...wet,color:'#bb6849'};
const dry={...wet,wetness:0};
const oil={medium:'oil',color:'#d87e40',opacity:1,load:1,wetness:.9,viscosity:.6,roughness:.4};
const knife={...oil,medium:'knife'};

// A field-level experiment can be replayed by any implementation of the same
// public MaterialSurface/createReservoir signatures and does not use a rasterizer.
function fieldSummary(surface){
 const names=['pigment','carrier','mobile','relief','red','green','blue'];
 const fields={};let nonFinite=0,negative=0,mobileOverPigment=0;
 for(const name of names){
  const a=surface[name];let min=Infinity,max=-Infinity,mean=0;
  for(const v of a){if(!Number.isFinite(v))nonFinite++;if(v< -1e-6)negative++;min=Math.min(min,v);max=Math.max(max,v);mean+=v;}
  fields[name]={min,max,sum:mean};
 }
 for(let i=0;i<surface.pigment.length;i++)if(surface.mobile[i]>surface.pigment[i]+1e-5)mobileOverPigment++;
 return {fields,nonFinite,negative,mobileOverPigment};
}
const plans=[
 {id:'water-wet',description:'Wet watercolor, one flat masked gesture, 48 evaporation/transport steps',params:{paper:{texture:.9,absorbency:.42},seed:127,medium:wet,steps:48}},
 {id:'water-dry',description:'Same mask, color, pressure and seed; zero wetness',params:{paper:{texture:.9,absorbency:.42},seed:127,medium:dry,steps:48}},
 {id:'wet-cross',description:'Two intersecting still-wet watercolor passages',params:{paper:{texture:.85,absorbency:.25},seed:127,first:wet,second:crossing,between:6,after:44}},
 {id:'dry-cross',description:'Identical crossing gestures but the lower passage is explicitly dried',params:{paper:{texture:.85,absorbency:.25},seed:127,first:wet,second:crossing,between:6,after:44,dryBetween:true}},
 {id:'oil-depletion',description:'Orange oil crossing a blue wet underpaint in sequential loaded-to-depleted short chunks',params:{paper:{texture:.65,absorbency:.4},seed:127,medium:oil,capacity:28,chunks:15}},
 {id:'knife-relief',description:'Same short chunks as oil-depletion, using a knife height field',params:{paper:{texture:.65,absorbency:.4},seed:127,medium:knife,capacity:28,chunks:15}},
];
function runField(impl,plan){
 const {MaterialSurface:Surface,createReservoir:reservoirFactory}=impl;
 const s=new Surface(240,180,plan.params.paper,plan.params.seed);
 let budgetStart=null,budgetEnd=null,reservoir=null;
 if(plan.id==='water-wet'||plan.id==='water-dry'){
  s.deposit(masks.horizontal.data,masks.horizontal.area,plan.params.medium);
  budgetStart=s.stats().pigmentMass;s.step(plan.params.steps);budgetEnd=s.stats().pigmentMass;
 }else if(plan.id==='wet-cross'||plan.id==='dry-cross'){
  s.deposit(masks.horizontal.data,masks.horizontal.area,wet);
  s.step(6);
  if(plan.params.dryBetween)s.dry();
  s.deposit(masks.vertical.data,masks.vertical.area,crossing);
  budgetStart=s.stats().pigmentMass;s.step(44);budgetEnd=s.stats().pigmentMass;
 }else{
  // Same source underpainting and mask trajectory for oil and palette knife.
  const blue={...plan.params.medium,color:'#325b86',wetness:1,load:.85};
  s.deposit(mask(86,38,2),region(16,70,86,38),blue);
  reservoir=reservoirFactory(plan.params.medium);reservoir.capacity=28;reservoir.remaining=28;
  budgetStart=s.stats().pigmentMass+reservoir.remaining;
  for(let k=0;k<15;k++){
   const x=18+k*13;
   s.deposit(mask(18,32,2),region(x,76,18,32),plan.params.medium,reservoir);
  }
  budgetEnd=s.stats().pigmentMass+reservoir.remaining;
  s.step(12);
 }
 const stats=s.stats(),raw=fieldSummary(s);
 const result={id:plan.id,params:plan.params,stats,raw,budgetStart,budgetEnd,massDelta:budgetEnd-budgetStart,
  reservoir:reservoir?{remaining:reservoir.remaining,capacity:reservoir.capacity,pickedUp:reservoir.pickedUp,color:reservoir.color}:null,
  rgba:new Uint8ClampedArray(s.rgba())};
 s.dispose();
 return result;
}
function imageFor(raw){
 const image=createCanvas(240,180),ctx=image.getContext('2d');
 ctx.fillStyle='#f2eee3';ctx.fillRect(0,0,240,180);
 const layer=createCanvas(240,180);
 layer.getContext('2d').putImageData(new ImageData(raw,240,180),0,0);
 ctx.drawImage(layer,0,0);
 return image;
}
async function saveNative(image,prefix){
 const full=image.toBuffer('image/png');await writeFile(`${out}/${prefix}-native.png`,full);
 const crop=region(62,42,130,100),files={native:{name:`${prefix}-native.png`,sha256:hash(full),width:240,height:180}};
 for(const [scale,suffix] of [[1,'100pct'],[3,'3x-nearest']]){
  const canvas=createCanvas(crop.width*scale,crop.height*scale),ctx=canvas.getContext('2d');
  ctx.imageSmoothingEnabled=false;
  ctx.drawImage(image,crop.x,crop.y,crop.width,crop.height,0,0,canvas.width,canvas.height);
  const bytes=canvas.toBuffer('image/png'),name=`${prefix}-crop-${suffix}.png`;
  await writeFile(`${out}/${name}`,bytes);
  files[suffix]={name,sha256:hash(bytes),width:canvas.width,height:canvas.height,crop};
 }
 return files;
}
async function pinnedBaseline(){
 let content,source='unavailable',failure=null;
 if(process.env.MATERIAL_BASELINE_SOURCE){
  try{content=await readFile(process.env.MATERIAL_BASELINE_SOURCE,'utf8');source=process.env.MATERIAL_BASELINE_SOURCE;}
  catch(e){failure=String(e);}
 }else{
  const attempt=()=>execFileSync('git',['show',`${baselineSHA}:src/materials.ts`],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
  try{content=attempt();source=`git:${baselineSHA}`;}
  catch(e){
   failure=`git show unavailable: ${String(e.message).split('\n')[0]}`;
   // Shallow CI checkouts do not contain the baseline parent. A bounded fetch
   // is attempted for evidence only; rendering/building never requires network.
   if(process.env.CI){
    try{execFileSync('git',['fetch','--no-tags','--depth=1','origin',baselineSHA],{stdio:'ignore',timeout:15000});
     content=attempt();source=`git:${baselineSHA} (fetched in CI)`;failure=null;
    }catch(error){failure+=`; fetch unavailable: ${String(error.message).split('\n')[0]}`;}
   }
  }
 }
 if(!content)return {status:'unavailable',reason:failure};
 try{
  const js=ts.transpileModule(content,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  const impl=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
  return {status:'available',source,sha256:hash(content),impl};
 }catch(e){return {status:'unavailable',reason:`baseline compile/import failed: ${e.message}`};}
}
const baseline=await pinnedBaseline();
const sourceHash=hash(await readFile('src/materials.ts'));
const experiments=[];
for(const plan of plans){
 const after=runField({MaterialSurface,createReservoir},plan);
 const before=baseline.status==='available'?runField(baseline.impl,plan):null;
 const afterFiles=await saveNative(imageFor(after.rgba),`${plan.id}-after`);
 const beforeFiles=before?await saveNative(imageFor(before.rgba),`${plan.id}-before`):null;
 const describe=result=>result?{
  stats:result.stats,raw:result.raw,budgetStart:result.budgetStart,budgetEnd:result.budgetEnd,
  massDelta:result.massDelta,reservoir:result.reservoir,
  rgbaSha256:hash(result.rgba)
 }:null;
 const changedPixels=before?after.rgba.reduce((total,value,i)=>total+(value!==before.rgba[i]?1:0),0):null;
 experiments.push({id:plan.id,description:plan.description,params:plan.params,
  before:describe(before),after:describe(after),changedChannels:changedPixels,
  evidence:{before:beforeFiles,after:afterFiles}});
 console.log(`${plan.id}: after ${after.stats.pigmentMass.toFixed(4)} pigment; before ${before?'measured':'unavailable'}; changed channels ${changedPixels??'n/a'}`);
}

// Preserve the six-media Painter contact sheet as an integration artifact.
// The field studies above intentionally bypass raster geometry to isolate media.
const media=['ink','watercolor','oil','knife','graphite','marker'];
const doc={version:'1.0',width:960,height:720,seed:127,background:'#f2eee3',paper:{texture:.65,absorbency:.4},materials:{},layers:[]};
for(let row=0;row<media.length;row++){
 const medium=media[row],y=.078+row*.164;
 doc.materials[`${medium}Loaded`]={medium,color:row%2?'#7b4e34':'#254c68',size:.066,load:.95,opacity:.95,wetness:medium==='watercolor'?.9:medium==='oil'||medium==='knife'?.7:medium==='ink'?.25:0,roughness:.55,granulation:.6,viscosity:.85,bristles:48};
 doc.materials[`${medium}Dry`]={...doc.materials[`${medium}Loaded`],load:.18};
 const commands=[{id:`${medium}-loaded`,op:'stroke',material:`${medium}Loaded`,path:[[.035,y+.03,.15],[.14,y-.025,.85],[.28,y+.03,.6],[.46,y,.15]]},{id:`${medium}-dry`,op:'stroke',material:`${medium}Dry`,path:[[.53,y+.03,.15],[.64,y-.025,.85],[.79,y+.03,.6],[.96,y,.15]]}];
 if(medium==='watercolor'||medium==='ink')commands.push({id:`${medium}-settle`,op:'wait',steps:32});
 doc.layers.push({id:medium,commands});
}
const canvas=createCanvas(doc.width,doc.height),painter=new Painter(canvas,{canvasFactory:createCanvas});
const report=await painter.render(doc);
const contact=canvas.toBuffer('image/png');
await writeFile(`${out}/contact-sheet.png`,contact);
await writeFile(`${out}/contact-sheet.json`,JSON.stringify(doc,null,2)+'\n');
const crops=[];
for(const [row,name]of media.entries()){
 const crop=region(20,Math.max(0,Math.floor((.018+row*.164)*720)),440,92);
 const native=painter.crop(crop),close=painter.crop({...crop,scale:3});
 const a=native.toBuffer('image/png'),b=close.toBuffer('image/png');
 await writeFile(`${out}/${name}-100pct.png`,a);
 await writeFile(`${out}/${name}-3x-nearest.png`,b);
 crops.push({medium:name,region:crop,rawSha256:hash(a),nearestSha256:hash(b)});
}
painter.dispose();

const manifest={
 formatVersion:2,baselineCommit:baselineSHA,
 beforeSource:{status:baseline.status,source:baseline.source??null,sha256:baseline.sha256??null,reason:baseline.reason??null},
 afterSource:{sha256:sourceHash},backend:'native @napi-rs/canvas Skia CPU',
 crops:'Unsmoothed 100% region and 3x nearest-neighbor of identical native pixels',
 conservationTolerance:'abs(mass delta) <= 0.005 for watercolor transport; <= 0.005 total surface+reservoir for oil pickup/deposition; Float32 accumulation',
 note:'Field-only fixed masks isolate material changes. Contact sheet additionally runs the full Painter and rasterizer. No cross-layer material physics.',
 experiments,contactSheet:{png:'contact-sheet.png',sha256:hash(contact),score:'contact-sheet.json',report,crops}
};
await writeFile(`${out}/manifest.json`,JSON.stringify(manifest,null,2)+'\n');
console.log(`Saved native material studies and raw field manifest to ${out}`);
