import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import type { Entry } from '../types';
import { C, Logo, style } from '../ui';

function TextWithCode({ value }: { value: string }) {
  const parts = value.split(/(\x60\x60\x60[\s\S]*?\x60\x60\x60)/g);
  return <View style={{ gap: 8 }}>
    {parts.map((part, i) => {
      if (!part.startsWith('\x60\x60\x60')) {
        return <Text key={i} selectable style={{ color: C.text, fontSize: 15, lineHeight: 23 }}>{part}</Text>;
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

export function ChatView({ entries, mode, onSuggestion, busy }: {
  entries: Entry[]; mode: 'chat' | 'code'; busy: boolean; onSuggestion: (text: string) => void;
}) {
  return <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 28, paddingBottom: 28, flexGrow: 1 }}
    keyboardShouldPersistTaps="handled">
    {entries.length === 0 ? <View style={{ flex: 1, justifyContent: 'center', gap: 18, paddingBottom: 35 }}>
      <View style={{ alignItems: 'center', gap: 16, marginTop: 40 }}>
        <Logo size={62} />
        <Text style={{ color: C.text, fontSize: 26, textAlign: 'center', fontWeight: '700' }}>
          {mode === 'code' ? 'Build something with LUMAVUN' : 'What can I help with?'}
        </Text>
        <Text style={{ color: C.muted, textAlign: 'center', lineHeight: 20, paddingHorizontal: 16 }}>
          {mode === 'code' ? 'Plan, read, create and edit files in your phone workspace.' : 'Ask questions, brainstorm ideas, explain code, and more.'}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 18 }}>
        {(mode === 'code'
          ? ['Create a React component', 'Review my project files', 'Refactor existing code', 'Generate a README']
          : ['Explain a complex topic', 'Help me write code', 'Brainstorm an idea', 'Plan a new project']
        ).map(text => <Pressable key={text} style={{
          borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 14, width: '48%', backgroundColor: C.surface
        }} onPress={() => onSuggestion(text)}>
          <Text style={{ color: C.text, lineHeight: 20, fontSize: 13 }}>{text}</Text>
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
            <TextWithCode value={entry.text} />
          </View>
        </View>;
      })}
    </View>}
    {busy && <Text style={{ color: C.accent, marginTop: 15, fontSize: 13 }}>LUMAVUN is working…</Text>}
  </ScrollView>;
}
