/**
 * Original, deterministic landscape score grammar for the Poiesis Painter site.
 * Each image is assembled from deliberate foreground/midground/distance shapes,
 * broken pressure-tapered gestures and a restrained color palette. No bitmaps,
 * remote imagery, code evaluation or non-schema operations.
 */
export const LANDSCAPES = Object.freeze([
  { id: 'estuary', title: 'The inlet at first light', place: 'Quiet water / coastal study', seed: 1829, palette: ['#d5d7cb', '#6b8b8e', '#b6805b'] },
  { id: 'valley', title: 'A road through late summer', place: 'Fields / evening study', seed: 3091, palette: ['#e7d0a9', '#8c986e', '#c28e57'] },
  { id: 'headland', title: 'Before the weather turns', place: 'Headland / Atlantic study', seed: 771, palette: ['#c4d0cb', '#426571', '#e4c7a0'] },
  { id: 'alpine', title: 'Snow still on the far side', place: 'Lake / mountain study', seed: 4412, palette: ['#d7ded8', '#647c85', '#f1ead8'] },
  { id: 'marsh', title: 'Where the reeds keep time', place: 'Marsh / dusk study', seed: 625, palette: ['#e4b7a3', '#677477', '#ce975f'] },
  { id: 'desert', title: 'The long distance home', place: 'Desert / afternoon study', seed: 9018, palette: ['#efd5b8', '#b9795d', '#e9c48f'] }
]);
export const GENERATIVE_PREFIX = 'gen-';
export const generativeNames = LANDSCAPES.map(item => GENERATIVE_PREFIX + item.id);
export const isGenerativeName = name => typeof name === 'string' && generativeNames.includes(name);
export const landscapeInfo = Object.fromEntries(LANDSCAPES.map(item => [GENERATIVE_PREFIX + item.id, item]));

