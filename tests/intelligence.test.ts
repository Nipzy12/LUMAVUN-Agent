import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildBrainPrompt } from '../src/intelligence';
import { DEFAULT_BRAIN, withExtra } from '../src/featureState';
import { runResearch } from '../src/research';
import type { APITool, Completion, ToolCall } from '../src/provider';

const searchTool: APITool = {type:'function',function:{
  name:'search_web',description:'Search current web pages',
  parameters:{type:'object',properties:{q:{type:'string'}},required:['q']}
}};
const call=(id:string,q:string):ToolCall=>({
  id,type:'function',function:{name:'search_web',arguments:JSON.stringify({q})}
});
const answer=(content:string,toolCalls:ToolCall[]=[]):Completion=>({
  model:'test-model',content,toolCalls
});

test('brain settings migrate for older installations and respect custom prompt size',()=>{
  assert.deepEqual(withExtra({}).brain,DEFAULT_BRAIN);
  assert.equal(withExtra({brain:{...DEFAULT_BRAIN,customPrompt:'x'.repeat(9000)}}).brain.customPrompt.length,4000);
});
test('AI identity reports configured model without unsupported claims',()=>{
  const prompt=buildBrainPrompt({...DEFAULT_BRAIN,reasoning:'deep'},'chat','openrouter/test-model');
  assert.match(prompt,/openrouter\/test-model/);
  assert.match(prompt,/decompose complex problems/);
  assert.match(prompt,/Do not claim browsing/);
  assert.doesNotMatch(prompt,/You are not a model/);
});
test('research refuses to claim live search when the model never calls tools',async()=>{
  const response=await runResearch([{role:'user',content:'News'}],{
    mode:'web',tools:[searchTool],complete:async()=>answer('I may guess, but no search'),
    approve:async()=>true,call:async()=>{throw Error('Unexpected call')}
  });
  assert.equal(response.calls,0);
  assert.deepEqual(response.sources,[]);
  assert.match(response.content,/Tidak ada hasil riset web yang dapat diklaim/);
});
test('deep research uses two approved tool calls and retains grounded URLs',async()=>{
  let rounds=0,calls=0;
  const response=await runResearch([{role:'user',content:'Compare sources'}],{
    mode:'deep',tools:[searchTool],
    complete:async()=>++rounds===1?answer('',[call('a','study A')]):
      rounds===2?answer('',[call('b','study B')]):answer('Both pages agree [one](https://a.example/article).'),
    approve:async()=>true,
    call:async()=>{calls++;return calls===1?'Source https://a.example/article': 'Second https://b.example/paper'}
  });
  assert.equal(calls,2);
  assert.equal(response.calls,2);
  assert.deepEqual(response.sources,['https://a.example/article','https://b.example/paper']);
  assert.match(response.content,/https:\/\/b.example\/paper/);
});
test('denied search never reaches external executor',async()=>{
  let rounds=0,called=0;
  const response=await runResearch([{role:'user',content:'Search'}],{
    mode:'web',tools:[searchTool],complete:async()=>++rounds===1?
      answer('',[call('r1','private')]):answer('No results'),
    approve:async()=>false,call:async()=>{called++;return 'not allowed'}
  });
  assert.equal(called,0);
  assert.equal(response.calls,0);
  assert.match(response.content,/ditolak/);
});
test('research without a connector errors rather than forging sources',async()=>{
  await assert.rejects(runResearch([],{
    mode:'deep',tools:[],complete:async()=>answer(''),
    approve:async()=>true,call:async()=> 'fake'
  }),/MCP search/);
});
