import React, { useState } from 'react';
import {
  Alert, Pressable, ScrollView, Switch, Text, TextInput, Vibration, View
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { C, ActionIcon, Logo, PrimaryButton, style } from '../ui';
import type { UserPreferences } from '../store';
import type { HubPage } from './HubScreen';

type Screen = 'settings' | 'profile';

type Props = {
  screen: Screen;
  profile: UserPreferences;
  chatsCount: number;
  projectsCount: number;
  hasProviderKey: boolean;
  onBack: () => void;
  onNavigate: (screen: Screen) => void;
  onUpdate: (value: UserPreferences) => void;
  onProvider: () => void;
  onModels: () => void;
  onWorkspace: () => void;
  onClearChats: () => void;
  onDisconnectProvider: () => void;
  onHub: (page: HubPage) => void;
};

type Glyph = keyof typeof Feather.glyphMap;

function Group({ children }: { children: React.ReactNode }) {
  return <View style={{
    backgroundColor: C.surface, borderRadius: 18, overflow: 'hidden',
    borderWidth: 1, borderColor: C.border, marginBottom: 16
  }}>{children}</View>;
}
function Row({ icon, title, subtitle, detail, onPress, last = false, trailing }: {
  icon: Glyph; title: string; subtitle?: string; detail?: string;
  onPress?: () => void; last?: boolean; trailing?: React.ReactNode;
}) {
  return <Pressable accessibilityRole="button"
    onPress={onPress} disabled={!onPress}
    style={{
      flexDirection: 'row', alignItems: 'center', minHeight: subtitle ? 72 : 56,
      borderBottomWidth: last ? 0 : 1, borderBottomColor: C.border,
      paddingHorizontal: 15, paddingVertical: 10, gap: 13
    }}>
    <Feather name={icon} size={21} color={C.muted} />
    <View style={{ flex: 1 }}>
      <Text style={{ color: C.text, fontSize: 15, fontWeight: '500' }}>{title}</Text>
      {subtitle ? <Text style={{ color: C.subtle, fontSize: 12, marginTop: 4, lineHeight: 17 }}>{subtitle}</Text> : null}
    </View>
    {detail ? <Text numberOfLines={1} style={{ color: C.subtle, fontSize: 12, maxWidth: 115 }}>{detail}</Text> : null}
    {trailing || (onPress ? <Feather name="chevron-right" size={17} color={C.subtle} /> : null)}
  </Pressable>;
}

function SectionTitle({ text }: { text: string }) {
  return <Text style={{ color: C.muted, fontSize: 12, paddingLeft: 11, paddingBottom: 9, letterSpacing: .7 }}>
    {text}
  </Text>;
}

export function AccountScreen({
  screen, profile, chatsCount, projectsCount, hasProviderKey, onBack,
  onNavigate, onUpdate, onProvider, onModels, onWorkspace,
  onClearChats, onDisconnectProvider, onHub
}: Props) {
  const [nameEdit, setNameEdit] = useState(false);
  const [name, setName] = useState(profile.name);
  const [fontSelection, setFontSelection] = useState(false);

  const unavailable = (name: string) => {
    Alert.alert(name, 'Fitur ini belum tersedia pada LUMAVUN versi sekarang. Tidak ada layanan yang diam-diam diaktifkan.');
  };
  const toggleHaptics = (value: boolean) => {
    onUpdate({ ...profile, haptics: value });
    if (value) Vibration.vibrate(15);
  };
  const saveName = () => {
    const cleaned = name.trim().replace(/\s+/g, ' ').slice(0, 32);
    if (!cleaned) {
      Alert.alert('Nama belum diisi', 'Masukkan nama tampilan terlebih dahulu.');
      return;
    }
    onUpdate({ ...profile, name: cleaned });
    setNameEdit(false);
  };
  const confirmClear = () => Alert.alert('Hapus riwayat percakapan?', 
    'Semua percakapan di perangkat ini akan dihapus. File proyek tidak ikut terhapus.', [
      { text: 'Batal', style: 'cancel' },
      { text: 'Hapus riwayat', style: 'destructive', onPress: onClearChats }
    ]);
  const confirmDisconnect = () => Alert.alert('Putuskan AI provider?',
    'Kunci API akan dihapus dari perangkat. Percakapan dan proyek lokal tetap tersimpan.', [
      { text: 'Batal', style: 'cancel' },
      { text: 'Putuskan', style: 'destructive', onPress: onDisconnectProvider }
    ]);

  return <View style={{ flex: 1, backgroundColor: C.bg }}>
    <View style={{
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 12, height: 60
    }}>
      <ActionIcon name="arrow-left" onPress={onBack} />
      <Text style={{ color: C.text, fontSize: 20, fontWeight: '700', fontFamily: 'serif' }}>
        {screen === 'profile' ? 'Profil LUMAVUN' : 'Pengaturan'}
      </Text>
      <ActionIcon name="info" onPress={() => Alert.alert(
        'LUMAVUN',
        'Aplikasi AI dan Code Agent dengan data utama tersimpan secara lokal. Versi pengembangan pribadi.'
      )} />
    </View>
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 42 }} keyboardShouldPersistTaps="handled">
      {screen === 'profile' ? <>
        <View style={{ alignItems: 'center', paddingVertical: 20, gap: 9 }}>
          <Logo size={88} />
          <Text style={{ color: C.text, fontSize: 21, fontWeight: '700' }}>{profile.name}</Text>
          <Text style={{ color: C.muted, fontSize: 12 }}>Workspace pribadi · Tersimpan di perangkat</Text>
          <Pressable onPress={() => { setName(profile.name); setNameEdit(x => !x); }}
            style={{ backgroundColor: C.raised, paddingHorizontal: 15, paddingVertical: 9, borderRadius: 20 }}>
            <Text style={{ color: C.accent, fontSize: 12 }}>Ubah nama tampilan</Text>
          </Pressable>
        </View>
        {nameEdit && <View style={[style.card, { marginBottom: 16, gap: 10 }]}>
          <Text style={style.label}>NAMA TAMPILAN</Text>
          <TextInput style={style.input} value={name} onChangeText={setName}
            maxLength={32} autoCapitalize="words" placeholder="Nama kamu" placeholderTextColor={C.subtle} />
          <PrimaryButton title="Simpan nama" onPress={saveName} />
        </View>}
        <SectionTitle text="AKUN LOKAL" />
        <Group>
          <Row icon="briefcase" title="Workspace" detail="Pribadi" onPress={onWorkspace}/>
          <Row icon="cpu" title="AI Provider" detail={hasProviderKey ? 'Terhubung' : 'Belum diatur'} onPress={onProvider}/>
          <Row icon="layers" title="Proyek" detail={String(projectsCount)} onPress={onWorkspace}/>
          <Row icon="message-circle" title="Percakapan" detail={String(chatsCount)} last onPress={onBack}/>
        </Group>
        <Group>
          <Row icon="moon" title="Tampilan" detail="Gelap" onPress={() => unavailable('Tema terang')}/>
          <Row icon="droplet" title="Warna aksen" detail="Ungu lunar" onPress={() => unavailable('Palet warna')}/>
          <Row icon="edit-3" title="Ukuran teks chat" detail={profile.largeText ? 'Besar' : 'Normal'}
            onPress={() => onUpdate({ ...profile, largeText: !profile.largeText })} last />
        </Group>
        <Group>
          <Row icon="sliders" title="Personalisasi LUMAVUN" subtitle="Nama, tampilan, dan preferensi lokal"
            onPress={() => onNavigate('settings')} last />
        </Group>
        <Group>
          <Row icon="shield" title="Keamanan & privasi" subtitle="Kunci API disimpan di SecureStore" onPress={() => unavailable('Pengaturan privasi lanjutan')}/>
          <Row icon="info" title="Tentang LUMAVUN" detail="v0.2" onPress={() => Alert.alert('LUMAVUN Agent v0.2', 'Imagine Beyond the Mist. Aplikasi pengembangan AI Chat & Code Agent.')} last/>
        </Group>
      </> : <>
        <SectionTitle text="AKUN" />
        <Group>
          <Row icon="user" title="Profil" subtitle={profile.name} onPress={() => onNavigate('profile')}/>
          <Row icon="cpu" title="Provider AI & API" subtitle={hasProviderKey ? 'Kunci API tersimpan aman' : 'Belum terhubung'} onPress={onProvider} last/>
        </Group>
        <SectionTitle text="KEMAMPUAN & KONTROL" />
        <Group>
          <Row icon="sliders" title="Kemampuan" subtitle="Pilihan tools, memori, dan perilaku agent" onPress={() => onHub('capabilities')}/>
          <Row icon="grid" title="Konektor" subtitle="MCP server dan konektor khusus" onPress={() => onHub('connectors')}/>
          <Row icon="shield" title="Izin" subtitle="Lokasi dan Kalender Android" onPress={() => onHub('permissions')}/>
          <Row icon="activity" title="Penggunaan dan batasan" subtitle="Statistik pemakaian dari perangkat" onPress={() => onHub('usage')}/>
          <Row icon="github" title="Skill" subtitle="Pasang instruksi dari GitHub" onPress={() => onHub('skills')}/>
          <Row icon="cpu" title="AI lokal & model" subtitle="GGUF dan seluruh model provider terdeteksi" onPress={() => onHub('models')} last/>
        </Group>
        <SectionTitle text="TAMPILAN" />
        <Group>
          <Row icon="moon" title="Mode warna" detail="Gelap" onPress={() => unavailable('Mode terang')}/>
          <Row icon="type" title="Gaya teks chat" detail={profile.largeText ? 'Besar' : 'Normal'}
            onPress={() => onUpdate({ ...profile, largeText: !profile.largeText })}/>
          <Row icon="volume-2" title="Suara" subtitle="Voice chat belum didukung" onPress={() => unavailable('Voice chat')} last/>
        </Group>
        <Group>
          <Row icon="smartphone" title="Umpan balik haptik"
            trailing={<Switch value={profile.haptics} onValueChange={toggleHaptics}
              trackColor={{ false: C.raised, true: C.accentDeep }} thumbColor={profile.haptics ? C.accent : '#bbb'} />}/>
          <Row icon="maximize" title="Sembunyikan bilah tab saat chat" subtitle="Navigasi tetap dapat dibuka lewat menu samping"
            trailing={<Switch value={profile.hideTabs} onValueChange={v => onUpdate({ ...profile, hideTabs: v })}
              trackColor={{ false: C.raised, true: C.accentDeep }} thumbColor={profile.hideTabs ? C.accent : '#bbb'} />}/>
          <Row icon="bell" title="Notifikasi" onPress={() => unavailable('Notifikasi')}/>
          <Row icon="clock" title="Waktu & fokus" onPress={() => unavailable('Waktu & fokus')}/>
          <Row icon="lock" title="Privasi" onPress={() => Alert.alert('Privasi', 'Percakapan dan proyek tersimpan di perangkat. Saat meminta respons AI, pesan dan potongan file yang dibaca agent dikirim ke penyedia model yang kamu pilih.')} last/>
        </Group>
        <SectionTitle text="DATA & PENYIMPANAN" />
        <Group>
          <Row icon="hard-drive" title="Data lokal" subtitle={String(chatsCount) + ' chat · ' + String(projectsCount) + ' proyek'} onPress={() => Alert.alert('Penyimpanan lokal', 'Chat disimpan melalui SQLite dan berkas proyek berada di direktori privat aplikasi.')}/>
          <Row icon="trash-2" title="Hapus semua riwayat" onPress={confirmClear} last />
        </Group>
        <Group>
          <Row icon="log-out" title="Putuskan API provider" onPress={confirmDisconnect} last />
        </Group>
      </>}
      <Text style={{ color: C.subtle, fontSize: 11, textAlign: 'center', paddingVertical: 8 }}>
        LUMAVUN · Imagine Beyond the Mist
      </Text>
    </ScrollView>
  </View>;
}
