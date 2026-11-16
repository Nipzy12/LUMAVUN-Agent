
import type { APIMessage, APITool, Completion, ToolCall } from './provider';
export type ConnectedChatResult={content:string;calls:number};
export type ConnectedChatDeps={
 tools:APITool[];
 complete(messages:APIMessage[],tools:APITool[]):Promise<Completion>;
 approve(toolName:string,args:Record<string,unknown>):Promise<boolean>;
 call(toolName:string,args:Record<string,unknown>):Promise<string>;
 signal?:AbortSignal;
};
/** Only registered web search tools can be used; all calls require foreground approval. */
export async function runConnectedChat(history:APIMessage[],deps:ConnectedChatDeps):Promise<ConnectedChatResult>{
 const messages:APIMessage[]=[...history];
 let calls=0;
 const allowed=new Set(deps.tools.map(t=>t.function.name));
 for(let i=0;i<4;i++){
   if(deps.signal?.aborted)throw new Error('Dihentikan');
   const completion=await deps.complete(messages,deps.tools);
   if(deps.signal?.aborted)throw new Error('Dihentikan');
   if(!completion.toolCalls.length)return {content:completion.content,calls};
   messages.push({role:'assistant',content:completion.content||null,tool_calls:completion.toolCalls});
   for(const tool of completion.toolCalls){
     if(calls++>=6)throw new Error('Batas penggunaan tool pencarian tercapai');
     let reply='';
     try{
       if(!allowed.has(tool.function.name))throw new Error('Tool tidak terdaftar');
       const args=JSON.parse(tool.function.arguments||'{}');
       if(typeof args!=='object'||!args||Array.isArray(args))throw new Error('Argumen tool salah');
       const ok=await deps.approve(tool.function.name,args);
       if(deps.signal?.aborted)throw new Error('Dihentikan');
       reply=ok?await deps.call(tool.function.name,args):'DENIED BY USER';
     }catch(e){reply='ERROR: '+String(e instanceof Error?e.message:e);}
     messages.push({role:'tool',tool_call_id:tool.id,content:reply.slice(0,60000)});
   }
 }
 return {content:'Batas pencarian tercapai. Tinjau sumber, lalu lanjutkan permintaan.',calls};
}