const palettes = {
  estuary: { paper:'#e9e7dc',sky:'#cfd7d0',cloud:'#e0ddd1',mist:'#adc4be',far:'#8ca5a2',middle:'#617d81',ground:'#263f48',water:'#517780',glaze:'#91afad',light:'#dfd6bb',detail:'#183743',accent:'#b9855c' },
  valley: { paper:'#ece4cb',sky:'#e6d6bd',cloud:'#f3e6cb',mist:'#c4c0a7',far:'#a6a993',middle:'#788767',ground:'#586847',water:'#a49b73',glaze:'#d3b17a',light:'#ead5ab',detail:'#4c6249',accent:'#ae6f43' },
  headland: { paper:'#dce0d9',sky:'#b7c6c4',cloud:'#d6dad0',mist:'#96b0b1',far:'#78969d',middle:'#486e79',ground:'#294651',water:'#527e87',glaze:'#91b4b6',light:'#d7d6c4',detail:'#223f48',accent:'#ba9071' },
  alpine: { paper:'#e8ebe5',sky:'#cad9d9',cloud:'#eef0e9',mist:'#bacbca',far:'#99afb9',middle:'#607f8b',ground:'#385865',water:'#537987',glaze:'#93b1b0',light:'#e8ebdf',detail:'#23434d',accent:'#bc9c7b' },
  marsh: { paper:'#ede1d7',sky:'#d9afa5',cloud:'#e8c7b5',mist:'#bc9d98',far:'#8c8983',middle:'#606c6e',ground:'#34484b',water:'#6d7a7b',glaze:'#bd9d85',light:'#f0d0a7',detail:'#263c40',accent:'#dc9d66' },
  desert: { paper:'#eddfc9',sky:'#ecd2b3',cloud:'#f0dfc9',mist:'#d4b8a0',far:'#b89983',middle:'#b77762',ground:'#925946',water:'#d5b18a',glaze:'#deb38e',light:'#eed0a4',detail:'#754b40',accent:'#c57b4f' }
};
function keyedRandom(seed, label) {
  let state = (seed ^ 2166136261) >>> 0;
  for (const character of label) state = Math.imul(state ^ character.charCodeAt(0), 16777619) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let v = state; v = Math.imul(v ^ v >>> 15, v | 1);
    v ^= v + Math.imul(v ^ v >>> 7, v | 61);
    return ((v ^ v >>> 14) >>> 0) / 4294967296;
  };
}
const round = n => Number(n.toFixed(4));
const point = (x, y, pressure) => pressure === undefined ? [round(x), round(y)] : [round(x), round(y), round(pressure)];
const between = (r, lo, hi) => lo + (hi - lo) * r();
const choose = (r, list) => list[Math.floor(r() * list.length)];
const polygon = coords => coords.map(([x,y]) => point(x,y));
function organicRidge(r, y, rise=.06, center=.46, spread=.3, irregularity=.008, phase=0) {
  const vertices = [];
  for (let i = 0; i <= 22; i++) {
    const x = -.06 + i * 1.12 / 22;
    const gaussian = Math.exp(-Math.pow((x-center)/spread, 2));
    const rolling = Math.sin(x * Math.PI * 3 + phase) * rise * .18;
    vertices.push(point(x, y - rise * gaussian + rolling + between(r, -irregularity, irregularity)));
  }
  vertices.push(point(1.06, 1.05), point(-.06, 1.05));
  return vertices;
}
function material(medium,color,size,options={}) { return {medium,color,size,...options}; }
function layers() { return { sky: [], distant: [], land: [], passage: [] }; }
function makeBrushes(p) {
  return {
    atmosphere: material('watercolor',p.sky,.17,{opacity:.40,wetness:.7,granulation:.25}),
    haze: material('watercolor',p.cloud,.09,{opacity:.25,wetness:.65}),
    mist: material('watercolor',p.mist,.065,{opacity:.36,wetness:.65,granulation:.32}),
    far: material('watercolor',p.far,.07,{opacity:.70,wetness:.53,granulation:.38}),
    mid: material('watercolor',p.middle,.06,{opacity:.85,wetness:.42,granulation:.43}),
    ground: material('ink',p.ground,.028,{opacity:.83,load:.8,roughness:.4,bristles:18}),
    water: material('watercolor',p.water,.1,{opacity:.66,wetness:.65,granulation:.44}),
    glaze: material('watercolor',p.glaze,.02,{opacity:.36,wetness:.38,granulation:.48}),
    light: material('watercolor',p.light,.035,{opacity:.50,wetness:.28}),
    detail: material('ink',p.detail,.006,{opacity:.78,load:.7,roughness:.53,bristles:12}),
    dry: material('graphite',p.detail,.005,{opacity:.45,roughness:.82,bristles:10}),
    brush: material('oil',p.accent,.015,{opacity:.72,load:.78,roughness:.43,bristles:12}),
    accent: material('knife',p.accent,.021,{opacity:.75,load:.65,bristles:9})
  };
}
function builder(seed,preset) {
  let sequence=0;
  const L=layers();
  const mk=(layer, command) => {
    L[layer].push({id:'mark-'+(++sequence),...command});
  };
  const fill=(layer,material,coords) => mk(layer,{op:'fill',material,polygon:polygon(coords)});
  const stroke=(layer,material,coords,more={}) => mk(layer,{op:'stroke',material,path:coords.map(p=>point(p[0],p[1],p[2])),...more});
  const ridge=(layer,material,r,y,rise,center,spread,irregularity=.008,phase=0) => mk(layer,{op:'fill',material,polygon:organicRidge(r,y,rise,center,spread,irregularity,phase)});
  function strokes(layer,material,r,{count=12,xmin=.1,xmax=.9,ymin=.65,ymax=.9,length=.13,tilt=.01}={}) {
    for(let i=0;i<count;i++){
      const x=between(r,xmin,xmax),y=between(r,ymin,ymax);
      const len=between(r,length*.35,length);
      const drift=between(r,-tilt,tilt);
      stroke(layer,material,[[x,y,.06],[x+len*.48,y+drift*.5,between(r,.3,.8)],[x+len,y+drift,.05]]);
    }
  }
  function grass(layer,r,x,y,count=8,height=.10,width=.1,material='detail') {
    for(let i=0;i<count;i++){
      const base=x+between(r,-width/2,width/2);
      const topY=y-between(r,height*.35,height);
      const wind=between(r,-.04,.055);
      stroke(layer,material,[[base,y,.8],[base+wind*.42,(y+topY)/2,.40],[base+wind,topY,.025]]);
    }
  }
  const sun=(layer,x,y,radius,material='light',r=keyedRandom(seed,'sun')) => {
    const coords=[];
    for(let i=0;i<22;i++){let a=i*Math.PI*2/22,rr=radius*between(r,.965,1.035);coords.push([x+Math.cos(a)*rr,y+Math.sin(a)*rr]);}
    fill(layer,material,coords);
  };
  function sky(horizon,withSun=false) {
    fill('sky','atmosphere',[[-.03,-.02],[1.03,-.02],[1.03,horizon+.12],[-.03,horizon+.1]]);
    const r=keyedRandom(seed,preset+'-sky');
    for(let i=0;i<3;i++){
      const y=between(r,.055,horizon*.76);
      const x=between(r,-.12,.32), len=between(r,.27,.84);
      stroke('sky','haze',[[x,y+.018,.05],[x+len*.47,y-.014,.38],[x+len,y+.005,.04]]);
    }
    if(withSun) sun('sky',between(r,.65,.77),between(r,.22,.34),between(r,.047,.076));
  }
  return {L,mk,fill,stroke,ridge,strokes,grass,sun,sky};
}
function estuary(b,seed,shift){
  const r=keyedRandom(seed,'estuary-structure');
  const h=.52+shift;
  b.sky(h);
  b.ridge('distant','mist',r,h+.05,.09,.31,.35,.005,1);
  b.ridge('distant','far',r,h+.115,.07,.73,.26,.007,2);
  b.fill('land','water',[[-.03,h+.13],[.35,h+.105],[.8,h+.12],[1.03,h+.08],[1.03,1.04],[-.03,1.04]]);
  b.fill('land','ground',[[-.03,.81],[.08,.79],[.20,.82],[.36,.91],[.5,1.03],[-.03,1.03]]);
  b.fill('land','ground',[[.82,1.04],[.91,.87],[1.03,.80],[1.03,1.04]]);
  b.strokes('passage','glaze',r,{count:19,ymin:.65,ymax:.94,length:.26,tilt:.008});
  b.strokes('passage','light',r,{count:9,xmin:.33,xmax:.8,ymin:.63,ymax:.85,length:.1,tilt:.006});
  b.grass('passage',r,.12,.88,15,.22,.22);
  b.grass('passage',r,.92,.96,11,.19,.17);
  b.stroke('passage','brush',[[.71,.55,.10],[.73,.55,.65],[.745,.552,.06]]);
  b.stroke('passage','brush',[[.725,.68,.09],[.738,.68,.28],[.755,.687,.05]]);
}
function valley(b,seed,shift){
  const r=keyedRandom(seed,'valley-structure');
  b.sky(.57+shift,true);
  b.ridge('distant','mist',r,.57,.075,.6,.42,.006,1.4);
  b.ridge('distant','far',r,.69,.085,.25,.42,.006,2);
  b.ridge('land','mid',r,.79,.11,.75,.47,.007,1);
  b.fill('land','ground',[[-.04,.83],[.28,.78],[.4,.86],[.56,.80],[.73,.84],[1.04,.76],[1.04,1.04],[-.04,1.04]]);
  // A narrow, asymmetric track recedes into the far hill.
  b.fill('passage','light',[[.49,.68],[.515,.67],[.53,.79],[.63,1.04],[.35,1.04],[.47,.79]]);
  b.stroke('passage','glaze',[[.53,.72,.05],[.555,.84,.3],[.56,.98,.05]]);
  b.strokes('passage','glaze',r,{count:18,xmin:.02,xmax:.94,ymin:.72,ymax:.96,length:.16,tilt:.025});
  b.strokes('passage','dry',r,{count:14,xmin:.02,xmax:.92,ymin:.83,ymax:.99,length:.08,tilt:.024});
  // One imperfectly balanced tree: directional canopy made from separate strokes.
  const tx=.78+between(r,-.035,.035);
  b.stroke('passage','detail',[[tx,.80,1],[tx-.006,.69,.7],[tx-.013,.60,.15]]);
  b.stroke('passage','detail',[[tx-.004,.71,.8],[tx-.065,.67,.25],[tx-.08,.64,.02]]);
  b.stroke('passage','detail',[[tx-.01,.67,.7],[tx+.07,.61,.1]]);
  for(let i=0;i<14;i++){
    const x=tx+between(r,-.08,.07),y=between(r,.57,.68);
    b.stroke('passage',i%3===0?'ground':'detail',[[x-.015,y,.15],[x,y-.009,.65],[x+.02,y+.004,.08]]);
  }
  b.grass('passage',r,.06,.97,7,.11,.12,'dry');
}
function headland(b,seed,shift){
  const r=keyedRandom(seed,'headland-structure');
  b.sky(.50+shift);
  b.ridge('distant','far',r,.62,.07,.76,.30,.005,1);
  b.fill('land','water',[[-.04,.62],[1.04,.60],[1.04,1.03],[-.04,1.03]]);
  b.fill('land','ground',[[-.04,.48],[.09,.49],[.2,.57],[.27,.58],[.23,.65],[.34,.72],[.28,.8],[.25,.89],[.35,1.03],[-.04,1.03]]);
  b.fill('passage','mid',[[.05,.52],[.16,.60],[.21,.63],[.13,.69],[.25,.76],[.17,.87],[.24,1.03],[-.04,1.03],[-.04,.54]]);
  b.stroke('passage','light',[[.28,.77,.12],[.36,.80,.5],[.48,.81,.03]]);
  b.strokes('passage','glaze',r,{count:23,xmin:.30,xmax:.97,ymin:.65,ymax:.94,length:.18,tilt:.012});
  b.strokes('passage','light',r,{count:11,xmin:.21,xmax:.72,ymin:.73,ymax:.97,length:.09,tilt:.013});
  for(let i=0;i<7;i++){
    const x=between(r,-.01,.23), y=between(r,.60,.97);
    b.stroke('passage','detail',[[x,y+.025,.02],[x+.025,y,.64],[x+.06,y-.013,.06]]);
  }
  b.stroke('sky','detail',[[.71,.26,.04],[.723,.272,.55],[.736,.258,.04]]);
  b.stroke('sky','detail',[[.775,.29,.04],[.787,.3,.55],[.8,.289,.04]]);
}
function alpine(b,seed,shift){
  const r=keyedRandom(seed,'alpine-structure');
  b.sky(.48+shift);
  // Mountain silhouettes: offset peaks, not repeated uniform triangles.
  b.fill('distant','far',[[-.05,.65],[.08,.51],[.18,.54],[.35,.29],[.43,.45],[.55,.34],[.7,.51],[.84,.38],[1.04,.62],[1.04,.77],[-.05,.77]]);
  b.fill('distant','mid',[[-.04,.71],[.1,.64],[.27,.46],[.38,.54],[.55,.48],[.68,.61],[.85,.5],[1.04,.63],[1.04,.81],[-.04,.81]]);
  b.fill('land','water',[[-.04,.69],[1.04,.68],[1.04,1.03],[-.04,1.03]]);
  b.fill('land','ground',[[-.04,.93],[.13,.87],[.29,.93],[.37,1.03],[-.04,1.03]]);
  b.fill('land','ground',[[.84,1.03],[.94,.88],[1.04,.86],[1.04,1.03]]);
  b.fill('passage','light',[[.31,.36],[.35,.29],[.395,.40],[.382,.398],[.35,.35]]);
  b.fill('passage','light',[[.53,.37],[.55,.34],[.585,.40],[.57,.398]]);
  b.strokes('passage','glaze',r,{count:27,xmin:.10,xmax:.91,ymin:.75,ymax:.97,length:.16,tilt:.004});
  b.strokes('passage','light',r,{count:7,xmin:.27,xmax:.75,ymin:.74,ymax:.89,length:.11,tilt:.007});
  // Two asymmetrical fir clusters: tapered main shafts and angled boughs.
  for (const [start,count] of [[.07,6],[.93,5]]) {
    for(let i=0;i<count;i++){
      const x=start+between(r,-.09,.09),h=between(r,.07,.22),y=.94;
      b.stroke('passage','detail',[[x,y,.7],[x+.006,y-h*.55,.45],[x+.007,y-h,.04]]);
      for(let k=1;k<=3;k++){
        const yp=y-h*k/4,arm=h*(.36-k*.065);
        b.stroke('passage','detail',[[x-arm,yp+.015,.02],[x,yp-.004,.73],[x+arm*.7,yp+.016,.02]]);
      }
    }
  }
}
function marsh(b,seed,shift){
  const r=keyedRandom(seed,'marsh-structure');
  b.sky(.58+shift,true);
  b.ridge('distant','mist',r,.56,.035,.45,.55,.003,1);
  b.fill('land','water',[[-.04,.62],[1.04,.62],[1.04,1.04],[-.04,1.04]]);
  b.fill('land','mid',[[-.04,.70],[.14,.69],[.29,.72],[.47,.71],[.61,.75],[.80,.71],[1.04,.70],[1.04,.77],[-.04,.77]]);
  b.fill('land','ground',[[-.04,.89],[.16,.85],[.27,.88],[.38,.94],[.51,1.04],[-.04,1.04]]);
  b.fill('land','ground',[[.72,1.04],[.88,.87],[1.04,.85],[1.04,1.04]]);
  b.strokes('passage','glaze',r,{count:26,xmin:.05,xmax:.95,ymin:.67,ymax:.96,length:.2,tilt:.005});
  b.strokes('passage','light',r,{count:10,xmin:.59,xmax:.8,ymin:.67,ymax:.92,length:.09,tilt:.006});
  b.grass('passage',r,.12,.92,24,.26,.27);
  b.grass('passage',r,.92,.99,21,.27,.22);
  for(let i=0;i<5;i++){
    const x=between(r,.12,.93), y=between(r,.71,.81);
    b.stroke('passage','detail',[[x,y,.25],[x+.02,y-.012,.6],[x+.04,y,.02]]);
  }
}
function desert(b,seed,shift){
  const r=keyedRandom(seed,'desert-structure');
  b.sky(.60+shift,true);
  b.fill('distant','mist',[[-.04,.66],[.06,.64],[.17,.6],[.23,.61],[.28,.53],[.42,.53],[.44,.59],[.57,.62],[.75,.56],[.83,.60],[1.04,.63],[1.04,.83],[-.04,.83]]);
  b.fill('distant','far',[[-.04,.72],[.11,.70],[.18,.59],[.37,.59],[.43,.66],[.63,.68],[.78,.57],[.92,.57],[.96,.68],[1.04,.69],[1.04,.91],[-.04,.91]]);
  b.ridge('land','mid',r,.86,.06,.45,.53,.008,1.4);
  b.fill('land','ground',[[-.04,.90],[.14,.84],[.29,.87],[.49,.83],[.68,.86],[.83,.82],[1.04,.83],[1.04,1.04],[-.04,1.04]]);
  b.fill('passage','light',[[.53,.76],[.56,.76],[.52,.84],[.46,.9],[.54,1.04],[.31,1.04],[.39,.9],[.48,.83]]);
  b.strokes('passage','glaze',r,{count:24,xmin:.02,xmax:.96,ymin:.77,ymax:.98,length:.14,tilt:.022});
  b.strokes('passage','dry',r,{count:16,xmin:.02,xmax:.95,ymin:.85,ymax:.99,length:.07,tilt:.020});
  for(let i=0;i<12;i++){
    const x=between(r,.04,.95), y=between(r,.86,.98);
    b.stroke('passage','detail',[[x-.011,y,.05],[x,y-.025,.6],[x+.013,y+.001,.03]]);
  }
  b.stroke('passage','brush',[[.88,.74,.08],[.91,.736,.5],[.95,.74,.02]]);
}
const creators={estuary,valley,headland,alpine,marsh,desert};

