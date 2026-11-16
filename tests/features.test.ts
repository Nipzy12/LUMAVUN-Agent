
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_EXTRA, withExtra, validMcpUrl, addUsage, usageSummary } from '../src/featureState';
import { skillUrl, activeSkillContext } from '../src/githubSkills';
import { mcpFunctionName } from '../src/mcpClient';
import { runConnectedChat } from '../src/connectedChat';
import type { APITool } from '../src/provider';

test('old installations receive safe defaults without losing saved connector metadata',()=>{
  const s=withExtra({connectors:[{id:'mcp-1',name:'Demo',url:'https://example.com/mcp',enabled:true,toolCount:0,verified:false}]});
  assert.equal(s.connectors.length,1);
  assert.equal(s.capabilities.codeTools,true);
  assert.equal(s.capabilities.chatMemory,false);
  assert.deepEqual(withExtra({}).skills,DEFAULT_EXTRA.skills);
});

test('MCP URL validation blocks plain HTTP servers and credentials',()=>{
  assert.equal(validMcpUrl('https://mcp.example.com/api'),true);
  assert.equal(validMcpUrl('http://127.0.0.1:3000/mcp'),true);
  assert.equal(validMcpUrl('http://192.168.1.1/mcp'),false);
  assert.equal(validMcpUrl('https://user:pass@mcp.example.com'),false);
  assert.equal(validMcpUrl('file:///etc/passwd'),false);
});

test('MCP names fit provider function name constraints',()=>{
  const n=mcpFunctionName('mcp-abc-very-long-id','tool_name_with_a_long_name_to_exceed_the_max_length_and_more');
  assert.ok(n.length<=64);
  assert.match(n,/^[a-zA-Z0-9_-]+$/);
});

test('Skill URLs accept only GitHub owner/repo paths',()=>{
  assert.equal(skillUrl('anthropics/skills','skills/pdf/SKILL.md'),
    'https://raw.githubusercontent.com/anthropics/skills/main/skills/pdf/SKILL.md');
  assert.throws(()=>skillUrl('bad/../repo','SKILL.md'));
  assert.throws(()=>skillUrl('anthropics/skills','../../.env.md'));
});
test('Skills only enter context when enabled',()=>{
  const skill={id:'1',name:'Demo',repo:'a/b',path:'SKILL.md',text:'Write well',installedAt:100,enabled:false};
  assert.equal(activeSkillContext([skill]),'');
  assert.match(activeSkillContext([{...skill,enabled:true}]),/USER-ENABLED/);
});
test('Usage counts only actual recorded events',()=>{
  const now=Date.now();
  const events=addUsage([],{at:now,kind:'chat',model:'m',promptTokens:10,completionTokens:4});
  const s=usageSummary(events,now);
  assert.equal(s.calls,1);
  assert.equal(s.promptTokens,10);
  assert.equal(s.completionTokens,4);
  assert.equal(s.countWithProviderUsage,1);
});
const tool:APITool={type:'function',function:{
  name:'search',description:'Search',parameters:{type:'object',properties:{q:{type:'string'}},required:['q']}
}};
test('Connected chat never invokes a refused external search',async()=>{
  let n=0,called=0;
  const response=await runConnectedChat([{role:'user',content:'Search'}],{
    tools:[tool],complete:async()=>++n===1?
      {model:'x',content:'',toolCalls:[{id:'c1',type:'function',function:{name:'search',arguments:'{"q":"cats"}'}}]}:
      {model:'x',content:'No web content',toolCalls:[]},
    approve:async()=>false,
    call:async()=>{called++;return 'bad'}
  });
  assert.equal(called,0);
  assert.equal(response.content,'No web content');
  assert.equal(response.calls,1);
});
test('Connected chat executes an approved registered search only once',async()=>{
  let n=0,called=0;
  const response=await runConnectedChat([{role:'user',content:'Search'}],{
    tools:[tool],complete:async()=>++n===1?
      {model:'x',content:'',toolCalls:[{id:'c1',type:'function',function:{name:'search',arguments:'{"q":"cats"}'}}]}:
      {model:'x',content:'Found',toolCalls:[]},
    approve:async()=>true,call:async()=>{called++;return 'result'}
  });
  assert.equal(called,1);
  assert.equal(response.content,'Found');
});
