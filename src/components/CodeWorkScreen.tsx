import React, { useEffect, useRef } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { Entry, Project } from '../types';
import { ActionIcon, C, Logo, style } from '../ui';
import { AttachmentChips } from './AttachmentSheet';
import type { PendingAttachment } from '../attachments';

type Props = {
  mode: 'chat' | 'work';
  onModeChange(mode: 'chat' | 'work'): void;
  entries: Entry[];
  project?: Project;
  busy: boolean;
  draft: string;
  onDraft(value: string): void;
  onSend(): void;
  onStop(): void;
  onMenu(): void;
  onWorkspace(): void;
  onAttachments(): void;
  attachments: PendingAttachment[];
  onRemoveAttachment(id: string): void;
  onBackToChat(): void;
};

export function CodeWorkScreen({
  mode, onModeChange, entries, project, busy, draft, onDraft,
  onSend, onStop, onMenu, onWorkspace, onBackToChat, onAttachments, attachments, onRemoveAttachment
}: Props) {
  const toolsUsed = entries.filter(e => e.role === 'tool').length;
  const scroll = useRef<ScrollView>(null);
  useEffect(()=>{
    const timer=setTimeout(()=>scroll.current?.scrollToEnd({animated:true}),100);
    return ()=>clearTimeout(timer);
  },[entries.length,busy]);
  return <View style={{flex:1,backgroundColor:C.bg}}>
    <View style={[style.row,{height:65,paddingHorizontal:10}]}>
      <ActionIcon name="menu" onPress={onMenu}/>
      <View style={{flex:1,alignItems:'center'}}>
        <View style={[style.row,{backgroundColor:C.surface,borderRadius:23,padding:4}]}>
          {(['chat','work'] as const).map(item=><Pressable key={item}
            accessibilityRole="tab" accessibilityState={{selected:mode===item}}
            onPress={()=>onModeChange(item)}
            style={{backgroundColor:mode===item?C.raised:'transparent',borderRadius:20,paddingHorizontal:25,paddingVertical:10}}>
            <Text style={{fontSize:16,fontWeight:mode===item?'700':'400',color:C.text}}>
              {item === 'chat' ? 'Chat' : 'Work'}
            </Text>
          </Pressable>)}
        </View>
      </View>
      <ActionIcon name="folder" onPress={onWorkspace}/>
    </View>
    <Pressable onPress={onWorkspace} style={[style.row,{
      backgroundColor:C.surface,padding:13,borderRadius:15,marginHorizontal:17,marginTop:9,marginBottom:5,gap:12
    }]}>
      <Feather name="folder" size={19} color={C.accent}/>
      <View style={{flex:1}}>
        <Text style={{color:C.text,fontWeight:'600'}} numberOfLines={1}>
          {project?.name || 'Pilih proyek untuk Code Agent'}
        </Text>
        <Text style={{color:C.muted,fontSize:11,marginTop:3}}>
          {mode==='work' ? 'Work • agen dapat meminta membaca atau mengubah file' : 'Chat • diskusi tanpa menjalankan tool'}
        </Text>
      </View>
      <Feather name="chevron-right" size={18} color={C.muted}/>
    </Pressable>
    <ScrollView ref={scroll} style={{flex:1}} keyboardShouldPersistTaps="handled"
      onContentSizeChange={()=>{if(entries.length)scroll.current?.scrollToEnd({animated:false})}}
      contentContainerStyle={{paddingHorizontal:18,paddingTop:20,paddingBottom:26,flexGrow:1}}>
      {entries.length === 0 ? <View style={{flex:1,justifyContent:'center',alignItems:'center',gap:14}}>
        <Logo size={72}/>
        <Text style={{color:C.text,fontSize:25,fontWeight:'700',textAlign:'center'}}>
          {mode==='work' ? 'Work dengan LUMAVUN' : 'Diskusikan kode bersama LUMAVUN'}
        </Text>
        <Text style={{color:C.muted,fontSize:13,lineHeight:22,textAlign:'center',maxWidth:310}}>
          {mode==='work'
            ? 'Minta agent membaca, membuat, dan mengedit file proyek. Perubahan membutuhkan persetujuanmu.'
            : 'Rancang dan tanyakan apa saja. Pindah ke Work untuk menggunakan tool proyek.'}
        </Text>
        <View style={{gap:9,marginTop:17,width:'100%'}}>
          {(mode==='work'
            ? ['Buat landing page HTML interaktif','Audit struktur folder proyek','Perbaiki komponen React','Buat komponen animasi CSS']
            : ['Jelaskan arsitektur React Native','Rancang fitur aplikasi','Bantu debugging TypeScript']
          ).map(text=><Pressable key={text} onPress={()=>onDraft(text)}
              style={{borderColor:C.border,borderWidth:1,backgroundColor:C.surface,borderRadius:13,padding:15}}>
            <Text style={{color:C.text,fontSize:13}}>{text}</Text>
          </Pressable>)}
        </View>
      </View> : <View style={{gap:18}}>
        {entries.map(entry=>{
          if(entry.role==='tool') {
            const failure=entry.text.includes('ERROR:')||entry.text.includes('DENIED');
            const action=entry.text.split(':')[0];
            return <View key={entry.id} style={{
              backgroundColor:C.surface,borderColor:C.border,borderWidth:1,
              borderRadius:14,paddingHorizontal:13,paddingVertical:12
            }}>
              <View style={[style.row,{gap:9,marginBottom:7}]}>
                <Feather name={failure?'alert-circle':'check-circle'} size={16}
                  color={failure?C.danger:C.success}/>
                <Text style={{color:C.text,fontWeight:'700',fontSize:13}}>{action}</Text>
              </View>
              <Text selectable style={{color:C.muted,fontSize:12,lineHeight:19}}>{entry.text.slice(action.length+1).trim()}</Text>
            </View>;
          }
          return <View key={entry.id} style={{
            alignSelf:entry.role==='user'?'flex-end':'stretch',
            maxWidth:entry.role==='user'?'90%':'100%',
            backgroundColor:entry.role==='user'?C.raised:'transparent',
            borderRadius:18,padding:entry.role==='user'?13:3
          }}>
            {entry.role==='assistant' && <Text style={{color:C.accent,fontSize:11,marginBottom:7,fontWeight:'700'}}>LUMAVUN AGENT</Text>}
            <Text selectable style={{color:C.text,fontSize:15,lineHeight:24}}>{entry.text}</Text>
          </View>;
        })}
        {toolsUsed>0 && !busy && <Text style={{color:C.muted,fontSize:12,textAlign:'center'}}>
          {toolsUsed} aktivitas tool dicatat dalam percakapan ini
        </Text>}
      </View>}
      {busy && <View style={[style.row,{gap:9,paddingVertical:16}]}>
        <Feather name="loader" size={16} color={C.accent}/>
        <Text style={{color:C.accent,fontSize:13}}>Agent sedang bekerja…</Text>
      </View>}
    </ScrollView>
    <View style={{paddingHorizontal:13,paddingBottom:8,paddingTop:8}}>
      <AttachmentChips attachments={attachments} onRemove={onRemoveAttachment}/>
      <View style={[style.row,{
        backgroundColor:C.surface,borderColor:C.border,borderWidth:1,borderRadius:24,
        paddingHorizontal:10,paddingVertical:7,gap:8
      }]}>
        <ActionIcon name="plus" onPress={onAttachments}/>
        <TextInput style={{color:C.text,flex:1,minHeight:42,maxHeight:120,fontSize:15}}
          multiline value={draft} onChangeText={onDraft} editable={!busy}
          placeholder={mode==='work'?'Work dengan LUMAVUN…':'Chat dengan LUMAVUN…'}
          placeholderTextColor={C.subtle}/>
        <Pressable accessibilityRole="button" accessibilityLabel={busy?'Hentikan agent':'Kirim instruksi'}
          onPress={busy?onStop:onSend} disabled={!busy&&!draft.trim()&&!attachments.length}
          style={{height:42,width:42,borderRadius:21,alignItems:'center',justifyContent:'center',
            backgroundColor:busy?C.raised:C.accent,opacity:busy||draft.trim()||attachments.length?1:.4}}>
          <Feather name={busy?'square':'arrow-up'} color={busy?C.text:C.bg} size={18}/>
        </Pressable>
      </View>
      <Pressable onPress={onBackToChat} style={{alignItems:'center',paddingTop:3,paddingBottom:2}}>
        <Text style={{color:C.muted,fontSize:12}}>Kembali ke chat umum</Text>
      </Pressable>
    </View>
  </View>;
}
