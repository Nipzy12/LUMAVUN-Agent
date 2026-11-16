import React, { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type { ModelInfo } from '../types';
import { C, Sheet, style } from '../ui';

export function ModelSheet({ open, onClose, current, models, onPick }: {
  open: boolean; onClose: () => void; current: string; models: ModelInfo[];
  onPick: (model: string) => void;
}) {
  const [search, setSearch] = useState('');
  const visible = models.filter(m => (m.id + m.name).toLowerCase().includes(search.toLowerCase())).slice(0, 100);
  return <Sheet open={open} onClose={onClose} title="Choose model">
    <TextInput value={search} onChangeText={setSearch} style={style.input}
      placeholder="Search synced models" placeholderTextColor={C.subtle} />
    {models.length === 0 && <Text style={style.subtitle}>No models synced. Open Settings to connect a provider.</Text>}
    {visible.map(m => <Pressable key={m.id} style={[style.card, { paddingVertical: 13,
      borderWidth: current === m.id ? 1 : 0, borderColor: C.accent }]}
      onPress={() => { onPick(m.id); onClose(); }}>
      <Text style={[style.txt, { fontWeight: '700' }]} numberOfLines={2}>{m.name}</Text>
      {m.id !== m.name && <Text style={[style.subtitle, { marginTop: 3 }]}>{m.id}</Text>}
    </Pressable>)}
  </Sheet>;
}
