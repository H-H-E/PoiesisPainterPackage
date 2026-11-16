import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { Painter, validatePainting } from '../dist/index.js';
import { checkSiteBudget } from './budget.mjs';
import { MODEL, PLAN_FIELDS, PLAN_SCHEMA, SYSTEM_PROMPT, validatePrompt, parsePlan, compilePlan } from './ai-plan.mjs';
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const plan={landscape:'estuary',lighting:'dawn',weather:'mist',palette:'cool',focal:'boat',placement:'center',accent:'ochre',density:'sparse'};
const good=JSON.stringify(plan);
test('compact plan, safe JSON and prompt bounds',()=>{
  assert.ok(SYSTEM_PROMPT.length<1500);
  assert.equal(Object.keys(PLAN_SCHEMA.properties).length,8);
  assert.equal(PLAN_FIELDS.landscape.length,6);
  assert.equal(validatePrompt('Misty coastal inlet at sunset').ok,true);
  assert.equal(validatePrompt('x'.repeat(421)).ok,false);
  assert.equal(parsePlan(good).ok,true);
  assert.equal(parsePlan('no JSON').ok,false);
  assert.equal(parsePlan('{"landscape":"estuary"}').ok,false);
  assert.equal(parsePlan(JSON.stringify({...plan,code:'eval(1)'})).ok,false);
  assert.equal(parsePlan(String.fromCharCode(96).repeat(3)+'json\n'+good+'\n'+String.fromCharCode(96).repeat(3)).ok,true);
  assert.equal(MODEL,'nvidia/nemotron-3.5-lightning-free');
});
test('all six terrains and six focal subjects compile into valid, bounded deterministic scores',()=>{
  for(const landscape of PLAN_FIELDS.landscape)for(const focal of PLAN_FIELDS.focal){
    const choice={...plan,landscape,focal,density:focal==='tree'?'textured':'balanced'};
    const score=compilePlan(choice,3007,480,320);
    const validated=validatePainting(score);
    assert.equal(validated.valid,true,JSON.stringify({landscape,focal,issues:validated.errors}));
    assert.deepEqual(checkSiteBudget(score,validated.workload,JSON.stringify(score).length),[],landscape+'/'+focal);
    assert.deepEqual(score,compilePlan(choice,3007,480,320));
  }
  assert.throws(()=>compilePlan({...plan,landscape:'unknown'},1),/Invalid art direction/);
  assert.throws(()=>compilePlan(plan,-1),/Invalid seed/);
  assert.throws(()=>compilePlan(plan,1,1000,320),/Invalid dimensions/);
});
test('real Canvas2D renders deterministic pixels from generated scores',{timeout:120000},async()=>{
  const canvas=createCanvas(240,160),painter=new Painter(canvas,{canvasFactory:createCanvas,historyLimit:0});
  try{
    await painter.render(compilePlan({...plan,focal:'lighthouse'},17,240,160));
    const first=canvas.toBuffer('image/png');
    assert.ok(first.length>600);
    await painter.render(compilePlan({...plan,focal:'lighthouse'},17,240,160));
    assert.deepEqual(canvas.toBuffer('image/png'),first);
    await painter.render(compilePlan({...plan,focal:'lighthouse'},18,240,160));
    assert.notDeepEqual(canvas.toBuffer('image/png'),first);
  }finally{painter.dispose();}
});
let endpoint;
async function getEndpoint(){
  if(endpoint)return endpoint;
  await mkdir('.cache/poiesis-ai-test',{recursive:true});
  const outfile=resolve('.cache/poiesis-ai-test/paint.mjs');
  await build({entryPoints:['api/paint.ts'],bundle:true,format:'esm',platform:'node',target:'node22',outfile,logLevel:'silent'});
  endpoint=(await import(pathToFileURL(outfile).href)).handlePaint;
  return endpoint;
}
let index=0;
function request(data,headers={}){
  const head={'content-type':'application/json','x-vercel-forwarded-for':'test-'+(++index),...headers};
  return new Request('https://poiesis.test/api/paint',{method:'POST',headers:head,body:typeof data==='string'?data:JSON.stringify(data)});
}
const env=()=>({POIESIS_AI_ENABLED:'true',AI_GATEWAY_API_KEY:'mock-secret'});
function providerMock(outputs){
  const calls=[];
  const fake=async(url,init)=>{
    assert.equal(url,'https://ai-gateway.vercel.sh/v1/chat/completions');
    assert.equal(init.headers.Authorization,'Bearer mock-secret');
    const body=JSON.parse(init.body);
    assert.equal(body.model,MODEL);
    assert.equal(body.max_tokens,1024);
    assert.equal(body.response_format.type,'json_schema');
    assert.deepEqual(body.response_format.json_schema.schema,PLAN_SCHEMA);
    assert.ok(body.messages[0].content.includes('art director'));
    calls.push(body);
    return Response.json({choices:[{message:{content:outputs[calls.length-1]??outputs.at(-1)}}]});
  };
  return {fake,calls};
}
test('disabled route and invalid requests never reach Gateway',async()=>{
  const handle=await getEndpoint();
  assert.equal((await handle(request({prompt:'A distant mountain lake',seed:3}),{env:{}})).status,503);
  const status=await handle(new Request('https://poiesis.test/api/paint'),{env:{}});
  assert.equal((await status.json()).enabled,false);
  assert.equal((await handle(request({prompt:'short',seed:3}),{env:env()})).status,400);
  assert.equal((await handle(request({prompt:'A distant mountain lake',seed:-1}),{env:env()})).status,400);
  assert.equal((await handle(request({prompt:'A distant mountain lake',seed:3,secret:'x'}),{env:env()})).status,400);
  assert.equal((await handle(request('{'+'x'.repeat(3000)),{env:env()})).status,413);
  assert.equal((await handle(request({prompt:'A distant mountain lake',seed:3},{origin:'https://evil.test'}),{env:env()})).status,403);
  assert.equal((await handle(new Request('https://poiesis.test/api/paint',{method:'DELETE'}),{env:env()})).status,405);
});
test('Gateway output compiles into an actual schema-validated score in one call',async()=>{
  const handle=await getEndpoint(),mock=providerMock([good]);
  const reply=await handle(request({prompt:'A misty little boat on a blue estuary',seed:44}),{env:env(),fetcher:mock.fake});
  assert.equal(reply.status,200);
  const result=await reply.json();
  assert.equal(result.model,MODEL);
  assert.equal(result.attempts,1);
  assert.deepEqual(result.plan,plan);
  assert.equal(result.score.seed,44);
  assert.equal(validatePainting(result.score).valid,true);
  assert.equal(mock.calls.length,1);
  assert.equal(JSON.stringify(result).includes('mock-secret'),false);
});
test('malformed model result gets at most one repair; invalid response never reaches renderer',async()=>{
  const handle=await getEndpoint(),mock=providerMock(['{"landscape":"estuary"}',good]);
  const reply=await handle(request({prompt:'A misty little boat on a blue estuary',seed:45}),{env:env(),fetcher:mock.fake});
  assert.equal(reply.status,200);
  assert.equal((await reply.json()).attempts,2);
  assert.equal(mock.calls.length,2);
  assert.match(mock.calls[1].messages.at(-1).content,/Invalid JSON plan/);
  const bad=providerMock(['non JSON','still non JSON']);
  const fail=await handle(request({prompt:'An alpine cabin under morning light',seed:46}),{env:env(),fetcher:bad.fake});
  assert.equal(fail.status,422);
  assert.equal(bad.calls.length,2);
});
test('Gateway failures do not expose credentials or provider error body',async()=>{
  const handle=await getEndpoint();
  const reply=await handle(request({prompt:'Quiet northern valley, mist and sunrise',seed:53}),{
    env:env(),fetcher:async()=>new Response('SECRET PROVIDER BODY',{status:502})
  });
  assert.equal(reply.status,502);
  const body=JSON.stringify(await reply.json());
  assert.equal(body.includes('SECRET PROVIDER BODY'),false);
  assert.equal(body.includes('mock-secret'),false);
});
