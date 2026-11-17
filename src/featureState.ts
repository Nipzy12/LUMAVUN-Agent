export type CapabilityKey = 'webSearch'|'artifacts'|'visualizations'|'codeTools'|'modelFallback'|'chatMemory'|'sensitiveMemory';
export type CapabilityState = Record<CapabilityKey,boolean> & { toolAccess: 'auto'|'ask'|'always' };
export const DEFAULT_CAPABILITIES: CapabilityState = {
  webSearch:false, artifacts:true, visualizations:true, codeTools:true,
  modelFallback:false, chatMemory:false, sensitiveMemory:false, toolAccess:'ask'
};
export type Connector = { id:string; name:string; url:string; enabled:boolean; toolCount:number; verified:boolean };
export type Skill = { id:string; name:string; repo:string; path:string; text:string; installedAt:number; enabled:boolean };
export type MemoryNote = { id:string; text:string; createdAt:number };
export type UsageEvent = { at:number; kind:'chat'|'agent'|'local'; model:string; promptTokens:number|null; completionTokens:number|null };
export type LocalModelInfo = { id:string; name:string; sizeBytes:number; url:string; sha256?:string; family:string; installed:boolean };

export type BrainSettings = {
  reasoning: 'fast' | 'balanced' | 'deep';
  research: 'off' | 'web' | 'deep';
  customPrompt: string;
};
export const DEFAULT_BRAIN: BrainSettings = {
  reasoning: 'balanced', research: 'off', customPrompt: ''
};

export type ExtraState = {
  capabilities:CapabilityState;
  brain:BrainSettings;
  builtinExaEnabled:boolean;
  builtinSkillsEnabled:boolean;
  autoStyleMemory:boolean;
  connectorDiscovery:boolean;
  connectors:Connector[];
  skills:Skill[];
  memoryNotes:MemoryNote[];
  usageEvents:UsageEvent[];
  localModelId:string;
  localModelInstalled:string[];
};
export const DEFAULT_EXTRA: ExtraState = {
  capabilities:DEFAULT_CAPABILITIES,brain:DEFAULT_BRAIN,builtinExaEnabled:true,builtinSkillsEnabled:true,autoStyleMemory:true,connectorDiscovery:true,connectors:[],skills:[],memoryNotes:[],usageEvents:[],
  localModelId:'',localModelInstalled:[]
};
export function withExtra(raw: Partial<ExtraState>):ExtraState {
  return {...DEFAULT_EXTRA,...raw,
    capabilities:{...DEFAULT_CAPABILITIES,...(raw.capabilities||{})},
    builtinExaEnabled:raw.builtinExaEnabled!==false,
    builtinSkillsEnabled:raw.builtinSkillsEnabled!==false,
    autoStyleMemory:raw.autoStyleMemory!==false,
    brain:{...DEFAULT_BRAIN,...(raw.brain||{}),
      customPrompt:typeof raw.brain?.customPrompt==='string' ? raw.brain.customPrompt.slice(0,4000) : ''},
    connectors:Array.isArray(raw.connectors)?raw.connectors:[],
    skills:Array.isArray(raw.skills)?raw.skills:[],
    memoryNotes:Array.isArray(raw.memoryNotes)?raw.memoryNotes:[],
    usageEvents:Array.isArray(raw.usageEvents)?raw.usageEvents:[],
    localModelInstalled:Array.isArray(raw.localModelInstalled)?raw.localModelInstalled:[]
  };
}
export function addUsage(events:UsageEvent[],value:UsageEvent):UsageEvent[]{
  return [...events.filter(x=>Number.isFinite(x.at)).slice(-499),value];
}
export function usageSummary(events:UsageEvent[],time=Date.now()){
  const week=events.filter(x=>x.at>time-7*86400000&&x.at<=time);
  return { calls:week.length,cloud:week.filter(x=>x.kind!=='local').length,local:week.filter(x=>x.kind==='local').length,
    promptTokens:week.reduce((n,x)=>n+(x.promptTokens||0),0),
    completionTokens:week.reduce((n,x)=>n+(x.completionTokens||0),0),
    countWithProviderUsage:week.filter(x=>x.promptTokens!==null).length };
}
export function sanitizeSkillText(text:string){return text.slice(0,18000);}
export function validMcpUrl(value:string):boolean{
  try {const u=new URL(value);return !u.username&&!u.password&&(u.protocol==='https:'||
    (u.protocol==='http:'&&['localhost','127.0.0.1','10.0.2.2'].includes(u.hostname)));} catch {return false;}
}
