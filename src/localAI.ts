import { Directory, File, Paths } from 'expo-file-system';
import { initLlama, type LlamaContext } from 'llama.rn';
import Storage from 'expo-sqlite/kv-store';
import { FileMode } from 'expo-file-system';

export type GGUFModel={id:string;name:string;sizeBytes:number;url:string;family:string;description:string;
  category?:'standard'|'uncensored'|'custom';minRamGb?:number;supported?:boolean;custom?:boolean};
export const GGUF_CATALOG:GGUFModel[]=[
 {id:'qwen-05-q4',name:'Qwen2.5 0.5B Instruct Q4_K_M',sizeBytes:491000000,
  url:'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf',
  family:'Qwen 0.5B',description:'Cocok untuk ponsel RAM terbatas; bahasa dan reasoning sederhana'},
 {id:'qwen-15-q4',name:'Qwen2.5 1.5B Instruct Q4_K_M',sizeBytes:986000000,
  url:'https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf',
  family:'Qwen 1.5B',description:'Lebih berat, untuk chat offline tanpa server'},
 {id:'llama-1b-q4',name:'Llama 3.2 1B Instruct Q4_K_M',sizeBytes:808000000,
  url:'https://huggingface.co/lmstudio-community/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf',
  family:'Llama 1B',description:'Model GGUF lokal, perlu RAM dan ruang kosong cukup'},
 {id:'gemma2-2b-abliterated-q4',name:'Gemma 2 2B Abliterated Q4_K_M',sizeBytes:1710000000,
  url:'https://huggingface.co/bartowski/gemma-2-2b-it-abliterated-GGUF/resolve/main/gemma-2-2b-it-abliterated-Q4_K_M.gguf',
  family:'Gemma 2',description:'GGUF pihak ketiga; model dapat tetap menghasilkan jawaban tidak akurat.',
  category:'uncensored',minRamGb:4},
 {id:'phi35-mini-q4',name:'Phi-3.5 Mini 3.8B Q4_K_M',sizeBytes:2390000000,
  url:'https://huggingface.co/bartowski/Phi-3.5-mini-instruct-GGUF/resolve/main/Phi-3.5-mini-instruct-Q4_K_M.gguf',
  family:'Phi 3.5',description:'Model instruksi 3.8B dengan kebutuhan memori lebih tinggi.',
  category:'standard',minRamGb:6},
 {id:'dolphin29-llama3-8b-q4',name:'Dolphin 2.9 Llama 3 8B Q4_K_M',sizeBytes:4583000000,
  url:'https://huggingface.co/tensorblock/dolphin-2.9-llama3-8b-GGUF/resolve/main/dolphin-2.9-llama3-8b-Q4_K_M.gguf',
  family:'Llama 3 8B',description:'Model berat; pada HP RAM terbatas bisa gagal memuat.',
  category:'uncensored',minRamGb:8},
 {id:'gemma4-e4b-heretic',name:'Gemma 4 E4B Heretic (referensi)',sizeBytes:5000000000,
  url:'https://huggingface.co/igorls/gemma-4-E4B-it-heretic-GGUF',
  family:'Gemma 4',description:'GGUF tersedia tetapi arsitektur belum terverifikasi pada llama.rn 0.12.9. Instalasi diblokir sampai kompatibel.',
  category:'uncensored',minRamGb:8,supported:false}
];
const root=()=>new Directory(Paths.document,'lumavun','models');
const customKey='lumavun.custom.models.v1';
export async function loadCustomModels():Promise<void>{
  const raw=await Storage.getItem(customKey);
  if(!raw)return;
  let saved:GGUFModel[]=[];
  try{const parsed=JSON.parse(raw);if(Array.isArray(parsed))saved=parsed}catch{return}
  for(const m of saved){
    if(typeof m.id==='string' && /^custom-[a-z0-9-]{3,50}$/.test(m.id)&&
      typeof m.name==='string'&&Number.isFinite(m.sizeBytes)&&m.custom===true &&
      !GGUF_CATALOG.some(x=>x.id===m.id)){
      GGUF_CATALOG.push({...m,url:'',supported:true,custom:true,category:'custom'});
    }
  }
}
export async function importCustomGGUF(uri:string,name:string):Promise<GGUFModel>{
  if(!/\.gguf$/i.test(name))throw new Error('Pilih file berakhiran .gguf');
  const input=new File(uri);
  if(input.size<1000000||input.size>8000000000)throw new Error('Ukuran GGUF tidak valid atau terlalu besar (>8GB).');
  const h=input.open(FileMode.ReadOnly);
  let signature:Uint8Array;
  try{signature=h.readBytesSync(4)}finally{h.close()}
  if(String.fromCharCode(...signature)!=='GGUF')throw new Error('Berkas bukan GGUF yang valid.');
  const model:GGUFModel={
    id:'custom-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,6),
    name:name.replace(/\.gguf$/i,'').slice(0,80),sizeBytes:input.size,url:'',
    family:'Imported GGUF',description:'Model milik pengguna, kompatibilitas engine tidak dijamin.',
    category:'custom',custom:true,supported:true
  };
  root().create({idempotent:true,intermediates:true});
  const dest=localModelFile(model.id);
  await input.copy(dest);
  if(dest.size!==input.size){dest.delete();throw new Error('Import tidak lengkap.')}
  GGUF_CATALOG.push(model);
  await Storage.setItem(customKey,JSON.stringify(GGUF_CATALOG.filter(x=>x.custom)));
  return model;
}
export function localModelFile(id:string):File {
  if(!/^[a-z0-9-]{3,60}$/.test(id))throw new Error('Model ID tidak valid');
  return new File(root(),id+'.gguf');
}
export function installedModelIds():string[] {
  return GGUF_CATALOG.filter(m=>localModelFile(m.id).exists).map(m=>m.id);
}
export function bytesOnDisk(id:string):number {
  return localModelFile(id).size||0;
}
let pending:ReturnType<typeof File.createDownloadTask>|null=null;
export function cancelModelDownload(){pending?.cancel();}
export async function downloadModel(model:GGUFModel,onProgress:(ratio:number)=>void):Promise<void>{
  if(!GGUF_CATALOG.find(x=>x.id===model.id))throw new Error('Model tidak terdaftar');
  if(model.supported===false || !model.url.startsWith('https://huggingface.co/'))
    throw new Error('Model tidak didukung untuk unduhan langsung.');
  root().create({idempotent:true,intermediates:true});
  const file=localModelFile(model.id);
  if(file.exists)throw new Error('Model sudah diunduh');
  const task=File.createDownloadTask(model.url,file,{onProgress:p=>{
    if(p.totalBytes>0)onProgress(Math.min(1,p.bytesWritten/p.totalBytes));
  }});
  pending=task;
  try {
    const out=await task.downloadAsync();
    if(!out?.exists)throw new Error('Unduhan dibatalkan atau gagal');
    if((out.size||0)<model.sizeBytes*.75)throw new Error('File GGUF tidak lengkap');
  }catch(error){
    if(file.exists)file.delete();
    throw error;
  }finally{pending=null;}
}
let current:{id:string;context:LlamaContext}|null=null;
export async function unloadModel(){
  if(current){const old=current;current=null;await old.context.release();}
}
export async function removeModel(id:string){
  if(current?.id===id)await unloadModel();
  const file=localModelFile(id);if(file.exists)file.delete();
  const item=GGUF_CATALOG.find(x=>x.id===id);
  if(item?.custom){
    GGUF_CATALOG.splice(GGUF_CATALOG.indexOf(item),1);
    await Storage.setItem(customKey,JSON.stringify(GGUF_CATALOG.filter(x=>x.custom)));
  }
}
export async function completeLocal(modelId:string,messages:Array<{role:'system'|'user'|'assistant';content:string}>,signal?:AbortSignal):Promise<string>{
  const target=GGUF_CATALOG.find(m=>m.id===modelId);
  if(!target)throw new Error('Pilih model lokal');
  if(target.supported===false)throw new Error('Model belum didukung oleh llama.rn versi aplikasi.');
  const file=localModelFile(modelId);
  if(!file.exists)throw new Error('Model belum diunduh');
  if(current?.id!==modelId){
    await unloadModel();
    const context=await initLlama({model:file.uri,n_ctx:2048,n_batch:256,n_threads:4,n_gpu_layers:0});
    current={id:modelId,context};
  }
  if(signal?.aborted)throw new Error('Dibatalkan');
  const context=current.context;
  const stop=()=>{void context.stopCompletion()};
  signal?.addEventListener('abort',stop,{once:true});
  try {
    const out=await context.completion({
      messages:messages.slice(-10),n_predict:384,temperature:0.5,
      stop:['<|im_end|>','<|eot_id|>','</s>']
    });
    if(signal?.aborted)throw new Error('Dibatalkan');
    return out.text;
  }finally{signal?.removeEventListener('abort',stop);}
}
