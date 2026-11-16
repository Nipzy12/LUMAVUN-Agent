import { Directory, File, Paths } from 'expo-file-system';
import { initLlama, type LlamaContext } from 'llama.rn';

export type GGUFModel={id:string;name:string;sizeBytes:number;url:string;family:string;description:string};
export const GGUF_CATALOG:GGUFModel[]=[
 {id:'qwen-05-q4',name:'Qwen2.5 0.5B Instruct Q4_K_M',sizeBytes:491000000,
  url:'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf',
  family:'Qwen 0.5B',description:'Cocok untuk ponsel RAM terbatas; bahasa dan reasoning sederhana'},
 {id:'qwen-15-q4',name:'Qwen2.5 1.5B Instruct Q4_K_M',sizeBytes:986000000,
  url:'https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf',
  family:'Qwen 1.5B',description:'Lebih berat, untuk chat offline tanpa server'},
 {id:'llama-1b-q4',name:'Llama 3.2 1B Instruct Q4_K_M',sizeBytes:808000000,
  url:'https://huggingface.co/lmstudio-community/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf',
  family:'Llama 1B',description:'Model GGUF lokal, perlu RAM dan ruang kosong cukup'}
];
const root=()=>new Directory(Paths.document,'lumavun','models');
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
}
export async function completeLocal(modelId:string,messages:Array<{role:'system'|'user'|'assistant';content:string}>,signal?:AbortSignal):Promise<string>{
  const target=GGUF_CATALOG.find(m=>m.id===modelId);
  if(!target)throw new Error('Pilih model lokal');
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
