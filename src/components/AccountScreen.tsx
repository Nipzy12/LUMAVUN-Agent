import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { UserPreferences } from '../store';
import type { ExtraState } from '../featureState';
import type { HubPage } from './HubScreen';
import { PersonalSettingsScreen, type PersonalPage } from './PersonalSettingsScreen';

export type AccountPage='settings'|PersonalPage;
type Props={
  screen:AccountPage;
  profile:UserPreferences;
  extra:ExtraState;
  chatsCount:number;
  projectsCount:number;
  memoryCount:number;
  hasProviderKey:boolean;
  onBack():void;
  onNavigate(page:AccountPage):void;
  onUpdate(profile:UserPreferences):void;
  onUpdateExtra(extra:ExtraState):void;
  onProvider():void;
  onModels():void;
  onWorkspace():void;
  onClearChats():void;
  onDisconnectProvider():void;
  onDeleteAccount():void;
  onHub(page:HubPage):void;
};
const CL={bg:'#FBFAFC',card:'#FFFFFF',text:'#1D1C22',muted:'#858590',
  line:'#E6E5EA',purple:'#6955DA',tint:'#EFEAFF',danger:'#CB4453'};
type Glyph=keyof typeof Feather.glyphMap;
function Group({children}:{children:React.ReactNode}){
  return <View style={{borderColor:CL.line,borderWidth:1,borderRadius:24,
    backgroundColor:CL.card,overflow:'hidden',marginBottom:18}}>{children}</View>;
}
function Row({icon,title,detail,subtitle,onPress,checked,onToggle,last=false}:{
  icon:Glyph;title:string;detail?:string;subtitle?:string;
  onPress?:()=>void;checked?:boolean;onToggle?:(next:boolean)=>void;last?:boolean
}){
  return <Pressable accessibilityRole={onToggle?'switch':'button'}
    onPress={onPress}
    accessibilityState={{checked,disabled:!onPress&&!onToggle}}
    style={{minHeight:subtitle?76:63,paddingHorizontal:17,paddingVertical:13,
      flexDirection:'row',alignItems:'center',gap:12,
      borderBottomWidth:last?0:1,borderColor:CL.line}}>
    <Feather name={icon} color={CL.purple} size={21}/>
    <View style={{flex:1,gap:4}}>
      <Text style={{color:CL.text,fontSize:16}}>{title}</Text>
      {subtitle?<Text style={{color:CL.muted,fontSize:12,lineHeight:18}}>{subtitle}</Text>:null}
    </View>
    {detail?<Text numberOfLines={1} style={{color:CL.muted,fontSize:13,maxWidth:110}}>{detail}</Text>:null}
    {onToggle?<Switch value={!!checked} onValueChange={onToggle}
      trackColor={{false:'#E6E5EA',true:'#CCC1F6'}}
      thumbColor={checked?CL.purple:'#B4B5BC'}/>:
      onPress?<Feather name="chevron-right" color={CL.muted} size={19}/>:null}
  </Pressable>;
}
function SectionTitle({children}:{children:string}){
  return <Text style={{fontSize:13,color:CL.muted,marginLeft:13,
    marginTop:7,marginBottom:11,letterSpacing:.3}}>{children}</Text>;
}

