import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUILTIN_REFERENCES, BUILTIN_EXA_CONNECTOR, EXA_MCP_URL,
  allResearchConnectors, builtinGuidance, modelIdentityAnswer } from '../src/builtinRegistry';
import { runDirectWeb, evidenceUrls, searchArguments } from '../src/directResearch';
import type { Connector } from '../src/featureState';
import type { MCPTool } from '../src/mcpClient';

test('built-in registry contains every requested source and is frozen',()=>{
  assert.equal(BUILTIN_REFERENCES.length,14);
  assert.ok(Object.isFrozen(BUILTIN_REFERENCES));
  assert.ok(BUILTIN_REFERENCES.every(x=>Object.isFrozen(x)));
  const ids=BUILTIN_REFERENCES.map(x=>x.id);
  assert.equal(new Set(ids).size,ids.length);
  for(const name of ['open-websearch','heventure','zimzilla','uncensored-ai','openjutsu',
    'kimi-k3','wan2','voicestudio','comfyui','artemis','vibe-trading','trader-skill','replica-skill','exa']){
    assert.ok(ids.includes(name),name);
  }
  assert.equal(BUILTIN_EXA_CONNECTOR.url,EXA_MCP_URL);
  assert.ok(Object.isFrozen(BUILTIN_EXA_CONNECTOR));
});
test('user-connected authenticated MCP server takes priority but built-in Exa stays locked',()=>{
  const custom:Connector={id:'user-exa',name:'Custom Exa',url:EXA_MCP_URL,verified:true,toolCount:2,enabled:true};
  const items=allResearchConnectors([custom,{...custom,id:'unused',enabled:false}]);
  assert.deepEqual(items.map(x=>x.id),['user-exa',BUILTIN_EXA_CONNECTOR.id]);
  assert.equal(items[1],BUILTIN_EXA_CONNECTOR);
});
test('scoped skill instructions apply only to relevant topics',()=>{
  assert.match(builtinGuidance('buat backtest risiko trading'),/Trader Skill/);
  assert.match(builtinGuidance('replika aplikasi React Native'),/Replica Skill/);
  assert.equal(builtinGuidance('1+1?'),'');
  assert.doesNotMatch(builtinGuidance('buat aplikasi'),/Trader Skill/);
});
test('selected Qwen model name is reported exactly instead of fabricated Mia identity',()=>{
  const answer=modelIdentityAnswer('model yang ku gunakan apa?','qwen-05-q4',
    'Qwen2.5 0.5B Instruct Q4_K_M',true);
  assert.match(answer||'',/Qwen2.5 0.5B Instruct Q4_K_M/);
  assert.match(answer||'',/GGUF/);
  assert.match(modelIdentityAnswer('Mia siapa?','qwen-05-q4','Qwen2.5 0.5B',true)||'',/bukan model bernama Mia/);
  assert.equal(modelIdentityAnswer('tuliskan puisi tentang model rumah','id','id',false),null);
});
const searchTool:MCPTool={name:'web_search_exa',inputSchema:{type:'object',properties:{query:{type:'string'}}}};
test('search arguments are derived from actual MCP tool schema',()=>{
  assert.deepEqual(searchArguments(searchTool,'q'),{query:'q'});
  assert.throws(()=>searchArguments({name:'broken',inputSchema:{type:'object',properties:{id:{type:'string'}}}},'q'),/query/);
});
test('direct web mode actually invokes authorized Exa tool and extracts source URLs',async()=>{
  let approves=0,invocations=0;
  const result=await runDirectWeb('aplikasi AI',[BUILTIN_EXA_CONNECTOR],'web',{
    discover:async()=>[searchTool],
    approve:async()=>{approves++;return true},
    invoke:async(_connector,tool,args)=>{
      invocations++;assert.equal(tool,'web_search_exa');
      assert.deepEqual(args,{query:'aplikasi AI'});
      return 'source https://example.org/data title Test';
    }
  });
  assert.equal(approves,1);assert.equal(invocations,1);
  assert.deepEqual(result.urls,['https://example.org/data']);
  assert.equal(result.calls,1);
});
test('direct deep research asks per call and never invokes rejected tools',async()=>{
  let approvals=0,calls=0;
  const result=await runDirectWeb('riset AI',[BUILTIN_EXA_CONNECTOR],'deep',{
    discover:async()=>[searchTool],
    approve:async()=>++approvals!==2,
    invoke:async()=>{calls++;return 'https://example.org/report'}
  });
  assert.equal(approvals,3);
  assert.equal(calls,2);
  assert.equal(result.calls,2);
});
test('refused searches do not claim that live web research happened',async()=>{
  let calls=0;
  await assert.rejects(runDirectWeb('riset',[BUILTIN_EXA_CONNECTOR],'web',{
    discover:async()=>[searchTool],approve:async()=>false,
    invoke:async()=>{calls++;return 'pretend'}
  }),/Tidak ada pencarian/);
  assert.equal(calls,0);
});
test('unreachable MCP server produces an explicit error',async()=>{
  await assert.rejects(runDirectWeb('riset',[BUILTIN_EXA_CONNECTOR],'web',{
    discover:async()=>{throw new Error('network failed')},
    approve:async()=>true,invoke:async()=>''
  }),/network failed/);
  assert.deepEqual(evidenceUrls('x https://example.org/path, y https://example.org/path.'),['https://example.org/path']);
});
