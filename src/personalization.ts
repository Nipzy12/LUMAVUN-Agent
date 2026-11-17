import type { UserPreferences } from './store';

export const PERSONALITIES = [
  {id:'default',name:'Bawaan',instruction:'Helpful, clear, considerate and factual.'},
  {id:'cynical',name:'Sinis',instruction:'Use dry wit and restrained sarcasm for light subjects. Be respectful for serious matters.'},
  {id:'friendly',name:'Ramah',instruction:'Conversational, welcoming and approachable.'},
  {id:'professional',name:'Profesional',instruction:'Precise and businesslike, with clear explanations.'},
  {id:'direct',name:'Lugas',instruction:'Prioritize direct, practical answers with minimal preamble.'},
  {id:'creative',name:'Kreatif',instruction:'Offer imaginative and original ideas while keeping facts separate from speculation.'}
] as const;
export type PersonalityId=typeof PERSONALITIES[number]['id'];
export type PreferenceLevel=0|1|2;
export type AppLanguage='id'|'en';
const level=(n:unknown,defaultValue:PreferenceLevel):PreferenceLevel =>
  n===0||n===1||n===2?n:defaultValue;
const string=(s:unknown,max:number)=>typeof s==='string'?s.trim().slice(0,max):'';

export function normalizePreferences<T extends UserPreferences>(value:Partial<T>):UserPreferences{
  const personality=PERSONALITIES.find(p=>p.id===value.personality)?.id||'default';
  return {
    name:string(value.name,32)||'Pengguna',
    fullName:string(value.fullName,100),
    personalInstructions:string(value.personalInstructions,4000),
    personalityInstructions:string(value.personalityInstructions,4000),
    personality,
    warmth:level(value.warmth,1),
    enthusiasm:level(value.enthusiasm,1),
    formatting:level(value.formatting,1),
    emoji:level(value.emoji,1),
    appLanguage:value.appLanguage==='en'?'en':'id',
    quickAnswers:value.quickAnswers===true,
    homeSuggestions:value.homeSuggestions!==false,
    librarySearch:value.librarySearch===true,
    visualAnswers:value.visualAnswers!==false,
    referencePhotoUris:Array.isArray(value.referencePhotoUris)?
      value.referencePhotoUris.filter((uri):uri is string=>typeof uri==='string'&&uri.startsWith('file:')).slice(0,3):[],
    petName:string(value.petName,80),
    haptics:value.haptics!==false,
    hideTabs:value.hideTabs===true,
    largeText:value.largeText===true
  };
}

/** User-visible controls map to bounded, ordinary instruction text. */
export function personalityPrompt(p:UserPreferences):string{
  const personality=PERSONALITIES.find(x=>x.id===p.personality)||PERSONALITIES[0];
  const warmth=['Maintain a neutral, concise tone.','Be considerate without overdoing reassurance.',
    'Use warm, empathetic wording when appropriate.'][p.warmth];
  const enthusiasm=['Remain calm and understated.','Show interest in the topic.',
    'Respond with more energy and curiosity where suitable.'][p.enthusiasm];
  const formatting=['Prefer paragraphs; avoid unnecessary lists.','Use headings and lists where useful.',
    'Use structured headings and concise lists for complex answers.'][p.formatting];
  const emoji=['Avoid emojis.','Use an occasional emoji only in informal exchanges.',
    'Allow emojis in casual conversations, not serious or technical responses.'][p.emoji];
  const name=p.name!=='Pengguna'?\'If relevant, the user prefers to be called "\'+p.name+'". Do not overuse their name.\':'';
  const pieces=[
    'LUMAVUN personalization (user preferences, lower priority than safety and actual tool results):',
    'Respond in '+(p.appLanguage==='en'?'English.':'Bahasa Indonesia.'),
    personality.instruction,warmth,enthusiasm,formatting,emoji,name,
    p.quickAnswers?'Quick answers enabled: answer succinctly using available knowledge; avoid nonessential background research and do not include stored personal memories.':'',
    p.visualAnswers?'For spatial or numerical comparisons, use readable tables or structured formatting if supported.':'Prefer text rather than visual-style formatting.',
    p.personalInstructions?'User profile preferences:\n'+p.personalInstructions.slice(0,4000):'',
    p.personalityInstructions?'Custom tone instructions:\n'+p.personalityInstructions.slice(0,4000):''
  ];
  return pieces.filter(Boolean).join('\n\n').slice(0,9800);
}

export function profileHasChanges(a:UserPreferences,b:UserPreferences):boolean{
  return JSON.stringify(a)!==JSON.stringify(b);
}
