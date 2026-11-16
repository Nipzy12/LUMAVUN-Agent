
import React, { useEffect, useState } from 'react';
import { Alert, ActivityIndicator, Linking, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import * as Location from 'expo-location';
import * as Calendar from 'expo-calendar';
import type { ExtraState, CapabilityKey, Connector, Skill } from '../featureState';
import { DEFAULT_CAPABILITIES, validMcpUrl, usageSummary } from '../featureState';
import { FEATURED_SKILLS, getSkill, type SkillCandidate } from '../githubSkills';
import { listMcpTools, type MCPTool } from '../mcpClient';
import { GGUF_CATALOG, installedModelIds, bytesOnDisk, cancelModelDownload, downloadModel, removeModel, unloadModel } from '../localAI';
import type { ModelInfo } from '../types';
import { id } from '../paths';
import { ActionIcon, C, PrimaryButton, Sheet, style } from '../ui';

export type HubPage='capabilities'|'connectors'|'permissions'|'usage'|'skills'|'models'|'memory';
type Props={
 page:HubPage; extra:ExtraState;
 cloudModels:ModelInfo[]; selectedCloud:string;
 onBack():void;
 onPage(page:HubPage):void;
 onChange(extra:ExtraState):void;
 onPickCloud(id:string):void;
 onProvider():void;
};
const tiny={color:C.muted,fontSize:12,lineHeight:18} as const;
function Section({title,children}:{title:string;children:React.ReactNode}) {
 return <View style={{marginBottom:20,gap:9}}>
   <Text style={{color:C.muted,fontSize:13,marginHorizontal:8}}>{title}</Text>
   <View style={{backgroundColor:C.surface,borderRadius:17,overflow:'hidden',borderWidth:1,borderColor:C.border}}>{children}</View>
 </View>;
}
function Row({icon,title,detail,onPress,right}:{icon:keyof typeof Feather.glyphMap;title:string;detail?:string;onPress?:()=>void;right?:React.ReactNode}){
 return <Pressable onPress={onPress} disabled={!onPress} style={[style.row,{
   minHeight:65,borderBottomWidth:1,borderBottomColor:C.border,paddingHorizontal:15,paddingVertical:12,gap:13
 }]}>
   <Feather name={icon} color={C.muted} size={20}/>
   <View style={{flex:1,gap:5}}>
     <Text style={{color:C.text,fontSize:15,fontWeight:'600'}}>{title}</Text>
     {detail&&<Text style={tiny}>{detail}</Text>}
   </View>
   {right||(onPress?<Feather name="chevron-right" color={C.subtle} size={17}/>:null)}
 </Pressable>;
}
export function HubScreen({page,extra,cloudModels,selectedCloud,onBack,onPage,onChange,onPickCloud,onProvider}:Props){
 const [addConnector,setAddConnector]=useState(false);
 const [connectorName,setConnectorName]=useState('');
 const [connectorUrl,setConnectorUrl]=useState('');
 const [connectorToken,setConnectorToken]=useState('');
 const [connectorBusy,setConnectorBusy]=useState(false);
 const [mcpTools,setMcpTools]=useState<Record<string,MCPTool[]>>({});
 const [addSkill,setAddSkill]=useState(false);
 const [skillRepo,setSkillRepo]=useState('');
 const [skillPath,setSkillPath]=useState('skills/pdf/SKILL.md');
 const [skillBusy,setSkillBusy]=useState('');
 const [modelBusy,setModelBusy]=useState('');
 const [progress,setProgress]=useState(0);
 const [installed,setInstalled]=useState<string[]>([]);
 const [modelSearch,setModelSearch]=useState('');
 const [note,setNote]=useState('');
 const [locStatus,setLocStatus]=useState('Belum diperiksa');
 const [calendarStatus,setCalendarStatus]=useState('Belum diperiksa');
 const [showAddMenu,setShowAddMenu]=useState(false);

 const [details,setDetails]=useState('');
 useEffect(()=>{setInstalled(installedModelIds());},[page,modelBusy]);
 useEffect(()=>{if(page==='permissions'){
   void Location.getForegroundPermissionsAsync().then(r=>setLocStatus(r.granted?'Saat digunakan':'Tidak diizinkan'));
   void Calendar.getCalendarPermissionsAsync().then(r=>setCalendarStatus(r.granted?'Diizinkan':'Tidak diizinkan'));
 }},[page]);
 const change=(patch:Partial<ExtraState>)=>onChange({...extra,...patch});
 const toggle=(key:CapabilityKey,value:boolean)=>{
   if(key==='sensitiveMemory'&&value&&!extra.capabilities.chatMemory) {
     Alert.alert('Memori belum aktif','Aktifkan pembuatan memori terlebih dahulu.'); return;
   }
   change({capabilities:{...extra.capabilities,[key]:value}});
 };
 const saveConnector=async()=>{
   if(!connectorName.trim()||!validMcpUrl(connectorUrl.trim())){
     Alert.alert('Alamat tidak valid','Gunakan HTTPS MCP endpoint, atau HTTP di localhost/127.0.0.1.');return;
   }
   const item:Connector={id:id('mcp'),name:connectorName.trim().slice(0,60),url:connectorUrl.trim(),
     enabled:true,toolCount:0,verified:false};
   await SecureStore.setItemAsync('lumavun.mcp.'+item.id,connectorToken);
   change({connectors:[...extra.connectors,item]});
   setAddConnector(false);setConnectorName('');setConnectorUrl('');setConnectorToken('');
 };
 const testConnector=async(item:Connector)=>{
   setConnectorBusy(true);
   try{
     const key=await SecureStore.getItemAsync('lumavun.mcp.'+item.id)||'';
     const tools=await listMcpTools(item,key);
     setMcpTools(prev=>({...prev,[item.id]:tools}));
     change({connectors:extra.connectors.map(c=>c.id===item.id?{...c,toolCount:tools.length,verified:true}:c)});
     Alert.alert('MCP tersambung',tools.length+' tool ditemukan dari '+item.name);
   }catch(err){Alert.alert('MCP gagal',String(err instanceof Error?err.message:err));}
   finally{setConnectorBusy(false);}
 };
 const installSkill=async(item:SkillCandidate)=>{
   setSkillBusy(item.name);
   try{
     const skill=await getSkill(item);
     change({skills:[...extra.skills.filter(s=>s.id!==skill.id),skill]});
     Alert.alert('Skill terpasang',skill.name+' disimpan sebagai instruksi lokal. Tidak ada kode GitHub yang dieksekusi.');
     setAddSkill(false);
   }catch(err){Alert.alert('Install gagal',String(err instanceof Error?err.message:err));}
   finally{setSkillBusy('');}
 };
 const download=async(model:typeof GGUF_CATALOG[number])=>{
   setModelBusy(model.id);setProgress(0);
   try{await downloadModel(model,setProgress);setInstalled(installedModelIds());Alert.alert('Selesai','Model GGUF disimpan di perangkat.');}
   catch(e){Alert.alert('Unduhan gagal',String(e instanceof Error?e.message:e));}
   finally{setModelBusy('');}
 };
 const remove=async(model:typeof GGUF_CATALOG[number])=>{
   setModelBusy(model.id);
   try{
     await removeModel(model.id);
     if(extra.localModelId===model.id)change({localModelId:''});
     setInstalled(installedModelIds());
   }catch(e){Alert.alert('Hapus gagal',String(e));}
   finally{setModelBusy('');}
 };
 const pageTitle:Record<HubPage,string>={capabilities:'Kemampuan',connectors:'Konektor',permissions:'Izin',
   usage:'Penggunaan dan batasan',skills:'Skill GitHub',models:'Model AI',memory:'File memori'};
 const switchRow=(key:CapabilityKey,title:string,detail:string,disabled=false)=>
   <Row icon={key==='webSearch'?'globe':key==='chatMemory'?'bookmark':key==='codeTools'?'code':'sliders'}
     title={title} detail={detail}
     right={<Switch disabled={disabled} value={extra.capabilities[key]}
       onValueChange={v=>toggle(key,v)} trackColor={{true:'#396bb1',false:C.raised}}
       thumbColor={extra.capabilities[key]?'#f7f7f7':'#aaa'}/>} />;
 return <View style={{flex:1,backgroundColor:C.bg}}>
   <View style={[style.row,{height:62,paddingHorizontal:10}]}>
     <ActionIcon name="arrow-left" onPress={onBack}/>
     <Text style={{flex:1,textAlign:'center',color:C.text,fontSize:20,fontFamily:'serif',fontWeight:'700'}}>{pageTitle[page]}</Text>
     {page==='connectors'?<ActionIcon name="plus" onPress={()=>setShowAddMenu(x=>!x)}/>:<View style={{width:40}}/>}
   </View>
   {page==='connectors'&&showAddMenu&&<View style={{position:'absolute',top:60,right:12,zIndex:5,
     backgroundColor:C.raised,borderRadius:16,padding:8,minWidth:220}}>
     <Pressable onPress={()=>{setShowAddMenu(false);change({connectorDiscovery:!extra.connectorDiscovery})}} style={{padding:14}}>
       <Text style={style.txt}>Jelajahi konektor</Text>
     </Pressable>
     <Pressable onPress={()=>{setShowAddMenu(false);setAddConnector(true)}} style={{padding:14}}>
       <Text style={style.txt}>Tambahkan konektor kustom</Text>
     </Pressable>
   </View>}
   <ScrollView style={{flex:1}} contentContainerStyle={{paddingHorizontal:15,paddingTop:18,paddingBottom:55}}>
    {page==='capabilities'&&<>
      <Section title="Kemampuan">
        {switchRow('webSearch','Pencarian web','Aktif hanya dengan konektor pencarian MCP yang tersedia')}
        {switchRow('artifacts','Artefak','Simpan snapshot kode hasil Code Agent dan chat')}
        {switchRow('visualizations','Visualisasi dalam chat (BETA)','Pratinjau HTML lokal melalui Artefak')}
        {switchRow('codeTools','Eksekusi kode dan pembuatan file','Menulis file sandbox; tidak menjalankan shell')}
        {switchRow('modelFallback','Peralihan model saat jaringan bermasalah','Hanya untuk gangguan sementara provider; bukan penolakan keselamatan')}
      </Section>
      <Section title="Memori">
        {switchRow('chatMemory','Pembuatan memori dari chat','Simpan catatan lokal hanya lewat perintah "ingat:"')}
        {switchRow('sensitiveMemory','Sertakan topik sensitif dalam memori','Secara default tidak menyimpan topik sensitif')}
        <Row icon="file-text" title="File memori" detail={extra.memoryNotes.length+' catatan tersimpan'} onPress={()=>onPage('memory')}/>
      </Section>
      <Section title="Akses alat">
        {(['auto','ask','always'] as const).map(access=>
         <Row key={access} icon={access===extra.capabilities.toolAccess?'check-circle':'circle'}
           title={access==='auto'?'Otomatis':access==='ask'?'Sesuai permintaan':'Selalu tersedia'}
           detail={access==='always'?'Hanya baca tanpa konfirmasi; tulis/hapus tetap meminta izin':
             access==='ask'?'Semua tool agent meminta konfirmasi':'Agent memilih kapan membutuhkan tool'}
           onPress={()=>change({capabilities:{...extra.capabilities,toolAccess:access}})}/>)}
      </Section>
      <Section title="Tambahan">
        <Row icon="grid" title="Konektor MCP" detail={extra.connectors.length+' konektor'} onPress={()=>onPage('connectors')}/>
        <Row icon="box" title="Skill" detail={extra.skills.length+' skill terpasang'} onPress={()=>onPage('skills')}/>
        <Row icon="cpu" title="AI lokal & model" onPress={()=>onPage('models')}/>
        <Row icon="shield" title="Izin" onPress={()=>onPage('permissions')}/>
      </Section>
    </>}
    {page==='connectors'&&<>
      <Section title="Penemuan konektor">
        <Row icon="grid" title="Jelajahi konektor" detail="Temukan konektor yang ditambahkan ke aplikasi"
          right={<Switch value={extra.connectorDiscovery} onValueChange={v=>change({connectorDiscovery:v})}/>}/>
      </Section>
      <Section title="MCP Server yang dikonfigurasi">
        {extra.connectors.length===0&&<Text style={[tiny,{padding:18}]}>Belum ada MCP server. Tambahkan URL endpoint milikmu melalui tombol +.</Text>}
        {extra.connectors.map(item=><View key={item.id} style={{borderBottomWidth:1,borderColor:C.border,padding:14,gap:10}}>
          <View style={[style.row,{gap:10}]}>
            <Feather name="server" size={19} color={C.accent}/>
            <View style={{flex:1}}>
              <Text style={{color:C.text,fontSize:16,fontWeight:'700'}}>{item.name}</Text>
              <Text style={tiny} numberOfLines={1}>{item.url}</Text>
              <Text style={tiny}>{item.verified?item.toolCount+' tool ditemukan':'Belum diuji'}</Text>
            </View>
            <Switch value={item.enabled} onValueChange={value=>change({
              connectors:extra.connectors.map(c=>c.id===item.id?{...c,enabled:value}:c)})}/>
          </View>
          <View style={[style.row,{gap:10}]}>
            <Pressable onPress={()=>void testConnector(item)} disabled={connectorBusy}
              style={{padding:10,borderRadius:12,backgroundColor:C.raised,flex:1,alignItems:'center'}}>
              <Text style={{color:C.accent}}>Tes & lihat tools</Text>
            </Pressable>
            <Pressable onPress={()=>Alert.alert('Hapus konektor?',item.name,[
              {text:'Batal',style:'cancel'},{text:'Hapus',style:'destructive',onPress:()=>{
                void SecureStore.deleteItemAsync('lumavun.mcp.'+item.id);
                change({connectors:extra.connectors.filter(c=>c.id!==item.id)});
              }}])}
              style={{padding:10,borderRadius:12,backgroundColor:C.raised}}>
              <Feather name="trash-2" size={18} color={C.danger}/>
            </Pressable>
          </View>
          {(mcpTools[item.id]||[]).slice(0,25).map(t=><Text key={t.name} style={{color:C.muted,fontSize:12}}>• {t.name}</Text>)}
        </View>)}
      </Section>
      {extra.connectorDiscovery&&<Section title="Contoh integrasi yang dapat dikonfigurasi">
        {['Alpha Vantage MCP','Financial Modeling Prep','Gmail','Google Drive','Higgsfield','TakeProfit','MT5 MCP Server'].map(name=>
          <Row key={name} icon="server" title={name} detail="Tidak terhubung • tambahkan endpoint milikmu"
            onPress={()=>{setConnectorName(name);setAddConnector(true)}}/>)}
      </Section>}
      <Text style={tiny}>Koneksi menggunakan MCP Streamable HTTP. Token disimpan di SecureStore, tidak dikirim ke model AI. Eksekusi tool eksternal selalu meminta izin.</Text>
    </>}
    {page==='permissions'&&<>
      <Section title="Izin Android yang sebenarnya">
        <Row icon="navigation" title="Lokasi" detail={'Status: '+locStatus}
          onPress={()=>{void Location.requestForegroundPermissionsAsync()
            .then(r=>setLocStatus(r.granted?'Saat digunakan':'Tidak diizinkan'));}}/>
        <Row icon="calendar" title="Kalender" detail={'Status: '+calendarStatus}
          onPress={()=>{void Calendar.requestCalendarPermissionsAsync()
            .then(r=>setCalendarStatus(r.granted?'Diizinkan':'Tidak diizinkan'));}}/>
      </Section>
      <Text style={tiny}>Lokasi hanya diminta saat aplikasi digunakan. Akses lokasi latar belakang tidak diaktifkan. Persetujuan akses Android berbeda dari persetujuan tool Code Agent.</Text>
      <Pressable style={{marginTop:16,padding:14,backgroundColor:C.raised,borderRadius:14}}
        onPress={()=>void Linking.openSettings()}>
        <Text style={{color:C.accent}}>Buka pengaturan izin sistem Android</Text>
      </Pressable>
    </>}
    {page==='usage'&&(()=>{
      const summary=usageSummary(extra.usageEvents);
      return <>
        <Section title="Aktivitas 7 hari terakhir di perangkat">
          <Row icon="activity" title="Permintaan AI" detail={summary.calls+' permintaan tercatat'}/>
          <Row icon="cloud" title="Provider cloud" detail={summary.cloud+' panggilan'}/>
          <Row icon="cpu" title="Model lokal" detail={summary.local+' panggilan'}/>
          <Row icon="hash" title="Token provider" detail={summary.countWithProviderUsage+
            ' laporan pemakaian • '+(summary.promptTokens+summary.completionTokens)+' token terlapor'}/>
        </Section>
        <Section title="Batas penggunaan">
          <Row icon="info" title="Kuota mingguan provider" detail="Tidak tersedia dari API generik"/>
          <Row icon="credit-card" title="Sisa kredit" detail="Tidak dapat diverifikasi oleh LUMAVUN"/>
          <Row icon="repeat" title="Isi ulang otomatis" detail="Atur di situs provider; LUMAVUN tidak menagih"/>
        </Section>
        <Text style={tiny}>Statistik lokal bukan batas tagihan akun AI. Tidak ada angka kuota, tanggal reset, atau kredit yang dibuat-buat.</Text>
        <Pressable style={{padding:14,marginTop:18,borderRadius:12,backgroundColor:C.raised}}
          onPress={()=>Alert.alert('Reset statistik lokal?', 'Menghapus catatan permintaan pada aplikasi ini saja.',[
            {text:'Batal',style:'cancel'},
            {text:'Reset',style:'destructive',onPress:()=>change({usageEvents:[]})}])}>
          <Text style={{color:C.danger}}>Reset catatan penggunaan lokal</Text>
        </Pressable>
      </>;
    })()}
    {page==='skills'&&<>
      <Text style={[tiny,{marginBottom:12}]}>
        Skill GitHub disimpan sebagai instruksi tertulis; bukan plugin APK dan tidak mengeksekusi kode repo. Tinjau isinya sebelum mengaktifkan.
      </Text>
      <Section title="Skill terpasang">
        {extra.skills.length===0&&<Text style={[tiny,{padding:18}]}>Belum ada skill yang dipasang.</Text>}
        {extra.skills.map(skill=><View key={skill.id} style={{padding:14,gap:10,borderBottomWidth:1,borderColor:C.border}}>
          <View style={[style.row,{gap:8}]}>
            <Feather name="book-open" color={C.accent} size={17}/>
            <View style={{flex:1}}>
              <Text style={{color:C.text,fontSize:16,fontWeight:'700'}}>{skill.name}</Text>
              <Text style={tiny}>{skill.repo}/{skill.path}</Text>
            </View>
            <Switch value={skill.enabled} onValueChange={value=>change({skills:extra.skills.map(s=>s.id===skill.id?{...s,enabled:value}:s)})}/>
          </View>
          <View style={[style.row,{gap:8}]}>
            <Pressable onPress={()=>{setDetails(skill.text)}} style={{padding:9,backgroundColor:C.raised,borderRadius:10,flex:1}}>
              <Text style={{color:C.accent}}>Lihat isi</Text>
            </Pressable>
            <Pressable onPress={()=>change({skills:extra.skills.filter(s=>s.id!==skill.id)})}
              style={{padding:9,backgroundColor:C.raised,borderRadius:10,flex:1}}>
              <Text style={{color:C.danger}}>Uninstall</Text>
            </Pressable>
          </View>
        </View>)}
      </Section>
      <Section title="Pilihan dari GitHub">
        {FEATURED_SKILLS.map(candidate=><Row key={candidate.repo+candidate.path} icon="github" title={candidate.name}
          detail={candidate.description+' • '+candidate.repo}
          onPress={()=>void installSkill(candidate)}
          right={skillBusy===candidate.name?<ActivityIndicator color={C.accent}/>:<Feather name="download" color={C.accent} size={20}/>}/>)}
      </Section>
      <PrimaryButton title="Tambahkan dari repo GitHub" onPress={()=>setAddSkill(true)}/>
    </>}
    {page==='models'&&<>
      <Section title="Provider cloud">
        <Row icon="settings" title="Pengaturan API provider" detail="Kunci tersimpan aman" onPress={onProvider}/>
        <TextInput style={[style.input,{margin:12}]} placeholder="Cari model" placeholderTextColor={C.subtle}
          value={modelSearch} onChangeText={setModelSearch}/>
        {cloudModels.length===0&&<Text style={[tiny,{padding:14}]}>Sinkronkan daftar model lewat pengaturan provider.</Text>}
        {cloudModels.filter(m=>(m.id+m.name).toLowerCase().includes(modelSearch.toLowerCase())).map(m=>
          <Row key={m.id} icon={m.id===selectedCloud?'check-circle':'cloud'} title={m.name}
            detail={'Cloud • '+m.id+' • ukuran unduhan tidak berlaku'}
            onPress={()=>onPickCloud(m.id)}/>)}
      </Section>
      <Section title="Model GGUF yang bisa disimpan ke HP">
        {GGUF_CATALOG.map(m=><View key={m.id} style={{padding:14,gap:9,borderBottomWidth:1,borderColor:C.border}}>
          <Text style={{color:C.text,fontSize:15,fontWeight:'700'}}>{m.name}</Text>
          <Text style={tiny}>{m.description}</Text>
          <Text style={{color:C.accent,fontSize:12}}>
            {Math.round(m.sizeBytes/1000000)} MB • {m.family} • {installed.includes(m.id)?
              'Terpasang ('+Math.round(bytesOnDisk(m.id)/1000000)+' MB)':'Belum terpasang'}
          </Text>
          {modelBusy===m.id?<View style={{gap:6}}>
            <Text style={tiny}>Mengunduh {Math.round(progress*100)}%</Text>
            <View style={{height:5,backgroundColor:C.raised,borderRadius:5}}>
              <View style={{height:5,width:(Math.round(progress*100)+'%') as any,backgroundColor:C.accent,borderRadius:5}}/>
            </View>
            <Pressable onPress={cancelModelDownload}><Text style={{color:C.danger}}>Batalkan unduhan</Text></Pressable>
          </View>:<View style={[style.row,{gap:9}]}>
            {installed.includes(m.id)?<>
              <Pressable onPress={()=>change({localModelId:m.id})} style={{padding:12,flex:1,borderRadius:12,backgroundColor:C.raised}}>
                <Text style={{color:C.text}}>{extra.localModelId===m.id?'✓ Sedang dipilih':'Gunakan untuk Chat'}</Text>
              </Pressable>
              <Pressable onPress={()=>Alert.alert('Hapus model?',m.name,[
                {text:'Batal',style:'cancel'},
                {text:'Hapus',style:'destructive',onPress:()=>{void remove(m)}}])}
                style={{padding:12,backgroundColor:C.raised,borderRadius:12}}>
                <Feather name="trash-2" color={C.danger} size={18}/>
              </Pressable>
            </>:<Pressable onPress={()=>void download(m)}
              style={{backgroundColor:C.accentDeep,padding:12,borderRadius:12,flex:1,alignItems:'center'}}>
              <Text style={{color:C.text}}>Unduh ke perangkat</Text>
            </Pressable>}
          </View>}
        </View>)}
      </Section>
      {extra.localModelId!==''&&<Pressable style={{padding:14,backgroundColor:C.raised,borderRadius:12,marginBottom:15}}
         onPress={()=>{void unloadModel();change({localModelId:''})}}>
        <Text style={{color:C.accent}}>Kembali ke provider cloud</Text>
      </Pressable>}
      <Text style={tiny}>Model lokal dijalankan oleh llama.cpp (llama.rn), bukan server Ollama. Hanya GGUF yang cocok dengan engine dan memori HP yang tersedia. Unduh memerlukan internet; chat lokal setelah terpasang dapat offline.</Text>
    </>}
    {page==='memory'&&<>
      <Text style={[tiny,{marginBottom:10}]}>Catatan tersimpan lokal, hanya digunakan ketika memori diaktifkan.</Text>
      <TextInput style={[style.input,{minHeight:98,textAlignVertical:'top'}]} multiline
        placeholder="Catatan memori baru" placeholderTextColor={C.subtle} value={note} onChangeText={setNote}/>
      <PrimaryButton title="Tambah memori" onPress={()=>{
        if(!note.trim())return;
        change({memoryNotes:[...extra.memoryNotes,{id:id('memory'),text:note.trim().slice(0,2000),createdAt:Date.now()}]});
        setNote('');
      }}/>
      <Section title="Memori tersimpan">
        {extra.memoryNotes.map(m=><View key={m.id} style={[style.row,{padding:13,gap:10,borderBottomWidth:1,borderColor:C.border}]}>
          <Text style={{color:C.text,flex:1,lineHeight:22}}>{m.text}</Text>
          <ActionIcon name="trash-2" color={C.danger} size={17}
            onPress={()=>change({memoryNotes:extra.memoryNotes.filter(x=>x.id!==m.id)})}/>
        </View>)}
      </Section>
    </>}
   </ScrollView>
   <Sheet open={addConnector} title="Tambahkan MCP server" onClose={()=>setAddConnector(false)}>
     <Text style={style.label}>NAMA KONEKTOR</Text>
     <TextInput style={style.input} value={connectorName} onChangeText={setConnectorName} placeholder="MCP server"/>
     <Text style={style.label}>STREAMABLE HTTP URL</Text>
     <TextInput style={style.input} value={connectorUrl} onChangeText={setConnectorUrl} autoCapitalize="none"
       keyboardType="url" placeholder="https://mcp.example.com/mcp"/>
     <Text style={style.label}>BEARER TOKEN (OPSIONAL)</Text>
     <TextInput style={style.input} value={connectorToken} onChangeText={setConnectorToken} secureTextEntry
       placeholder="Token akses"/>
     <Text style={tiny}>Hanya HTTPS atau HTTP loopback. Tool eksternal selalu memerlukan persetujuan.</Text>
     <PrimaryButton title="Simpan konektor" onPress={()=>{void saveConnector()}}/>
   </Sheet>
   <Sheet open={addSkill} title="Install skill GitHub" onClose={()=>setAddSkill(false)}>
     <Text style={style.label}>OWNER/REPOSITORY</Text>
     <TextInput style={style.input} value={skillRepo} onChangeText={setSkillRepo} autoCapitalize="none"
       placeholder="anthropics/skills"/>
     <Text style={style.label}>PATH SKILL.md</Text>
     <TextInput style={style.input} value={skillPath} onChangeText={setSkillPath} autoCapitalize="none"/>
     <Text style={tiny}>Membaca file Markdown dari branch main. Hanya instruksi, tanpa menjalankan skrip.</Text>
     <PrimaryButton title={skillBusy?'Memasang…':'Unduh skill'} disabled={!!skillBusy} onPress={()=>{
       const candidate={repo:skillRepo.trim(),path:skillPath.trim(),name:skillPath.split('/').slice(-2,-1)[0]||'Custom skill',description:''};
       void installSkill(candidate);
     }}/>
   </Sheet>
   <Sheet open={!!details} title="Isi skill (baca saja)" onClose={()=>setDetails('')}>
     <Text selectable style={{color:C.text,fontSize:12,fontFamily:'monospace',lineHeight:19}}>{details}</Text>
   </Sheet>
 </View>;
}
