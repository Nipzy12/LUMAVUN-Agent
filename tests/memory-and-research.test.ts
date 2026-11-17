import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractWebSources,summarizeWebSources,researchSourcesFooter,isResearchTestPrompt} from '../src/researchFormatter';
import {extractStylePreference,memoryKey,isSensitiveMemoryText,pickMemory,memoryPrompt,type MemoryRecord} from '../src/memoryPolicy';
import {CLOUDFLARE_MODELS,PRESETS,fetchModels} from '../src/provider';

test('Exa MCP JSON with enormous content gets converted to short attributable snippets',()=>{
  const raw=JSON.stringify({content:[{type:'text',text:
    'Title: Tes - Education Jobs, Teaching Resources\nURL: https://www.tes.com/\nPublished: N/A\nHighlights: '+
    'School education resources '.repeat(350)+
    '\nTitle: Tes FAQ\nURL: https://www.tes.com/help\nHighlights: Help center'}]});
  const sources=extractWebSources(raw,'tes education');
  assert.equal(sources.length,2);
  assert.equal(sources[0].url,'https://www.tes.com/');
  assert.ok(sources.every(x=>x.snippet.length<=320));
  const formatted=summarizeWebSources(sources);
  assert.ok(formatted.length<1100);
  assert.doesNotMatch(formatted,/"content"|"type":"text"/);
  assert.match(researchSourcesFooter(sources),/https:\/\/www.tes.com/);
});
test('irrelevant and duplicate search result URLs are excluded',()=>{
  const payload=JSON.stringify({content:[
    {type:'text',text:'Title: A\nURL: https://example.org/a\nHighlights: alpha'},
    {type:'text',text:'Title: A copy\nURL: https://example.org/a\nHighlights: alpha'},
    {type:'text',text:'Title: B\nURL: javascript:alert(1)\nHighlights: no source'}
  ]});
  assert.equal(extractWebSources(payload).length,1);
  assert.deepEqual(extractWebSources('nonsense'),[]);
  assert.match(summarizeWebSources([]),/Tidak ditemukan sumber/);
});
test('bare test prompt skips external search, actual query is processed',()=>{
  for(const q of ['tes','test','Ping.','cek web'])assert.equal(isResearchTestPrompt(q),true);
  assert.equal(isResearchTestPrompt('apa itu tes dalam pendidikan?'),false);
});
test('automatic style memory captures explicit preferences only',()=>{
  assert.equal(extractStylePreference('Tolong jawab yang singkat ya'),'Pengguna menyukai jawaban ringkas dan langsung ke inti.');
  assert.equal(extractStylePreference('Gunakan bahasa Indonesia'),'Gunakan bahasa Indonesia dalam balasan.');
  assert.equal(extractStylePreference('jangan pakai emoji'),'Jangan gunakan emoji dalam balasan.');
  assert.equal(extractStylePreference('harga BTC sekarang berapa?'),null);
  assert.equal(extractStylePreference('jawab singkat, API key=secret'),null);
  assert.equal(isSensitiveMemoryText('seed phrase must remain secret'),true);
  assert.equal(memoryKey(' Halo   Dunia '),'halo dunia');
});
test('memory retrieval prioritizes style and matching explicit user facts',()=>{
  const records:MemoryRecord[]=[
    {id:'1',kind:'fact',source:'explicit',text:'Saya memiliki proyek LUMAVUN trading',createdAt:10,updatedAt:10},
    {id:'2',kind:'style',source:'observed',text:'Jawaban ringkas',createdAt:12,updatedAt:12},
    {id:'3',kind:'fact',source:'explicit',text:'Saya suka kopi',createdAt:11,updatedAt:11}
  ];
  assert.deepEqual(pickMemory(records,'ceritakan proyek trading').map(x=>x.id),['2','1']);
  const prompt=memoryPrompt(records,'project trading');
  assert.match(prompt,/Jawaban ringkas/);
  assert.doesNotMatch(prompt,/Saya suka kopi/);
});
test('Cloudflare Workers AI catalogue includes official GPT-OSS 120B',async()=>{
  assert.equal(PRESETS.cloudflare,'https://api.cloudflare.com/client/v4/accounts/ACCOUNT_ID/ai/v1');
  assert.ok(CLOUDFLARE_MODELS.some(x=>x.id==='@cf/openai/gpt-oss-120b'));
  const items=await fetchModels({provider:'cloudflare',baseUrl:'x',model:'',temperature:0.3},'');
  assert.deepEqual(items,CLOUDFLARE_MODELS);
});