export function AccountScreen({screen,profile,extra,chatsCount,projectsCount,memoryCount,
  hasProviderKey,onBack,onNavigate,onUpdate,onUpdateExtra,onProvider,onModels,onWorkspace,
  onClearChats,onDisconnectProvider,onDeleteAccount,onHub}:Props){
  const [search, setSearch] = useState('');
  const matches = (terms:string) => !search.trim() || terms.toLocaleLowerCase('id').includes(search.trim().toLocaleLowerCase('id'));
  if(screen!=='settings'){
    return <PersonalSettingsScreen page={screen} profile={profile} extra={extra}
      onProfile={onUpdate} onExtra={onUpdateExtra} onBack={onBack} onNavigate={onNavigate}
      onHub={onHub} onModels={onModels} onProvider={onProvider}
      onDeleteAccount={onDeleteAccount} providerConnected={hasProviderKey}
      memoryCount={memoryCount} connectorCount={extra.connectors.length}/>;
  }
  const unavailable=(label:string)=>Alert.alert(label,
    'Fitur ini belum didukung sepenuhnya di APK LUMAVUN sekarang. Belum ada layanan yang aktif secara tersembunyi.');
  const confirmClear=()=>Alert.alert('Hapus seluruh riwayat chat?',
    'Percakapan di perangkat akan dihapus, sedangkan proyek dan memori tetap tersimpan.',[
    {text:'Batal',style:'cancel'},
    {text:'Hapus riwayat',style:'destructive',onPress:onClearChats}
  ]);
  const confirmDisconnect=()=>Alert.alert('Putuskan provider AI?',
    'Kunci API provider akan dihapus dari SecureStore. Percakapan dan proyek lokal tidak berubah.',[
    {text:'Batal',style:'cancel'},
    {text:'Putuskan',style:'destructive',onPress:onDisconnectProvider}
  ]);
  return <View style={{flex:1,backgroundColor:CL.bg}}>
    <View style={{height:66,paddingHorizontal:19,flexDirection:'row',
      alignItems:'center',justifyContent:'space-between'}}>
      <Pressable accessibilityRole="button" accessibilityLabel="Kembali"
        onPress={onBack} style={{width:44,height:44,borderRadius:23,
          backgroundColor:CL.card,alignItems:'center',justifyContent:'center'}}>
        <Feather name="arrow-left" size={24} color={CL.text}/>
      </Pressable>
      <Text style={{fontSize:23,fontWeight:'600',color:CL.text}}>Pengaturan</Text>
      <View style={{width:44}}/>
    </View>
    <ScrollView keyboardShouldPersistTaps="handled"
      contentContainerStyle={{paddingHorizontal:19,paddingTop:18,paddingBottom:54}}>
      <View style={{backgroundColor:CL.card,borderColor:CL.line,borderWidth:1,borderRadius:17,
        flexDirection:'row',alignItems:'center',paddingHorizontal:14,marginBottom:18,gap:10}}>
        <Feather name="search" size={19} color={CL.muted}/>
        <TextInput accessibilityLabel="Cari pengaturan LUMAVUN" placeholder="Cari pengaturan"
          placeholderTextColor={CL.muted} value={search} onChangeText={setSearch}
          style={{flex:1,minHeight:48,color:CL.text,fontSize:15}}/>
        {!!search && <Pressable accessibilityRole="button" accessibilityLabel="Hapus pencarian"
          onPress={()=>setSearch('')}><Feather name="x" size={19} color={CL.muted}/></Pressable>}
      </View>
      {matches('akun personalisasi profil umum sesuaikan lumavun kepribadian') && <>
      <SectionTitle>AKUN & PERSONALISASI</SectionTitle>
      <Group>
        <Row icon="user" title="Profil" detail={profile.name}
          onPress={()=>onNavigate('profile')}/>
        <Row icon="settings" title="Umum" subtitle="Bahasa, model, pencarian, dan preferensi aplikasi"
          onPress={()=>onNavigate('general')}/>
        <Row icon="sliders" title="Sesuaikan LUMAVUN"
          subtitle="Kepribadian, memori, plugin, dan layanan terhubung"
          onPress={()=>onNavigate('customize')} last/>
      </Group>
      </>}
      {matches('workspace model ai provider api proyek percakapan') && <>
      <SectionTitle>WORKSPACE & MODEL AI</SectionTitle>
      <Group>
        <Row icon="briefcase" title="Workspace" detail="Pribadi" onPress={onWorkspace}/>
        <Row icon="cpu" title="Provider AI & API"
          detail={hasProviderKey?'Terhubung':'Belum diatur'} onPress={onProvider}/>
        <Row icon="layers" title="Model AI lokal & cloud" onPress={()=>onHub('models')}/>
        <Row icon="folder" title="Proyek" detail={String(projectsCount)} onPress={onWorkspace}/>
        <Row icon="message-circle" title="Percakapan" detail={String(chatsCount)}
          onPress={()=>onHub('usage')} last/>
      </Group>
      </>}
      {matches('kemampuan kontrol konektor mcp skill memori izin penggunaan batasan') && <>
      <SectionTitle>KEMAMPUAN & KONTROL</SectionTitle>
      <Group>
        <Row icon="zap" title="Kemampuan" onPress={()=>onHub('capabilities')}/>
        <Row icon="grid" title="Konektor MCP" detail={extra.connectors.length+' konektor'}
          onPress={()=>onHub('connectors')}/>
        <Row icon="github" title="Skill" onPress={()=>onHub('skills')}/>
        <Row icon="book" title="Memori" detail={String(memoryCount)}
          onPress={()=>onHub('memory')}/>
        <Row icon="shield" title="Izin" onPress={()=>onHub('permissions')}/>
        <Row icon="activity" title="Penggunaan dan batasan" onPress={()=>onHub('usage')} last/>
      </Group>
      </>}
      {matches('tampilan perangkat mode warna aksen ukuran teks haptik bilah tab') && <>
      <SectionTitle>TAMPILAN & PERANGKAT</SectionTitle>
      <Group>
        <Row icon="moon" title="Mode warna" detail="Gelap (aplikasi utama)"
          onPress={()=>unavailable('Mode warna')}/>
        <Row icon="droplet" title="Warna aksen" detail="Ungu lunar"
          onPress={()=>unavailable('Warna aksen')}/>
        <Row icon="type" title="Ukuran teks chat" detail={profile.largeText?'Besar':'Normal'}
          onPress={()=>onUpdate({...profile,largeText:!profile.largeText})}/>
        <Row icon="smartphone" title="Umpan balik haptik" checked={profile.haptics}
          onToggle={value=>onUpdate({...profile,haptics:value})}/>
        <Row icon="maximize" title="Sembunyikan bilah tab saat chat" checked={profile.hideTabs}
          onToggle={value=>onUpdate({...profile,hideTabs:value})} last/>
      </Group>
      </>}
      {matches('data privasi penyimpanan lokal hapus riwayat chat putuskan provider') && <>
      <SectionTitle>DATA & PRIVASI</SectionTitle>
      <Group>
        <Row icon="hard-drive" title="Penyimpanan lokal"
          subtitle={chatsCount+' percakapan, '+projectsCount+' proyek, '+memoryCount+' catatan memori'}
          onPress={()=>Alert.alert('Penyimpanan LUMAVUN',
            'Chat dan pengaturan disimpan pada perangkat, catatan memori di SQLite. Permintaan provider cloud mengirim isi prompt yang diperlukan ke penyedia AI.')}/>
        <Row icon="trash-2" title="Hapus riwayat chat" onPress={confirmClear}/>
        <Row icon="log-out" title="Putuskan API provider" onPress={confirmDisconnect} last/>
      </Group>
      </>}
      {matches('tentang lumavun informasi aplikasi') && <Group>
        <Row icon="info" title="Tentang LUMAVUN" detail="Imagine Beyond the Mist"
          onPress={()=>Alert.alert('LUMAVUN Agent',
            'Aplikasi AI, model lokal, MCP, dan Code Work. Fitur tertentu membutuhkan server, izin atau model yang mendukung.') } last/>
      </Group>
      <Text style={{color:CL.muted,fontSize:11,textAlign:'center',marginTop:10}}>
        LUMAVUN · Imagine Beyond the Mist
      </Text>
    </ScrollView>
  </View>;
}
