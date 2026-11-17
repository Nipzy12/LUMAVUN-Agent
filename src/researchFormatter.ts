/** Convert untrusted MCP content into short, attributable search evidence. Never print raw tool JSON. */
export type WebSource={title:string;url:string;snippet:string};
const urls=/https?:\/\/[^\s<>"'\\)\]]+/g;
const trimUrl=(value:string)=>value.replace(/[.,;!?)\]}]+$/g,'');
function safeUrl(value:string):string|null {
  try {const u=new URL(trimUrl(value.trim()));return u.protocol==='https:'||u.protocol==='http:'?u.toString():null}
  catch{return null}
}
const plain=(input:string)=>input
  .replace(/\\r\\n|\\n/g,'\n').replace(/<[^>]{0,150}>/g,' ')
  .replace(/\[([^\]]+)\]\(https?:\/\/[^\s)]+\)/g,'$1')
  .replace(/[#*\u200b\u00a0]+/g,' ').replace(/\s+/g,' ').trim();
function contentTexts(value:unknown,depth=0):string[]{
  if(depth>5||value==null)return [];
  if(typeof value==='string'){
    if(value.trim().startsWith('{')||value.trim().startsWith('[')){
      try{return contentTexts(JSON.parse(value),depth+1)}catch{}
    }
    return [value];
  }
  if(Array.isArray(value))return value.flatMap(x=>contentTexts(x,depth+1)).slice(0,30);
  if(typeof value==='object'){
    const x=value as Record<string,unknown>;
    if(typeof x.text==='string')return [x.text];
    for(const k of ['content','results','items','data','result']){
      if(x[k]!==undefined){const v=contentTexts(x[k],depth+1);if(v.length)return v}
    }
    if(typeof x.url==='string')return ['Title: '+String(x.title||'')+'\nURL: '+x.url+
      '\nHighlights: '+String(x.snippet||x.description||'')];
  }
  return [];
}
function sourceFrom(part:string):WebSource|null{
  const title=part.match(/\bTitle:\s*([^\n\r]{1,260})/i)?.[1]||'';
  const explicit=part.match(/\b(?:URL|Link):\s*(https?:\/\/[^\s"'<>]+)/i)?.[1];
  const detected=part.match(urls)||[];
  const rawUrl=explicit||detected[0];
  if(!rawUrl)return null;
  const url=safeUrl(rawUrl);
  if(!url)return null;
  const cut=part.replace(/\b(?:Title|URL|Link|Published|Author|Highlights|Text|Content):/gi,' ')
    .replace(urls,' ').slice(0,3500);
  const humanTitle=plain(title).slice(0,130)||(()=>{try{return new URL(url).hostname}catch{return 'Sumber web'}})();
  return {title:humanTitle,url,snippet:plain(cut).slice(0,320)};
}
function splitBlocks(text:string):string[]{
  const normalized=text.replace(/\\n/g,'\n');
  const blocks=normalized.split(/(?=\bTitle:\s*)/i).filter(x=>x.trim().length);
  return blocks.length>1?blocks:[normalized];
}
const keywords=(query:string)=>query.toLowerCase().split(/[^\p{L}\p{N}]+/u)
  .filter(x=>x.length>=4&&!['yang','dengan','untuk','dari','pada','atau','tolong','buatkan','jelaskan','tentang','please','what','which'].includes(x));
export function extractWebSources(payload:string,query=''):WebSource[]{
  const pieces=contentTexts(payload);
  const found=new Map<string,WebSource>();
  for(const text of pieces.slice(0,30)) {
    for(const chunk of splitBlocks(text)){
      const source=sourceFrom(chunk);
      if(source&&!found.has(source.url))found.set(source.url,source);
    }
  }
  const terms=keywords(query);
  return [...found.values()].map((source,index)=>{
    const hay=(source.title+' '+source.snippet).toLowerCase();
    return {source,index,score:terms.reduce((n,t)=>n+(hay.includes(t)?1:0),0)};
  }).sort((a,b)=>b.score-a.score||a.index-b.index).slice(0,8).map(x=>x.source);
}
export function summarizeWebSources(sources:WebSource[],limit=4):string {
  if(!sources.length)return 'Tidak ditemukan sumber web dengan URL valid. Jangan mengarang hasil riset.';
  return sources.slice(0,limit).map((s,i)=>
    '['+(i+1)+'] '+s.title+'\nURL: '+s.url+'\nRingkasan: '+(s.snippet||'(Tidak ada cuplikan yang tersedia)')
  ).join('\n\n');
}
export function researchSourcesFooter(sources:WebSource[],limit=5):string {
  if(!sources.length)return '\n\nTidak ada URL sumber terverifikasi dari hasil pencarian.';
  return '\n\nSumber hasil pencarian:\n'+sources.slice(0,limit)
    .map((s,i)=>(i+1)+'. '+s.title+' — '+s.url).join('\n');
}
export function isResearchTestPrompt(query:string):boolean {
  return /^(tes|test|testing|cek|ping|coba|tes riset|tes research|test web|cek web|tes search)[.!? ]*$/i.test(query.trim());
}

/** Tiny local models sometimes echo MCP JSON verbatim. Prefer a grounded extractive answer. */
export function polishLocalResearchAnswer(answer:string,sources:WebSource[],query:string):string{
  const text=answer.trim();
  const raw=/^(?:\\?\{\s*["']content|data web dari|pencarian\s+1\/\d+|hasil riset langsung dari)/i.test(text)||
    /"type"\s*:\s*"text"|"content"\s*:\s*\[|\\n\\n\\n/.test(text)||
    text.length>3200;
  if(text && !raw)return text;
  if(!sources.length)return 'Tidak ditemukan sumber yang dapat mendukung jawaban untuk: '+query.slice(0,180);
  return 'Hasil pencarian untuk “'+query.slice(0,150)+'”:\n\n'+
    sources.slice(0,4).map((source,i)=>(i+1)+'. '+source.title+
      '\n'+(source.snippet||'Sumber tersedia, tetapi tidak ada cuplikan yang dapat diringkas.').slice(0,210)).join('\n\n')+
    '\n\nRingkasan ini berasal dari cuplikan hasil pencarian, bukan pembacaan penuh setiap situs.';
}
