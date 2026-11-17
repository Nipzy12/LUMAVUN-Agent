import type { Connector } from './featureState';
import type { MCPTool } from './mcpClient';

export type DirectWebDeps = {
  discover(connector: Connector): Promise<MCPTool[]>;
  invoke(connector: Connector, tool: string, args: Record<string, unknown>): Promise<string>;
  approve(connector: Connector, tool: string, args: Record<string, unknown>): Promise<boolean>;
  event?(message: string): void;
  signal?: AbortSignal;
};
export type DirectWebResult = { evidence: string; urls: string[]; calls: number; provider: string };
const urlPattern=/https?:\/\/[^\s<>"'\\)\]]+/g;
export function evidenceUrls(text: string): string[] {
  return [...new Set((text.match(urlPattern)||[]).map(x=>x.replace(/[.,;!}?]+$/,''))
    .filter(x=>{try{return ['http:','https:'].includes(new URL(x).protocol)}catch{return false}}))].slice(0,18);
}
export function searchArguments(tool: MCPTool, query: string): Record<string, unknown> {
  const keys=Object.keys(tool.inputSchema?.properties||{});
  const property=keys.find(k=>k==='query'||k==='q'||k==='search_query');
  if(!property)throw new Error('Tool pencarian tidak menyediakan parameter query.');
  return {[property]:query.slice(0,650)};
}
/** Tool invocation here is the real internet call, not model-predicted results. */
export async function runDirectWeb(query: string, connectors: Connector[],
  mode:'web'|'deep', deps:DirectWebDeps):Promise<DirectWebResult> {
  let provider='';let connector:Connector|undefined;let search:MCPTool|undefined;
  const errors:string[]=[];
  for(const item of connectors) {
    if(deps.signal?.aborted)throw new Error('Riset dihentikan');
    try{
      const tools=await deps.discover(item);
      search=tools.find(t=>/^(?:web_search_exa|web_search|search|webSearch)$/.test(t.name))||
        tools.find(t=>/search/i.test(t.name));
      if(search){connector=item;provider=item.name;break}
    }catch(error){errors.push(item.name+': '+String(error instanceof Error?error.message:error).slice(0,130))}
  }
  if(!connector||!search)throw new Error('Tidak ada MCP search yang dapat dihubungi. '+errors.join(' | '));
  const questions=mode==='deep'?[query,query+' sumber resmi dokumentasi',query+' analisis terbaru dan perspektif berbeda']:[query];
  const evidence:string[]=[];const urls=new Set<string>();let calls=0;
  for(let i=0;i<questions.length;i++){
    if(deps.signal?.aborted)throw new Error('Riset dihentikan');
    const args=searchArguments(search,questions[i]);
    deps.event?.('Riset '+(i+1)+'/'+questions.length+' via '+provider);
    const ok=await deps.approve(connector,search.name,args);
    if(deps.signal?.aborted)throw new Error('Riset dihentikan');
    if(!ok){evidence.push('Pencarian '+(i+1)+' ditolak.');continue}
    try{
      const result=(await deps.invoke(connector,search.name,args)).slice(0,18000);
      calls++;
      for(const url of evidenceUrls(result))if(urls.size<18)urls.add(url);
      evidence.push('Pencarian '+(i+1)+':\n'+result.slice(0,mode==='deep'?5500:10000));
    }catch(e){evidence.push('Pencarian '+(i+1)+' gagal: '+String(e instanceof Error?e.message:e))}
  }
  if(!calls)throw new Error('Tidak ada pencarian yang berhasil diselesaikan.');
  return {provider,calls,urls:[...urls],evidence:evidence.join('\n\n').slice(0,mode==='deep'?16000:10000)};
}
