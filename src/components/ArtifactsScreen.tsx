import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { UserArtifact } from '../types';
import { shortDate } from '../artifacts';
import { ActionIcon, C, style } from '../ui';

type Props = {
  artifacts: UserArtifact[];
  onMenu(): void;
  onOpen(id: string): void;
  onGoToCode(): void;
};

export function ArtifactsScreen({artifacts,onMenu,onOpen,onGoToCode}: Props) {
  const [search,setSearch]=useState('');
  const visible=useMemo(()=>artifacts
    .filter(item=>(item.title+' '+item.path).toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a,b)=>b.updatedAt-a.updatedAt),[artifacts,search]);
  return <View style={{flex:1,backgroundColor:C.bg}}>
    <View style={[style.row,{height:60,paddingHorizontal:12}]}>
      <ActionIcon name="menu" onPress={onMenu}/>
      <Text style={{color:C.text,flex:1,textAlign:'center',fontSize:22,fontWeight:'700'}}>Artefak</Text>
      <ActionIcon name="code" onPress={onGoToCode}/>
    </View>
    <View style={{paddingHorizontal:18,paddingTop:10}}>
      <View style={[style.row,{backgroundColor:C.surface,borderRadius:17,borderWidth:1,borderColor:C.border,
        height:56,paddingHorizontal:14,gap:12}]}>
        <Feather name="search" color={C.subtle} size={22}/>
        <TextInput placeholder="Cari artefak" placeholderTextColor={C.subtle}
          value={search} onChangeText={setSearch} style={{flex:1,color:C.text,fontSize:16}}/>
      </View>
      <Text style={{color:C.subtle,fontSize:11,marginTop:10}}>
        {visible.length} artefak tersimpan secara lokal
      </Text>
    </View>
    <ScrollView style={{flex:1}} contentContainerStyle={{paddingHorizontal:18,paddingTop:24,paddingBottom:35}}>
      {visible.length===0 && <View style={{paddingTop:64,alignItems:'center',gap:13}}>
        <Feather name="layers" color={C.accent} size={42}/>
        <Text style={{fontSize:21,color:C.text,fontWeight:'700'}}>
          {search?'Tidak ditemukan':'Belum ada artefak'}
        </Text>
        <Text style={{color:C.muted,fontSize:14,textAlign:'center',lineHeight:22}}>
          {search?'Cari dengan kata lain.':'Kode yang disimpan dari chat atau dibuat Code Agent akan muncul di sini. HTML bisa dipratinjau.'}
        </Text>
        <Pressable onPress={onGoToCode} style={{backgroundColor:C.raised,padding:14,borderRadius:20,marginTop:8}}>
          <Text style={{color:C.accent,fontWeight:'600'}}>Buka Code Agent</Text>
        </Pressable>
      </View>}
      {visible.map(item=><Pressable key={item.id} accessibilityRole="button"
        onPress={()=>onOpen(item.id)}
        style={[style.row,{padding:14,backgroundColor:'#0b0b11',borderRadius:19,borderColor:C.border,borderWidth:1,
          marginBottom:14,gap:14}]}>
        <View style={{height:101,width:105,borderRadius:13,padding:9,backgroundColor:'#182033',overflow:'hidden'}}>
          <View style={[style.row,{gap:4,marginBottom:8}]}>
            <View style={{width:6,height:6,borderRadius:3,backgroundColor:C.danger}}/>
            <View style={{width:6,height:6,borderRadius:3,backgroundColor:C.gold}}/>
            <View style={{width:6,height:6,borderRadius:3,backgroundColor:C.success}}/>
          </View>
          <Text numberOfLines={6} style={{fontFamily:'monospace',color:'#b6c6f9',fontSize:8.5,lineHeight:12}}>
            {item.content||'Kosong'}
          </Text>
        </View>
        <View style={{flex:1,gap:9}}>
          <Text numberOfLines={2} style={{color:C.text,fontSize:18,fontWeight:'600'}}>{item.title}</Text>
          <View style={[style.row,{gap:7}]}>
            <Feather name="lock" size={14} color={C.muted}/>
            <Text style={{color:C.muted,fontSize:13}}>Hanya di perangkat</Text>
          </View>
          <Text style={{color:C.subtle,fontSize:13}}>Diedit {shortDate(item.updatedAt)} · {item.format.toUpperCase()}</Text>
        </View>
        <Feather name="chevron-right" color={C.subtle} size={16}/>
      </Pressable>)}
    </ScrollView>
  </View>;
}
