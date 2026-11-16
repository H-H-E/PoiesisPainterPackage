import {createCanvas,ImageData} from '@napi-rs/canvas';
import {Painter,resolveMaterial} from '../dist/index.js';
import {MaterialSurface,createReservoir} from '../dist/materials.js';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const out=process.argv[2]||'evidence/materials';await mkdir(out,{recursive:true});
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
const report=await painter.render(doc);await writeFile(`${out}/contact-sheet.png`,canvas.toBuffer('image/png'));await writeFile(`${out}/contact-sheet.json`,JSON.stringify(doc,null,2)+'\n');
const crops=[];
for(const [row,name]of media.entries()){
 const region={x:20,y:Math.max(0,Math.floor((.018+row*.164)*720)),width:440,height:92};
 const raw=painter.crop(region);await writeFile(`${out}/${name}-100pct.png`,raw.toBuffer('image/png'));
 const close=painter.crop({...region,scale:3});await writeFile(`${out}/${name}-3x-nearest.png`,close.toBuffer('image/png'));crops.push({medium:name,region});
}
painter.dispose();
// A raw field-only wet/dry edge study, intentionally no display smoothing.
const W=240,H=200,mask=new Uint8ClampedArray(160*100*4);
for(let y=0;y<100;y++)for(let x=0;x<160;x++){const edge=Math.min(x,159-x,y,99-y);mask[(y*160+x)*4+3]=Math.round(Math.min(1,edge/3)*255);}
const edgeResults=[];
for(const steps of [0,40]){
 const s=new MaterialSurface(W,H,{texture:.65,absorbency:.5},127);s.deposit(mask,{x:40,y:50,width:160,height:100},{medium:'watercolor',color:'#375a76',wetness:1,load:1,granulation:.8});const before=s.stats();s.step(steps);
 const c=createCanvas(W,H),ctx=c.getContext('2d');ctx.fillStyle='#f2eee3';ctx.fillRect(0,0,W,H);const tmp=createCanvas(W,H);tmp.getContext('2d').putImageData(new ImageData(s.rgba(),W,H),0,0);ctx.drawImage(tmp,0,0);await writeFile(`${out}/water-edge-${steps}.png`,c.toBuffer('image/png'));edgeResults.push({steps,before,after:s.stats(),rgbaHash:createHash('sha256').update(s.rgba()).digest('hex')});s.dispose();
}
await writeFile(`${out}/manifest.json`,JSON.stringify({timestamp:new Date().toISOString(),renderer:'native Skia CPU; raw exports, nearest-neighbor enlarged crops',materialSourceHash:createHash('sha256').update(await readFile('src/materials.ts')).digest('hex'),legend:'Rows top to bottom: ink, watercolor, oil, knife, graphite, marker. Left loaded .95; right nearly dry .18. Same gesture, seed, dimensions; materials differ explicitly.',report,crops,edgeResults},null,2)+'\n');
console.log(`Saved material studies to ${out}`);
