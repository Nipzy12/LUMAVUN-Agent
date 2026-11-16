import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { Project } from '../types';
import { shortDate } from '../artifacts';
import { ActionIcon, C, PrimaryButton, Sheet, style } from '../ui';

type Props = {
  projects: Project[];
  selectedProjectId: string;
  onMenu(): void;
  onOpen(projectId: string): void;
  onCreate(name: string): void;
};

export function ProjectsScreen({ projects, selectedProjectId, onMenu, onOpen, onCreate }: Props) {
  const [search, setSearch] = useState('');
  const [sortByName, setSortByName] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const visible = useMemo(() => projects
    .filter(p => !!p.archived === showArchived && p.name.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a,b) => sortByName ? a.name.localeCompare(b.name)
      : (Number(b.pinned)-Number(a.pinned)) || (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt)), [projects,search,sortByName]);

  function create() {
    const cleaned = name.trim().replace(/\s+/g, ' ');
    if (!cleaned || cleaned.length > 45) {
      setError('Nama proyek harus berisi 1–45 karakter.'); return;
    }
    onCreate(cleaned);
    setName('');
    setError('');
    setCreating(false);
  }

  return <View style={{ flex: 1, backgroundColor: C.bg }}>
    <View style={[style.row,{height:60,paddingHorizontal:12}]}>
      <ActionIcon name="menu" onPress={onMenu}/>
      <Text style={{color:C.text, flex:1,textAlign:'center',fontSize:22,fontWeight:'700'}}>Proyek</Text>
      <ActionIcon name="sliders" onPress={() => setSortByName(s=>!s)} />
    </View>
    <View style={{paddingHorizontal:18,paddingTop:10}}>
      <View style={[style.row,{backgroundColor:C.surface,borderColor:C.border,borderWidth:1,borderRadius:17,paddingHorizontal:14,height:56,gap:12}]}>
        <Feather name="search" size={22} color={C.subtle}/>
        <TextInput value={search} onChangeText={setSearch} placeholder="Cari proyek"
          placeholderTextColor={C.subtle} style={{color:C.text,fontSize:16,flex:1}}/>
      </View>
      <View style={[style.row,{justifyContent:'space-between',paddingTop:7}]}>
        <Text style={{color:C.subtle,fontSize:11}}>
          {sortByName ? 'Berdasarkan nama' : 'Terakhir diedit'}
        </Text>
        <Pressable onPress={()=>setShowArchived(v=>!v)}
          style={[style.row,{padding:9,gap:6,borderRadius:12,backgroundColor:C.raised}]}>
          <Feather name="archive" size={13} color={C.accent}/>
          <Text style={{color:C.accent,fontSize:12}}>{showArchived?'Proyek aktif':'Lihat arsip'}</Text>
        </Pressable>
      </View>
    </View>
    <ScrollView style={{flex:1}} contentContainerStyle={{paddingTop:28,paddingHorizontal:22,paddingBottom:110}}>
      {visible.length === 0 && <View style={{alignItems:'center',marginTop:65,gap:13}}>
        <Feather name="folder" size={42} color={C.accent}/>
        <Text style={{fontSize:21,fontWeight:'700',color:C.text}}>
          {search ? 'Proyek tidak ditemukan' : showArchived ? 'Arsip kosong' : 'Belum ada proyek'}
        </Text>
        <Text style={{fontSize:14,color:C.muted,textAlign:'center',lineHeight:21}}>
          {search ? 'Coba kata pencarian lain.' : 'Buat proyek untuk mulai menulis kode bersama LUMAVUN.'}
        </Text>
      </View>}
      {visible.map(project=><Pressable key={project.id}
        accessibilityRole="button"
        onPress={()=>onOpen(project.id)}
        style={{paddingVertical:12,marginBottom:20}}>
        <Text style={{fontSize:22,color:selectedProjectId===project.id?C.accent:C.text,fontWeight:'500'}} numberOfLines={2}>{project.pinned?'✦ ':''}{project.name}</Text>
        <Text style={{fontSize:15,color:C.muted,marginTop:6}}>Diedit {shortDate(project.updatedAt || project.createdAt)}</Text>
      </Pressable>)}
    </ScrollView>
    <View style={{alignItems:'flex-end',paddingHorizontal:19,paddingBottom:15}}>
      <Pressable accessibilityRole="button" onPress={()=>setCreating(true)}
        style={[style.row,{backgroundColor:'#f4f1f4',borderRadius:35,paddingHorizontal:22,paddingVertical:14,gap:10}]}>
        <Feather name="plus" color="#16141d" size={23}/>
        <Text style={{color:'#16141d',fontSize:18,fontWeight:'700'}}>Proyek baru</Text>
      </Pressable>
    </View>
    <Sheet open={creating} title="Proyek baru" onClose={()=>setCreating(false)}>
      <Text style={style.subtitle}>Buat folder proyek privat di perangkat ini.</Text>
      <TextInput style={style.input} value={name} onChangeText={setName}
        autoFocus placeholder="Nama proyek" maxLength={45}
        placeholderTextColor={C.subtle} />
      {!!error && <Text style={{color:C.danger}}>{error}</Text>}
      <PrimaryButton title="Buat proyek" onPress={create}/>
    </Sheet>
  </View>;
}