/** Produce an editable, schema-v1 painting score. No custom draw calls escape the engine. */
export function createGenerativeLandscape(name, width=480, height=320, seed) {
  const id = name.startsWith(GENERATIVE_PREFIX) ? name.slice(GENERATIVE_PREFIX.length) : name;
  const preset=LANDSCAPES.find(x=>x.id===id);
  if(!preset) throw new Error('Unknown generative landscape '+name);
  const chosenSeed=seed===undefined ? preset.seed : seed;
  if(!Number.isInteger(chosenSeed)||chosenSeed<0||chosenSeed>4294967295) throw new Error('Seed must be a 32-bit unsigned integer');
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<16||height<16||width>960||height>960) throw new Error('Invalid landscape canvas dimensions');
  const p=palettes[id];
  const b=builder(chosenSeed,id);
  const r=keyedRandom(chosenSeed,id+'-horizon');
  creators[id](b,chosenSeed,between(r,-.017,.017));
  return {
    version:'1.0',width,height,seed:chosenSeed,background:p.paper,
    paper:{texture:.38,absorbency:.56},
    materials:makeBrushes(p),
    layers:[
      {id:'atmosphere',commands:b.L.sky},
      {id:'distance',commands:b.L.distant},
      {id:'terrain',commands:b.L.land},
      {id:'handwork',commands:b.L.passage}
    ]
  };
}
