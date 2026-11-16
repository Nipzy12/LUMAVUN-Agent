import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import type { Entry } from '../types';
import { fencedCode } from '../artifacts';
import { C, Logo, style } from '../ui';

function TextWithCode({ value, largeText = false }: { value: string; largeText?: boolean }) {
  const parts = value.split(/(\x60\x60\x60[\s\S]*?\x60\x60\x60)/g);
  return <View style={{ gap: 8 }}>
    {parts.map((part, i) => {
      if (!part.startsWith('\x60\x60\x60')) {
        return <Text key={i} selectable style={{ color: C.text, fontSize: largeText ? 18 : 15, lineHeight: largeText ? 28 : 23 }}>{part}</Text>;
      }
      const code = part.replace(/^\x60\x60\x60[^\n]*\n?/, '').replace(/\x60\x60\x60$/, '');
      return <View key={i} style={{ backgroundColor: '#090D18', borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 12 }}>
        <Pressable onPress={() => { void Clipboard.setStringAsync(code); }}
          style={[style.row, { justifyContent: 'flex-end', marginBottom: 7, gap: 7 }]}>
          <Feather name="copy" size={14} color={C.accent} />
          <Text style={{ color: C.accent, fontSize: 12 }}>Copy</Text>
        </Pressable>
        <ScrollView horizontal>
          <Text selectable style={{ color: '#D6DCFF', fontSize: 13, lineHeight: 21, fontFamily: 'monospace' }}>{code}</Text>
        </ScrollView>
      </View>;
    })}
  </View>;
}

export function ChatView({ entries, mode, onSuggestion, busy, name, largeText, onSaveCode }: {
  entries: Entry[]; mode: 'chat' | 'code'; busy: boolean; onSuggestion: (text: string) => void;
  name?: string; largeText?: boolean; onSaveCode?: (entry: Entry) => void;
}) {
  return <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 28, paddingBottom: 28, flexGrow: 1 }}
    keyboardShouldPersistTaps="handled">
    {entries.length === 0 ? <View style={{
      flex: 1, justifyContent: 'center', alignItems: 'center', paddingBottom: 14, gap: 13
    }}>
      <Logo size={90} />
      <Text style={{
        color: C.text, fontSize: 28, textAlign: 'center',
        fontFamily: 'serif', marginTop: 3, fontWeight: '600'
      }}>
        {mode === 'code' ? 'Apa yang mau kamu bangun?' : (name && name !== 'Pengguna' ? 'Halo, ' + name + '.' : 'Selamat datang di LUMAVUN')}
      </Text>
      <Text style={{ color: C.muted, textAlign: 'center', fontSize: 13, lineHeight: 20, maxWidth: 290 }}>
        {mode === 'code'
          ? 'Code Agent siap membaca dan mengubah file proyek dengan persetujuanmu.'
          : 'Imagine Beyond the Mist. Mulai dari satu pertanyaan.'}
      </Text>
      <View style={{
        flexDirection: 'row', flexWrap: 'wrap', gap: 9,
        marginTop: 23, justifyContent: 'center', maxWidth: 355
      }}>
        {(mode === 'code'
          ? ['Buat aplikasi Android', 'Periksa kode proyek', 'Buat komponen React', 'Susun struktur proyek']
          : ['Bantu buat aplikasi', 'Jelaskan topik sulit', 'Cari ide kreatif', 'Tulis dan perbaiki kode']
        ).map(text => <Pressable key={text}
          accessibilityRole="button"
          style={{
            borderWidth: 1, borderColor: C.border, borderRadius: 17,
            paddingHorizontal: 12, paddingVertical: 13, width: '47%',
            backgroundColor: C.surface, minHeight: 60, justifyContent: 'center'
          }}
          onPress={() => onSuggestion(text)}>
          <Text style={{ color: C.text, fontSize: 12.5, lineHeight: 19, textAlign: 'center' }}>{text}</Text>
        </Pressable>)}
      </View>
    </View> : <View style={{ gap: 19 }}>
      {entries.map(entry => {
        if (entry.role === 'tool') return <View key={entry.id} style={{
          backgroundColor: C.surface, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12,
          flexDirection: 'row', alignItems: 'center', gap: 8
        }}>
          <Feather name="terminal" size={14} color={C.gold} />
          <Text style={{ color: C.muted, fontSize: 12, flex: 1 }} numberOfLines={3}>{entry.text}</Text>
        </View>;
        const user = entry.role === 'user';
        return <View key={entry.id} style={{
          alignSelf: user ? 'flex-end' : 'stretch', maxWidth: user ? '88%' : '100%',
          flexDirection: 'row', gap: 11
        }}>
          {!user && <Logo size={29} />}
          <View style={[user && { backgroundColor: C.raised, borderRadius: 19, padding: 13 }, { flexShrink: 1 }]}>
            <TextWithCode value={entry.text} largeText={largeText} />
            {!user && fencedCode(entry.text) && onSaveCode && <Pressable
              onPress={() => onSaveCode(entry)}
              style={[style.row, { gap: 7, paddingVertical: 10, marginTop: 5 }]}>
              <Feather name="save" color={C.accent} size={14} />
              <Text style={{ color: C.accent, fontSize: 12 }}>Simpan kode sebagai artefak</Text>
            </Pressable>}
          </View>
        </View>;
      })}
    </View>}
    {busy && <Text style={{ color: C.accent, marginTop: 15, fontSize: 13 }}>LUMAVUN sedang bekerja…</Text>}
  </ScrollView>;
}
