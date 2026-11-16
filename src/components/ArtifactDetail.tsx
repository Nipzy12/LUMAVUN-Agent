import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { WebView } from 'react-native-webview';
import type { UserArtifact } from '../types';
import { isolatedPreviewHtml, shortDate } from '../artifacts';
import { ActionIcon, C, style } from '../ui';

type Props = {
  artifact: UserArtifact;
  onClose(): void;
  onDelete(id: string): void;
  onSource(projectId: string): void;
};

export function ArtifactDetail({artifact,onClose,onDelete,onSource}:Props){
  const [tab,setTab]=useState<'preview'|'code'>(artifact.format==='html'?'preview':'code');
  function confirmDelete() {
    Alert.alert('Hapus artefak?', 'Snapshot ini akan dihapus dari galeri. File asli di proyek tetap ada.', [
      {text:'Batal',style:'cancel'},
      {text:'Hapus',style:'destructive',onPress:()=>onDelete(artifact.id)}
    ]);
  }
  return <View style={{flex:1,backgroundColor:C.bg}}>
    <View style={[style.row,{height:61,paddingHorizontal:10,gap:3}]}>
      <ActionIcon name="arrow-left" onPress={onClose}/>
      <Text numberOfLines={1} style={{flex:1,fontSize:18,color:C.text,fontWeight:'700'}}>{artifact.title}</Text>
      <ActionIcon name="copy" onPress={()=>{void Clipboard.setStringAsync(artifact.content);Alert.alert('Tersalin','Kode disalin ke clipboard.');}} />
      <ActionIcon name="trash-2" color={C.danger} onPress={confirmDelete}/>
    </View>
    <View style={{paddingHorizontal:19,paddingVertical:12,gap:7}}>
      <Text style={{color:C.muted,fontSize:12}}>Diedit {shortDate(artifact.updatedAt)} · {artifact.format.toUpperCase()} · Hanya di perangkat</Text>
      {artifact.projectId && <Pressable style={[style.row,{gap:7}]}
        onPress={()=>onSource(artifact.projectId!)}>
        <Feather name="folder" color={C.accent} size={15}/>
        <Text style={{color:C.accent,fontSize:13}} numberOfLines={1}>Buka proyek sumber: {artifact.path}</Text>
      </Pressable>}
      <View style={[style.row,{backgroundColor:C.surface,padding:4,borderRadius:17,alignSelf:'flex-start'}]}>
        {(['preview','code'] as const).map(t=><Pressable key={t} accessibilityRole="tab"
          accessibilityState={{selected:tab===t}}
          onPress={()=>setTab(t)}
          style={{paddingVertical:10,paddingHorizontal:20,borderRadius:13,backgroundColor:tab===t?C.raised:'transparent'}}>
          <Text style={{color:C.text,fontWeight:tab===t?'700':'400'}}>{t==='preview'?'Preview':'Kode'}</Text>
        </Pressable>)}
      </View>
    </View>
    {tab==='preview'&&artifact.format==='html'?<View style={{flex:1,marginHorizontal:12,marginBottom:13,
      backgroundColor:'white',borderRadius:14,overflow:'hidden'}}>
      <WebView
        originWhitelist={['about:blank','data:*']}
        source={{html:isolatedPreviewHtml(artifact.content)}}
        javaScriptEnabled
        domStorageEnabled={false}
        setSupportMultipleWindows={false}
        javaScriptCanOpenWindowsAutomatically={false}
        allowFileAccess={false}
        allowUniversalAccessFromFileURLs={false}
        onShouldStartLoadWithRequest={request=>request.url==='about:blank'||request.url.startsWith('data:')}
        style={{flex:1,backgroundColor:'#fff'}}
      />
    </View>:tab==='preview'?<View style={{flex:1,justifyContent:'center',alignItems:'center',padding:24,gap:14}}>
      <Feather name="code" color={C.accent} size={46}/>
      <Text style={{color:C.text,textAlign:'center',fontWeight:'700',fontSize:18}}>Preview visual untuk HTML</Text>
      <Text style={{color:C.muted,lineHeight:22,textAlign:'center'}}>
        File {artifact.format.toUpperCase()} bisa dibuka pada tab Kode. JSX, TS, CSS, dan Python tidak dieksekusi di HP.
      </Text>
      <Pressable onPress={()=>setTab('code')} style={{padding:14,borderRadius:14,backgroundColor:C.raised}}>
        <Text style={{color:C.accent}}>Lihat kode</Text>
      </Pressable>
    </View>:<ScrollView style={{flex:1,margin:12,backgroundColor:'#080c1a',borderRadius:14}}
        contentContainerStyle={{padding:17}}>
      <Text selectable style={{color:'#d9dffa',fontSize:13,lineHeight:21,fontFamily:'monospace'}}>
        {artifact.content||'(kosong)'}
      </Text>
    </ScrollView>}
    <Text style={{color:C.subtle,fontSize:10,textAlign:'center',paddingBottom:7}}>
      Preview HTML dibatasi tanpa akses jaringan, file perangkat, atau bridge native.
    </Text>
  </View>;
}
