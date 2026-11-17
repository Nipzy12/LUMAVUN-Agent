import { Directory, File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';

/** References belong to the user's private local profile, not to a cloud-image service. */
const referenceDir=()=>new Directory(Paths.document,'lumavun','references');
export async function addReferencePhoto(existing:string[]):Promise<string[]>{
  if(existing.length>=3)throw new Error('Maksimal tiga foto referensi.');
  const result=await ImagePicker.launchImageLibraryAsync({
    mediaTypes:['images'],allowsEditing:false,quality:0.82,
    allowsMultipleSelection:false
  });
  if(result.canceled)return existing;
  const asset=result.assets[0];
  const src=new File(asset.uri);
  if(!src.exists || src.size>6*1024*1024)throw new Error('Foto maksimal 6 MB.');
  referenceDir().create({idempotent:true,intermediates:true});
  const target=new File(referenceDir(),'ref_'+Date.now()+'_'+Math.random().toString(36).slice(2,7)+'.jpg');
  try{
    src.copy(target);
    if(!target.exists || !target.size)throw new Error('Gagal menyalin foto ke penyimpanan pribadi.');
    return [...existing,target.uri];
  }catch(err){if(target.exists)target.delete();throw err;}
}
export function removeReferencePhoto(existing:string[],uri:string):string[]{
  if(!existing.includes(uri))return existing;
  // Only delete files from the private reference directory.
  const dir=referenceDir().uri;
  if(uri.startsWith(dir)){
    try{const file=new File(uri);if(file.exists)file.delete();}catch{ /* keep remaining references */ }
  }
  return existing.filter(x=>x!==uri);
}
export function clearReferencePhotos(uris:string[]):void{
  for(const uri of uris)removeReferencePhoto(uris,uri);
}
