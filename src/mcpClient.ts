import type { Connector } from './featureState';
import type { APITool } from './provider';

type RpcResponse={jsonrpc?:string;id?:number;result?:any;error?:{message:string}};
const PROTOCOL='2025-06-18';
export function mcpFunctionName(connectorId:string,toolName:string):string {
  const encoded=encodeURIComponent(toolName).replace(/%/g,'_');
  return ('mcp_'+connectorId.replace(/[^a-zA-Z0-9]/g,'_')+'_'+encoded).slice(0,64);
}
export type MCPTool = {name:string;description?:string;inputSchema?:{type?:string;properties?:Record<string,unknown>;required?:string[]} };
const sessions=new Map<string,string>();
let nextId=1;
async function rpc(connector:Connector,token:string,method:string,params?:unknown):Promise<unknown> {
  const headers:Record<string,string>={
    'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':PROTOCOL
  };
  if(token)headers.Authorization='Bearer '+token;
  if(sessions.has(connector.id)) headers['Mcp-Session-Id']=sessions.get(connector.id)!;
  const response=await fetch(connector.url,{
    method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:nextId++,method,...(params===undefined?{}:{params})})
  });
  if(!response.ok)throw new Error('MCP HTTP '+response.status);
  const session=response.headers.get('mcp-session-id');
  if(session)sessions.set(connector.id,session);
  const body=await response.text();
  if(body.length>750000)throw new Error('MCP response terlalu besar');
  let value:RpcResponse;
  if(response.headers.get('content-type')?.includes('text/event-stream')) {
    const lines=body.split(/\r?\n/).filter(l=>l.startsWith('data:'));
    const match=lines.map(l=>{try{return JSON.parse(l.slice(5).trim()) as RpcResponse}catch{return null}})
      .find(v=>v&&(v.result!==undefined||v.error));
    if(!match)throw new Error('MCP tidak mengirim JSON-RPC result yang dapat dibaca');
    value=match;
  }else value=JSON.parse(body) as RpcResponse;
  if(value.error)throw new Error(value.error.message.slice(0,250));
  return value.result;
}
async function start(connector:Connector,token:string){
  if(sessions.has(connector.id))return;
  await rpc(connector,token,'initialize',{protocolVersion:PROTOCOL,capabilities:{},clientInfo:{name:'LUMAVUN',version:'0.4.0'}});
  // Notifications are best-effort. Sessionless servers may not require them.
  try {await fetch(connector.url,{method:'POST',headers:{
    'Content-Type':'application/json','MCP-Protocol-Version':PROTOCOL,
    ...(token?{Authorization:'Bearer '+token}:{}),
    ...(sessions.has(connector.id)?{'Mcp-Session-Id':sessions.get(connector.id)!}:{})
  },body:JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})});}catch{}
}
export async function listMcpTools(connector:Connector,token:string):Promise<MCPTool[]>{
  await start(connector,token);
  const result=await rpc(connector,token,'tools/list',{});
  if(!Array.isArray((result as any)?.tools))throw new Error('MCP tools/list tidak tersedia');
  return (result as any).tools.filter((t:any)=>typeof t.name==='string').slice(0,80);
}
export async function callMcpTool(connector:Connector,token:string,name:string,args:Record<string,unknown>):Promise<string>{
  await start(connector,token);
  const result=await rpc(connector,token,'tools/call',{name,arguments:args});
  return JSON.stringify(result).slice(0,60000);
}
export function asAgentTool(connector:Connector,tool:MCPTool):APITool{
  return {type:'function',function:{name:mcpFunctionName(connector.id,tool.name),
    description:('[MCP external '+connector.name+'] '+(tool.description||tool.name)).slice(0,450),
    parameters:{type:'object',properties:tool.inputSchema?.properties||{},required:tool.inputSchema?.required||[]}}};
}
