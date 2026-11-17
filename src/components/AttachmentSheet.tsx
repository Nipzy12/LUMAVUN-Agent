import React from 'react';
import { Image, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { Project } from '../types';
import type { PendingAttachment } from '../attachments';
import type { BrainSettings } from '../featureState';
import { C, style } from '../ui';

type Props = {
  open: boolean; onClose(): void;
  attachments: PendingAttachment[]; onRemove(id: string): void;
  onCamera(): void; onPhoto(): void; onFile(): void;
  projects: Project[]; selectedProjectId?: string; onProject(id: string): void;
  webEnabled: boolean; onWeb(value: boolean): void;
  memoryEnabled: boolean; onMemory(value: boolean): void;
  brain: BrainSettings; onResearch(value: BrainSettings['research']): void;
  onConnectors(): void; onIntelligence(): void; onSkills(): void;
};

function Tile({ title, icon, onPress }: {
  title: string; icon: keyof typeof Feather.glyphMap; onPress(): void;
}) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={{
    flex: 1, backgroundColor: C.raised, borderRadius: 16, paddingVertical: 16,
    alignItems: 'center', gap: 8, minWidth: 83
  }}>
    <Feather name={icon} size={23} color={C.text}/>
    <Text style={{ color: C.text, fontSize: 14 }}>{title}</Text>
  </Pressable>;
}
function Line({ name, note, icon, onPress, selected }: {
  name: string; note?: string; icon: keyof typeof Feather.glyphMap; onPress(): void; selected?: boolean;
}) {
  return <Pressable onPress={onPress} accessibilityRole="button" style={[style.row,{
    padding: 13, minHeight: 58, borderBottomWidth: 1, borderBottomColor: C.border, gap: 13
  }]}>
    <Feather name={icon} color={selected ? C.accent : C.muted} size={21}/>
    <View style={{ flex: 1 }}>
      <Text style={{ color: C.text, fontSize: 15 }}>{name}</Text>
      {!!note && <Text style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>{note}</Text>}
    </View>
    <Feather name={selected ? 'check-circle' : 'chevron-right'} size={19}
      color={selected ? C.accent : C.muted}/>
  </Pressable>;
}

