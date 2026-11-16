
import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { Project, Conversation } from '../types';
import { ActionIcon, C, PrimaryButton, Sheet, style } from '../ui';

type Props={
 project:Project;
 chats:Conversation[];
 onBack():void;
 onSave(next:Project):void;
 onDelete():void;
 onOpenFiles():void;
 onNewChat():void;
 onOpenChat(id:string):void;
};
export function ProjectDetailScreen({project,chats,onBack,onSave,onDelete,onOpenFiles,onNewChat,onOpenChat}:Props){
 const [menu,setMenu]=useState(false);
 const [edit,setEdit]=useState(false);
 const [name,setName]=useState(project.name);
 const [description,setDescription]=useState(project.description||'');
 const [instructions,setInstructions]=useState(project.customInstructions||'');
 const [instructionsOpen,setInstructionsOpen]=useState(false);
 const [memoryOpen,setMemoryOpen]=useState(false);
 const [memory,setMemory]=useState(project.memory||'');
 const [archivedShown,setArchivedShown]=useState(false);
 const linked=chats.filter(c=>c.projectId===project.id).sort((a,b)=>b.updatedAt-a.updatedAt);
 const update=(values:Partial<Project>)=>onSave({...project,...values,updatedAt:Date.now()});
 const act=(label:string,fn:()=>void)=><Pressable key={label} onPress={()=>{setMenu(false);fn()}}
   style={{paddingVertical:15,paddingHorizontal:20,borderBottomWidth:1,borderColor:C.border}}>
   <Text style={{fontSize:16,color:C.text}}>{label}</Text>
 </Pressable>;
 return <View style={{flex:1,backgroundColor:C.bg}}>
   <View style={[style.row,{height:58,paddingHorizontal:13}]}>
     <ActionIcon name="arrow-left" onPress={onBack}/>
     <View style={{flex:1}}/>
     <ActionIcon name="more-vertical" onPress={()=>setMenu(x=>!x)}/>
   </View>
   {menu && <View style={{position:'absolute',zIndex:10,right:17,top:54,width:225,borderRadius:16,
     backgroundColor:C.raised,borderColor:C.border,borderWidth:1,overflow:'hidden'}}>
      {act(project.pinned?'Lepas sematan':'Sematkan',()=>update({pinned:!project.pinned}))}
      {act('Edit detail',()=>{setName(project.name);setDescription(project.description||'');setEdit(true)})}
      {act(project.archived?'Keluarkan dari arsip':'Arsipkan',()=>{update({archived:!project.archived});onBack()})}
      {act('Hapus',()=>Alert.alert('Hapus proyek?', 'Folder kode lokal dan seluruh file proyek akan ikut dihapus. Ini tidak dapat dibatalkan.',[
        {text:'Batal',style:'cancel'},
        {text:'Hapus proyek',style:'destructive',onPress:onDelete}
      ]))}
   </View>}
   <ScrollView contentContainerStyle={{paddingHorizontal:23,paddingTop:24,paddingBottom:120}}>
     <Text style={{fontSize:32,fontFamily:'serif',fontWeight:'700',color:C.text}}>{project.name}</Text>
     <Text style={{color:C.muted,fontSize:16,lineHeight:24,marginTop:12}}>
       {project.description||'Belum ada deskripsi proyek.'}
     </Text>
     <View style={[style.row,{alignSelf:'flex-start',marginTop:16,padding:9,borderRadius:12,backgroundColor:C.raised,gap:7}]}>
       <Feather name="lock" size={16} color={C.muted}/><Text style={{color:C.muted}}>Pribadi</Text>
     </View>
     <View style={[style.row,{gap:13,marginTop:22}]}>
       <Pressable onPress={onOpenFiles} style={{flex:1,backgroundColor:'#0b0b10',borderRadius:16,padding:15,minHeight:125,justifyContent:'space-between'}}>
         <Text style={{color:C.text,fontWeight:'700',fontSize:16}}>Konteks</Text>
         <Text style={{color:C.accent,fontWeight:'600',fontSize:14}}>Tambahkan file</Text>
       </Pressable>
       <Pressable onPress={()=>{setInstructions(project.customInstructions||'');setInstructionsOpen(true)}}
         style={{flex:1,backgroundColor:'#0b0b10',borderRadius:16,padding:15,minHeight:125,justifyContent:'space-between'}}>
         <Text style={{color:C.text,fontWeight:'700',fontSize:16}}>Instruksi khusus</Text>
         <Text style={{color:C.accent,fontWeight:'600',fontSize:14}}>
           {project.customInstructions?'Edit instruksi':'Tambahkan instruksi'}
         </Text>
       </Pressable>
     </View>
     <Pressable onPress={()=>{setMemory(project.memory||'');setMemoryOpen(true)}}
       style={[style.row,{backgroundColor:'#0b0b10',padding:17,borderRadius:15,marginTop:15}]}>
       <Text style={{color:C.text,flex:1,fontSize:16,fontWeight:'700'}}>Memori proyek</Text>
       <Feather name="chevron-right" color={C.muted} size={20}/>
     </Pressable>
     <Text style={{color:C.muted,fontSize:13,marginTop:26,marginBottom:11}}>PERCAKAPAN PROYEK</Text>
     {linked.length===0 && <Text style={{color:C.subtle}}>Belum ada percakapan pada proyek ini.</Text>}
     {linked.map(c=><Pressable key={c.id} onPress={()=>onOpenChat(c.id)}
       style={[style.row,{paddingVertical:13,gap:12}]}>
       <Feather name="message-circle" color={C.muted} size={18}/>
       <View style={{flex:1}}>
         <Text numberOfLines={1} style={{fontSize:16,color:C.text}}>{c.title}</Text>
         <Text style={{color:C.subtle,fontSize:12,marginTop:5}}>
           {new Date(c.updatedAt).toLocaleDateString('id-ID')}
         </Text>
       </View>
     </Pressable>)}
   </ScrollView>
   <View style={{alignItems:'flex-end',paddingHorizontal:18,paddingBottom:15}}>
     <Pressable onPress={onNewChat}
       style={[style.row,{paddingVertical:14,paddingHorizontal:21,backgroundColor:'#f6f2f2',borderRadius:30,gap:9}]}>
       <Feather name="plus" color="#151515" size={21}/>
       <Text style={{color:'#151515',fontSize:17,fontWeight:'700'}}>Chat baru</Text>
     </Pressable>
   </View>
   <Sheet title="Edit detail proyek" open={edit} onClose={()=>setEdit(false)}>
     <Text style={style.label}>JUDUL</Text>
     <TextInput style={style.input} value={name} onChangeText={setName} maxLength={45}/>
     <Text style={style.label}>DESKRIPSI</Text>
     <TextInput style={[style.input,{minHeight:105,textAlignVertical:'top'}]} value={description} onChangeText={setDescription}
       multiline maxLength={600}/>
     <PrimaryButton title="Simpan detail" onPress={()=>{if(!name.trim())return;update({name:name.trim(),description:description.trim()});setEdit(false)}}/>
   </Sheet>
   <Sheet title="Instruksi proyek" open={instructionsOpen} onClose={()=>setInstructionsOpen(false)}>
     <Text style={style.subtitle}>Instruksi dikirim sebagai konteks ke model saat chat proyek berlangsung.</Text>
     <TextInput style={[style.input,{minHeight:200,textAlignVertical:'top'}]} multiline value={instructions}
       onChangeText={setInstructions} maxLength={7000}/>
     <PrimaryButton title="Simpan instruksi" onPress={()=>{update({customInstructions:instructions});setInstructionsOpen(false)}}/>
   </Sheet>
   <Sheet title="Memori proyek" open={memoryOpen} onClose={()=>setMemoryOpen(false)}>
     <Text style={style.subtitle}>Catatan lokal yang kamu tulis; tidak mengakses file pribadi lain.</Text>
     <TextInput style={[style.input,{minHeight:185,textAlignVertical:'top'}]} multiline value={memory}
       onChangeText={setMemory} maxLength={5000}/>
     <PrimaryButton title="Simpan memori proyek" onPress={()=>{update({memory});setMemoryOpen(false)}}/>
   </Sheet>
 </View>;
}
