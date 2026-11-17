import React, { useEffect, useState } from 'react';
import { Alert, Image, Modal, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { UserPreferences } from '../store';
import type { ExtraState } from '../featureState';
import type { HubPage } from './HubScreen';
import { PERSONALITIES, type PersonalityId, type PreferenceLevel } from '../personalization';
import { addReferencePhoto, removeReferencePhoto } from '../profilePhotos';

export type PersonalPage='profile'|'general'|'customize'|'personality'|'references';
type Page='settings'|PersonalPage;
type Props={
  page:PersonalPage;
  profile:UserPreferences;
  extra:ExtraState;
  onProfile(p:UserPreferences):void;
  onExtra(p:ExtraState):void;
  onBack():void;
  onNavigate(p:Page):void;
  onHub(p:HubPage):void;
  onModels():void;
  onProvider():void;
  onDeleteAccount():void;
  providerConnected:boolean;
  memoryCount:number;
  connectorCount:number;
};
const CL={bg:'#FBFAFC',card:'#FFFFFF',text:'#191A20',muted:'#8C8C95',border:'#E3E2E7',
  accent:'#6955DA',tint:'#F0EDFF',danger:'#D4474F'};
const font={color:CL.text,fontSize:16} as const;
const note={color:CL.muted,fontSize:13,lineHeight:20} as const;
function Header({title,onBack,onDone}:{
  title:string;onBack():void;onDone?:()=>void
}){
  return <View style={{height:66,paddingHorizontal:18,flexDirection:'row',alignItems:'center',justifyContent:'space-between'}}>
    <Pressable accessibilityRole="button" accessibilityLabel="Kembali" onPress={onBack}
      style={{backgroundColor:CL.card,width:44,height:44,borderRadius:24,alignItems:'center',justifyContent:'center'}}>
      <Feather name="arrow-left" size={25} color={CL.text}/>
    </Pressable>
    <Text style={{color:CL.text,fontSize:22,fontWeight:'600'}}>{title}</Text>
    {onDone?<Pressable accessibilityRole="button" accessibilityLabel="Simpan pengaturan"
      onPress={onDone} style={{backgroundColor:CL.card,width:44,height:44,borderRadius:24,alignItems:'center',justifyContent:'center'}}>
      <Feather name="check" size={26} color={CL.accent}/>
    </Pressable>:<View style={{width:44}}/>}
  </View>;
}
function Group({children}:{children:React.ReactNode}){
  return <View style={{backgroundColor:CL.card,borderRadius:24,overflow:'hidden',
    borderWidth:1,borderColor:CL.border,marginBottom:18}}>{children}</View>;
}
function Row({title,icon,detail,onPress,switchValue,onToggle,disabled=false,last=false}:{
  title:string;icon?:keyof typeof Feather.glyphMap;detail?:string;onPress?:()=>void;
  switchValue?:boolean;onToggle?:(v:boolean)=>void;disabled?:boolean;last?:boolean
}){
  return <Pressable accessibilityRole={onToggle?'switch':'button'}
    accessibilityState={{disabled,checked:switchValue}}
    disabled={disabled||(!onPress&&!onToggle)}
    onPress={onPress||(onToggle?()=>onToggle(!switchValue):undefined)}
    style={{flexDirection:'row',alignItems:'center',paddingHorizontal:16,paddingVertical:15,minHeight:66,
      borderBottomWidth:last?0:1,borderBottomColor:CL.border,gap:14,opacity:disabled?.52:1}}>
    {icon?<Feather name={icon} color={CL.accent} size={21}/>:null}
    <Text style={{...font,flex:1}}>{title}</Text>
    {detail?<Text numberOfLines={1} style={{color:CL.muted,fontSize:13,maxWidth:150}}>{detail}</Text>:null}
    {onToggle?<Switch value={!!switchValue} onValueChange={onToggle}
      trackColor={{false:'#E6E5EA',true:'#D0C6FC'}} thumbColor={switchValue?CL.accent:'#B0B0B6'}/>:
      onPress?<Feather name="chevron-right" size={19} color={CL.muted}/>:null}
  </Pressable>;
}
function ActionButton({label,onPress,disabled=false}:{label:string;onPress():void;disabled?:boolean}){
  return <Pressable disabled={disabled} accessibilityRole="button" onPress={onPress}
    style={{backgroundColor:disabled?'#D7D5D8':CL.accent,borderRadius:22,paddingVertical:14,
      paddingHorizontal:18,alignItems:'center',marginTop:12,opacity:disabled?.75:1}}>
    <Text style={{color:'#FFFFFF',fontWeight:'700',fontSize:16}}>{label}</Text>
  </Pressable>;
}
function ThreeLevels({title,value,onChange}:{
  title:string;value:PreferenceLevel;onChange:(v:PreferenceLevel)=>void
}){
  return <View style={{paddingHorizontal:16,paddingVertical:17,flexDirection:'row',alignItems:'center',
    borderBottomWidth:1,borderBottomColor:CL.border,gap:12,minHeight:78}}>
    <Text style={{color:CL.text,fontSize:16,flex:1}}>{title}</Text>
    <View style={{flexDirection:'row',backgroundColor:'#F0EFF3',borderRadius:24,padding:3,gap:5}}>
      {([0,1,2] as const).map((n)=><Pressable key={n}
        onPress={()=>onChange(n)} accessibilityRole="button"
        accessibilityLabel={title+' '+(n===0?'Rendah':n===1?'Sedang':'Tinggi')}
        accessibilityState={{selected:value===n}}
        style={{width:33,height:30,borderRadius:16,alignItems:'center',justifyContent:'center',
          backgroundColor:value===n?CL.accent:'transparent'}}>
        <View style={{width:7,height:7,borderRadius:4,backgroundColor:value===n?'#fff':'#66636C'}}/>
      </Pressable>)}
    </View>
  </View>;
}
function ChoiceSheet({visible,title,options,value,onClose,onPick}:{
  visible:boolean;title:string;options:{id:string;label:string;detail?:string}[];
  value:string;onClose():void;onPick(id:string):void
}){
  return <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
    <View style={{flex:1,justifyContent:'flex-end',backgroundColor:'#0807169A'}}>
      <Pressable style={{flex:1}} onPress={onClose}/>
      <View style={{backgroundColor:CL.bg,borderTopLeftRadius:28,borderTopRightRadius:28,
        paddingHorizontal:22,paddingTop:22,paddingBottom:34,maxHeight:'72%'}}>
        <Text style={{fontSize:21,fontWeight:'700',color:CL.text,marginBottom:14}}>{title}</Text>
        <ScrollView>
          {options.map(o=><Pressable key={o.id} accessibilityRole="button"
            onPress={()=>{onPick(o.id);onClose()}} style={{flexDirection:'row',paddingVertical:14,
              borderBottomWidth:1,borderBottomColor:CL.border,alignItems:'center',gap:12}}>
            <View style={{flex:1}}>
              <Text style={{color:CL.text,fontSize:16}}>{o.label}</Text>
              {o.detail?<Text style={note}>{o.detail}</Text>:null}
            </View>
            {value===o.id?<Feather name="check-circle" color={CL.accent} size={23}/>:null}
          </Pressable>)}
        </ScrollView>
      </View>
    </View>
  </Modal>;
}

export function PersonalSettingsScreen({page,profile,extra,onProfile,onExtra,onBack,onNavigate,onHub,
  onModels,onProvider,onDeleteAccount,providerConnected,memoryCount,connectorCount}:Props){
  const [fullName,setFullName]=useState(profile.fullName);
  const [nickname,setNickname]=useState(profile.name);
  const [preferences,setPreferences]=useState(profile.personalInstructions);
  const [customTone,setCustomTone]=useState(profile.personalityInstructions);
  const [petName,setPetName]=useState(profile.petName);
  const [editingPet,setEditingPet]=useState(false);
  const [picker,setPicker]=useState<'language'|'personality'|null>(null);
  const [importing,setImporting]=useState(false);
  useEffect(()=>{
    setFullName(profile.fullName);setNickname(profile.name);
    setPreferences(profile.personalInstructions);
    setCustomTone(profile.personalityInstructions);setPetName(profile.petName);
  },[profile.fullName,profile.name,profile.personalInstructions,profile.personalityInstructions,profile.petName]);
  const change=(patch:Partial<UserPreferences>)=>onProfile({...profile,...patch});
  const toggleWeb=(value:boolean)=>{
    onExtra({...extra,capabilities:{...extra.capabilities,webSearch:value},
      brain:{...extra.brain,research:value?(extra.brain.research==='off'?'web':extra.brain.research):'off'}});
  };
  const saveIdentity=()=>{
    const value=nickname.trim().slice(0,32);
    if(!value){Alert.alert('Nama panggilan wajib diisi');return}
    change({name:value,fullName:fullName.trim().slice(0,100)});
  };
  const importPhoto=async()=>{
    setImporting(true);
    try{const uris=await addReferencePhoto(profile.referencePhotoUris);
      change({referencePhotoUris:uris})}
    catch(err){Alert.alert('Foto gagal disimpan',String(err instanceof Error?err.message:err))}
    finally{setImporting(false)}
  };
  const selectModel=()=>onModels();
  const settingsScreen=<View style={{flex:1,backgroundColor:CL.bg}}>
    <Header title={page==='profile'?'Profil':page==='general'?'Umum':
      page==='customize'?'Sesuaikan':page==='personality'?'Kepribadian':'Foto referensi'}
      onBack={onBack}
      onDone={page==='personality'?()=>{
        change({personalityInstructions:customTone.trim().slice(0,4000)});
        onBack();
      }:undefined}/>
    <ScrollView style={{flex:1}} keyboardShouldPersistTaps="handled"
      contentContainerStyle={{paddingHorizontal:20,paddingTop:18,paddingBottom:64}}>
      {page==='profile'&&<>
        <Text style={{...font,marginBottom:8}}>Nama lengkap</Text>
        <TextInput accessibilityLabel="Nama lengkap" style={{borderWidth:1,borderColor:CL.border,
          borderRadius:18,padding:16,fontSize:18,color:CL.text,backgroundColor:CL.card,minHeight:59}}
          value={fullName} maxLength={100} onChangeText={setFullName}
          placeholder="Nama lengkap (opsional)" placeholderTextColor={CL.muted}/>
        <Text style={{...font,marginTop:22,marginBottom:8}}>Bagaimana LUMAVUN sebaiknya memanggil Anda?</Text>
        <TextInput accessibilityLabel="Nama panggilan" style={{borderWidth:1,borderColor:CL.border,
          borderRadius:18,padding:16,fontSize:18,color:CL.text,backgroundColor:CL.card,minHeight:59}}
          value={nickname} maxLength={32} onChangeText={setNickname} placeholder="Nama panggilan"
          placeholderTextColor={CL.muted}/>
        <ActionButton label="Perbarui profil" onPress={saveIdentity}
          disabled={!nickname.trim()||(nickname.trim()===profile.name&&fullName.trim()===profile.fullName)}/>
        <Text style={{...font,marginTop:32,marginBottom:8,lineHeight:25}}>
          Preferensi pribadi apa yang perlu LUMAVUN pertimbangkan dalam respons?
        </Text>
        <Text style={{...note,marginBottom:12}}>
          Preferensi berlaku untuk percakapan baru dan konteks yang masih tersedia pada chat aktif.
        </Text>
        <TextInput accessibilityLabel="Preferensi pribadi" multiline textAlignVertical="top"
          style={{backgroundColor:CL.card,borderWidth:1,borderColor:CL.border,borderRadius:18,
            minHeight:165,maxHeight:300,padding:15,color:CL.text,fontSize:16,lineHeight:24}}
          value={preferences} onChangeText={setPreferences} maxLength={4000}
          placeholder="Contoh: Jelaskan alasan, tampilkan pro-kontra dan bedakan asumsi dengan fakta."
          placeholderTextColor={CL.muted}/>
        <ActionButton label="Simpan preferensi" onPress={()=>
          change({personalInstructions:preferences.trim().slice(0,4000)})}
          disabled={preferences.trim()===profile.personalInstructions}/>
        <Text style={{...font,marginTop:43,marginBottom:12,fontWeight:'600'}}>Tindakan akun</Text>
        <Pressable accessibilityRole="button" onPress={()=>Alert.alert('Hapus data akun lokal?',
          'Aplikasi belum memiliki akun cloud LUMAVUN. Tindakan ini menghapus data lokal, proyek, memori, dan API key di perangkat. Tidak dapat dipulihkan.',[
            {text:'Batal',style:'cancel'},
            {text:'Hapus data lokal',style:'destructive',onPress:onDeleteAccount}
          ])} style={{paddingVertical:14,flexDirection:'row',alignItems:'center',gap:13}}>
          <Feather name="trash-2" color={CL.danger} size={20}/>
          <Text style={{color:CL.danger,fontSize:16}}>Hapus data akun lokal</Text>
        </Pressable>
      </>}
      {page==='general'&&<>
        <Text style={{...note,marginHorizontal:12,marginBottom:7}}>Nama panggilan</Text>
        <Pressable onPress={()=>onNavigate('profile')} style={{borderRadius:24,
          backgroundColor:CL.card,borderWidth:1,borderColor:CL.border,padding:17,marginBottom:17}}>
          <Text style={font}>{profile.name}</Text>
        </Pressable>
        <Group>
          <Row title="Bahasa aplikasi" detail={profile.appLanguage==='id'?'Indonesia':'English'}
            onPress={()=>setPicker('language')} last/>
        </Group>
        <Group>
          <Row icon="image" title="Foto referensi" detail={profile.referencePhotoUris.length+' tersimpan'}
            onPress={()=>onNavigate('references')} last/>
        </Group>
        <Text style={{...note,marginTop:-8,marginBottom:18,marginLeft:13}}>
          Foto tersimpan lokal dan belum digunakan otomatis untuk menghasilkan gambar AI.
        </Text>
        <Group>
          <Row icon="heart" title="Peliharaan" detail={profile.petName||'Belum ada'}
            onPress={()=>setEditingPet(x=>!x)} last/>
          {editingPet&&<View style={{padding:14,gap:10}}>
            <Text style={note}>Nama peliharaan (opsional)</Text>
            <TextInput value={petName} onChangeText={setPetName}
              maxLength={80} placeholder="Nama peliharaan"
              placeholderTextColor={CL.muted}
              style={{borderWidth:1,borderColor:CL.border,borderRadius:13,padding:12,
                color:CL.text,backgroundColor:CL.bg}}/>
            <Pressable accessibilityRole="button"
              onPress={()=>{change({petName:petName.trim().slice(0,80)});setEditingPet(false)}}
              style={{backgroundColor:CL.accent,borderRadius:13,padding:12}}>
              <Text style={{color:'white',textAlign:'center'}}>Simpan peliharaan</Text>
            </Pressable>
          </View>}
        </Group>
        <Text style={{...note,marginTop:7,marginBottom:8,marginLeft:12}}>Kecerdasan</Text>
        <Group>
          <Row icon="cpu" title="Model" detail="Pilih model AI" onPress={selectModel}/>
          <Row icon="layout" title="Jawaban visual"
            detail={profile.visualAnswers?'Aktif':'Nonaktif'}
            onPress={()=>change({visualAnswers:!profile.visualAnswers})}/>
          <Row icon="zap" title="Jawaban cepat" switchValue={profile.quickAnswers}
            onToggle={value=>change({quickAnswers:value})}/>
        </Group>
        <Text style={{...note,marginTop:-11,marginBottom:24,marginLeft:12}}>
          Jawaban cepat mempersingkat respons dan tidak memasukkan catatan memori ke prompt.
        </Text>
        <Group>
          <Row icon="home" title="Saran beranda" switchValue={profile.homeSuggestions}
            onToggle={value=>change({homeSuggestions:value})} last/>
        </Group>
        <Group>
          <Row icon="globe" title="Pencarian web" switchValue={extra.capabilities.webSearch}
            onToggle={toggleWeb}/>
          <Row icon="book-open" title="Pencarian pustaka lokal"
            switchValue={profile.librarySearch} onToggle={value=>change({librarySearch:value})} last/>
        </Group>
        <Text style={{...note,marginLeft:12}}>
          Pencarian pustaka menggunakan judul percakapan dan artefak lokal, bukan layanan pustaka cloud.
        </Text>
      </>}
      {page==='customize'&&<>
        <Group>
          <Row icon="sliders" title="Kepribadian"
            detail={PERSONALITIES.find(x=>x.id===profile.personality)?.name||'Bawaan'}
            onPress={()=>onNavigate('personality')}/>
          <Row icon="book-open" title="Memori" detail={memoryCount+' catatan'}
            onPress={()=>onHub('memory')}/>
          <Row icon="grid" title="Plugin" detail={connectorCount+' MCP kustom'}
            onPress={()=>onHub('connectors')} last/>
        </Group>
        <Group>
          <Row icon="mail" title="Email" detail="Siapkan" onPress={()=>onHub('connectors')}/>
          <Row icon="calendar" title="Kalender" detail="Atur izin"
            onPress={()=>onHub('permissions')}/>
          <Row icon="users" title="Kontak" detail="Belum tersedia"
            onPress={()=>Alert.alert('Kontak','Integrasi kontak belum tersedia dalam APK ini. Tidak ada izin kontak yang diminta.')}/>
          <Row icon="credit-card" title="Dompet" detail="Belum tersedia"
            onPress={()=>Alert.alert('Dompet','Konektor dompet tidak diaktifkan tanpa otorisasi pengguna.')}/>
          <Row icon="lock" title="Kata sandi" detail="0 item"
            onPress={()=>Alert.alert('Kata sandi','LUMAVUN tidak menyimpan atau meminta kata sandi layanan lain. Gunakan pengelola sandi perangkat.') } last/>
        </Group>
        <Group>
          <Row icon="navigation" title="Lokasi" detail="Kelola izin" onPress={()=>onHub('permissions')}/>
          <Row icon="globe" title="Peramban" detail={extra.capabilities.webSearch?'Pencarian aktif':'Nonaktif'}
            onPress={()=>onHub('connectors')} last/>
        </Group>
        <Text style={{...note,marginLeft:10}}>
          Konektor, kalender, lokasi, dan fitur perangkat hanya berfungsi jika layanan serta izinnya benar-benar tersedia.
        </Text>
      </>}
      {page==='personality'&&<>
        <Group>
          <Row title="Gaya dan nada"
            detail={PERSONALITIES.find(x=>x.id===profile.personality)?.name}
            onPress={()=>setPicker('personality')}/>
          <ThreeLevels title="Kehangatan" value={profile.warmth}
            onChange={value=>change({warmth:value})}/>
          <ThreeLevels title="Antusiasme" value={profile.enthusiasm}
            onChange={value=>change({enthusiasm:value})}/>
          <ThreeLevels title="Judul dan daftar" value={profile.formatting}
            onChange={value=>change({formatting:value})}/>
          <ThreeLevels title="Emoji" value={profile.emoji}
            onChange={value=>change({emoji:value})}/>
        </Group>
        <Text style={{...note,marginTop:12,marginBottom:10,marginLeft:8,fontSize:15}}>
          Instruksi khusus
        </Text>
        <TextInput multiline textAlignVertical="top" value={customTone}
          onChangeText={setCustomTone} maxLength={4000}
          placeholder="Jelaskan gaya jawaban, aturan penulisan, atau hal yang perlu dipertimbangkan."
          placeholderTextColor={CL.muted} style={{borderRadius:23,borderWidth:1,
            borderColor:CL.border,backgroundColor:CL.card,minHeight:210,maxHeight:400,
            padding:16,color:CL.text,fontSize:15,lineHeight:25}}/>
        <Text style={{...note,marginLeft:8,marginTop:8}}>
          Preferensi gaya memengaruhi format respons, tidak mengubah kemampuan atau kebijakan model.
        </Text>
        <ActionButton label="Simpan instruksi khusus" onPress={()=>
          change({personalityInstructions:customTone.trim().slice(0,4000)})}
          disabled={customTone.trim()===profile.personalityInstructions}/>
      </>}
      {page==='references'&&<>
        <Text style={{...note,marginBottom:17}}>
          Simpan hingga tiga foto di penyimpanan privat aplikasi. Tidak dikirim otomatis ke provider AI.
        </Text>
        <Group>
          {profile.referencePhotoUris.length===0?
            <Text style={{...note,padding:18}}>Belum ada foto referensi.</Text>:
            profile.referencePhotoUris.map(uri=><View key={uri}
              style={{padding:13,flexDirection:'row',alignItems:'center',gap:14,
                borderBottomWidth:1,borderColor:CL.border}}>
              <Image source={{uri}} style={{width:80,height:80,borderRadius:13}}/>
              <Text style={{...font,flex:1}}>Foto referensi pribadi</Text>
              <Pressable accessibilityLabel="Hapus foto referensi" onPress={()=>change({
                referencePhotoUris:removeReferencePhoto(profile.referencePhotoUris,uri)
              })}><Feather name="trash-2" color={CL.danger} size={20}/></Pressable>
            </View>)}
        </Group>
        <ActionButton label={importing?'Memproses foto…':'Tambah foto'}
          disabled={importing||profile.referencePhotoUris.length>=3}
          onPress={()=>void importPhoto()}/>
      </>}
    </ScrollView>
    <ChoiceSheet visible={!!picker} onClose={()=>setPicker(null)}
      title={picker==='language'?'Bahasa':'Gaya dan nada'}
      value={picker==='language'?profile.appLanguage:profile.personality}
      options={picker==='language'?
        [{id:'id',label:'Indonesia',detail:'Bahasa respons utama'},
         {id:'en',label:'English',detail:'English responses'}]:
         PERSONALITIES.map(x=>({id:x.id,label:x.name,detail:x.instruction}))}
      onPick={value=>picker==='language'?
        change({appLanguage:value==='en'?'en':'id'}):
        change({personality:value as PersonalityId})}/>
  </View>;
  return settingsScreen;
}