export function AttachmentSheet({
  open, onClose, attachments, onRemove, onCamera, onPhoto, onFile,
  projects, selectedProjectId, onProject, webEnabled, onWeb,
  memoryEnabled, onMemory, brain, onResearch, onConnectors, onIntelligence, onSkills
}: Props) {
  return <Modal visible={open} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
    <View style={{flex:1,justifyContent:'flex-end',backgroundColor:'#030410A6'}}>
      <Pressable style={{flex:1}} onPress={onClose}/>
      <View style={{
        backgroundColor:C.surface,borderTopLeftRadius:28,borderTopRightRadius:28,
        paddingHorizontal:17,paddingTop:14,paddingBottom:30,maxHeight:'82%'
      }}>
        <View style={{width:42,height:4,borderRadius:3,backgroundColor:C.subtle,alignSelf:'center',marginBottom:17}}/>
        <View style={[style.row,{justifyContent:'space-between',marginBottom:16}]}>
          <Text style={{fontSize:21,fontWeight:'700',color:C.text}}>Tambahkan ke chat</Text>
          <Pressable accessibilityLabel="Tutup menu lampiran" onPress={onClose}>
            <Feather name="x" size={24} color={C.text}/>
          </Pressable>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{gap:16,paddingBottom:15}}>
          <View style={[style.row,{gap:9}]}>
            <Tile title="Kamera" icon="camera" onPress={onCamera}/>
            <Tile title="Foto" icon="image" onPress={onPhoto}/>
            <Tile title="File" icon="file-plus" onPress={onFile}/>
          </View>
          {!!attachments.length && <View style={{gap:9}}>
            <Text style={{color:C.muted,fontSize:13}}>Lampiran siap dikirim</Text>
            {attachments.map(a=><View key={a.id} style={[style.row,{gap:9,backgroundColor:C.raised,padding:9,borderRadius:13}]}>
              {a.kind==='image'?<Image source={{uri:a.uri}} style={{width:42,height:42,borderRadius:8}}/>:
                <Feather name="file-text" color={C.accent} size={28}/>}
              <Text style={{color:C.text,flex:1}} numberOfLines={1}>{a.name}</Text>
              <Pressable onPress={()=>onRemove(a.id)} accessibilityLabel={'Hapus '+a.name}>
                <Feather name="x-circle" color={C.danger} size={19}/>
              </Pressable>
            </View>)}
          </View>}
          <View style={{borderWidth:1,borderColor:C.border,borderRadius:17,overflow:'hidden'}}>
            <Line name="Pencarian web" note={webEnabled?'Aktif melalui MCP search terhubung':'Aktifkan pencarian bila perlu'} icon="globe"
              selected={webEnabled} onPress={()=>onWeb(!webEnabled)}/>
            <Line name="Memori" note="Catatan yang kamu izinkan tersimpan lokal" icon="bookmark"
              selected={memoryEnabled} onPress={()=>onMemory(!memoryEnabled)}/>
            <Line name="Deep Research" note={brain.research==='deep'?'Riset bertahap aktif':brain.research==='web'?'Pencarian cepat aktif':'Tidak aktif'}
              icon="search" selected={brain.research==='deep'}
              onPress={()=>onResearch(brain.research==='deep'?'off':'deep')}/>
            <Line name="Prompt dan reasoning" note={'Mode: '+brain.reasoning} icon="cpu" onPress={onIntelligence}/>
            <Line name="Skill AI" note="Kelola instruksi tambahan dari GitHub" icon="book-open" onPress={onSkills}/>
            <Line name="Konektor MCP" note="Kelola server dan tool eksternal" icon="grid" onPress={onConnectors}/>
          </View>
          <View style={{borderWidth:1,borderColor:C.border,borderRadius:17,overflow:'hidden'}}>
            <Text style={{color:C.muted,fontSize:13,padding:13}}>Tambahkan ke proyek</Text>
            <Line name="Tanpa proyek" icon="message-square" selected={!selectedProjectId} onPress={()=>onProject('')}/>
            {projects.filter(p=>!p.archived).map(p=><Line key={p.id} name={p.name} icon="folder"
              selected={selectedProjectId===p.id} onPress={()=>onProject(p.id)}/>)}
            {!projects.length && <Text style={{color:C.muted,paddingHorizontal:13,paddingBottom:13,fontSize:12}}>Buat proyek melalui tab Proyek untuk mengelompokkan percakapan.</Text>}
          </View>
          <Text style={{color:C.muted,fontSize:12,lineHeight:19}}>
            Gambar dikirim ke provider model vision terpilih. File teks didukung; PDF dan file biner belum bisa diproses langsung.
            Riset web membutuhkan MCP search yang benar-benar tersambung.
          </Text>
        </ScrollView>
      </View>
    </View>
  </Modal>;
}

export function AttachmentChips({attachments, onRemove}:{
  attachments:PendingAttachment[];onRemove(id:string):void;
}) {
  if(!attachments.length)return null;
  return <ScrollView horizontal keyboardShouldPersistTaps="handled"
    style={{maxHeight:65}} contentContainerStyle={{gap:8,paddingHorizontal:8,paddingVertical:8}}>
    {attachments.map(a=><View key={a.id} style={[style.row,{
      backgroundColor:C.raised,paddingHorizontal:9,paddingVertical:7,borderRadius:12,gap:7
    }]}>
      {a.kind==='image'?<Image source={{uri:a.uri}} style={{height:33,width:33,borderRadius:7}}/>:
        <Feather name="file" color={C.accent} size={18}/>}
      <Text style={{color:C.text,fontSize:12,maxWidth:105}} numberOfLines={1}>{a.name}</Text>
      <Pressable accessibilityLabel={'Hapus '+a.name} onPress={()=>onRemove(a.id)}>
        <Feather name="x" size={15} color={C.muted}/>
      </Pressable>
    </View>)}
  </ScrollView>;
}
