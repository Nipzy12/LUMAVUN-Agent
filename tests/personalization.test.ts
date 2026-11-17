import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizePreferences, PERSONALITIES, personalityPrompt, profileHasChanges } from '../src/personalization';
import { localLibraryContext } from '../src/localLibrary';
import type { Conversation, Project, UserArtifact } from '../src/types';

test('legacy name, haptics and chat font migrate with all new General defaults',()=>{
  const old=normalizePreferences({name:'Dwi',largeText:true,haptics:false});
  assert.equal(old.name,'Dwi');
  assert.equal(old.largeText,true);
  assert.equal(old.haptics,false);
  assert.equal(old.fullName,'');
  assert.equal(old.personality,'default');
  assert.equal(old.appLanguage,'id');
  assert.equal(old.homeSuggestions,true);
  assert.equal(old.quickAnswers,false);
  assert.equal(old.librarySearch,false);
});
test('invalid user preferences are clamped and safe when reading old saved state',()=>{
  const raw=normalizePreferences({
    name:'  ',personality:'invalid' as any,warmth:23 as any,emoji:-1 as any,
    appLanguage:'fr' as any,referencePhotoUris:['https://not-a-local-image.test/pic','file:///private/profile.jpg']
  });
  assert.equal(raw.name,'Pengguna');
  assert.equal(raw.personality,'default');
  assert.equal(raw.warmth,1);
  assert.equal(raw.emoji,1);
  assert.equal(raw.appLanguage,'id');
  assert.deepEqual(raw.referencePhotoUris,['file:///private/profile.jpg']);
});
test('customized tone actually reaches a bounded AI prompt with explicit preferences',()=>{
  const profile=normalizePreferences({name:'Dwi',personality:'cynical',
    warmth:0,enthusiasm:2,formatting:2,emoji:0,
    personalInstructions:'Sertakan pro dan kontra.',
    personalityInstructions:'Jelaskan secara sistematis.'});
  const prompt=personalityPrompt(profile);
  assert.match(prompt,/dry wit/i);
  assert.match(prompt,/Sertakan pro dan kontra/);
  assert.match(prompt,/Jelaskan secara sistematis/);
  assert.match(prompt,/Avoid emojis/);
  assert.match(prompt,/headings/);
  assert.equal(PERSONALITIES.length,6);
});
test('quick answers explicitly skip memory; language controls assistant language',()=>{
  const profile=normalizePreferences({quickAnswers:true,appLanguage:'en'});
  const prompt=personalityPrompt(profile);
  assert.match(prompt,/Respond in English/);
  assert.match(prompt,/do not include stored personal memories/);
  assert.equal(profileHasChanges(profile,{...profile,quickAnswers:false}),true);
  assert.equal(profileHasChanges(profile,normalizePreferences(profile)),false);
});
test('local library uses actual title/path matches, never invents entries',()=>{
  const chats:Conversation[]=[{id:'c1',title:'Strategi Trading Emas',mode:'chat',model:'qwen',entries:[],
    createdAt:10,updatedAt:10}];
  const artifacts:UserArtifact[]=[{id:'a1',projectId:'p1',title:'Kode Trading Bot',
    path:'robot.ts',content:'const risk=0.01;',format:'code',createdAt:10,updatedAt:10}];
  const projects:Project[]=[{id:'p1',name:'Lumavun Trading',createdAt:10,
    description:'Platform charting'}];
  const results=localLibraryContext('trading',chats,artifacts,projects);
  assert.match(results,/Percakapan: Strategi Trading Emas/);
  assert.match(results,/Artefak: Kode Trading Bot/);
  assert.match(results,/Proyek: Lumavun Trading/);
  assert.equal(localLibraryContext('durian',chats,artifacts,projects),'');
});
