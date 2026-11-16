import type { ReactNode } from 'react';
import React from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

export const C = {
  bg: '#0D1020',
  surface: '#171C2D',
  raised: '#20273A',
  border: '#30374D',
  text: '#F4F4FB',
  muted: '#A0A7BD',
  subtle: '#737E98',
  accent: '#BAA6FF',
  accentDeep: '#6850A4',
  gold: '#F0D99D',
  danger: '#FF9F9F',
  success: '#A4E5BB'
};
export const style = StyleSheet.create({
  fill: { flex: 1 },
  txt: { color: C.text },
  muted: { color: C.muted },
  subtitle: { color: C.muted, fontSize: 13 },
  label: { color: C.muted, fontSize: 12, fontWeight: '700', letterSpacing: .5 },
  heading: { color: C.text, fontSize: 25, fontWeight: '700' },
  input: { backgroundColor: C.raised, borderWidth: 1, borderColor: C.border, borderRadius: 13, paddingVertical: 12, paddingHorizontal: 14, color: C.text, fontSize: 15 },
  card: { backgroundColor: C.surface, borderRadius: 18, padding: 16 },
  button: { backgroundColor: C.accent, paddingVertical: 13, paddingHorizontal: 16, borderRadius: 13, alignItems: 'center' },
  buttonTxt: { color: C.bg, fontWeight: '800', fontSize: 14 },
  row: { flexDirection: 'row', alignItems: 'center' },
  pill: { backgroundColor: C.raised, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 20 },
  divider: { height: 1, backgroundColor: C.border, marginVertical: 8 }
});

export function ActionIcon({ name, onPress, size = 21, color = C.text, disabled = false }: {
  name: keyof typeof Feather.glyphMap; onPress: () => void; size?: number; color?: string; disabled?: boolean
}) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}
    style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center', opacity: disabled ? .35 : 1 }}>
    <Feather name={name} size={size} color={color} />
  </Pressable>;
}

export function Sheet({ open, onClose, children, title }: {
  open: boolean; onClose: () => void; children: ReactNode; title: string
}) {
  return <Modal visible={open} onRequestClose={onClose} animationType="slide" transparent>
    <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#050510B8' }}>
      <Pressable style={{ flex: 1 }} onPress={onClose} />
      <View style={{ backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
        paddingTop: 15, paddingHorizontal: 18, paddingBottom: 28, maxHeight: '90%', minHeight: 230 }}>
        <View style={[style.row, { justifyContent: 'space-between', marginBottom: 12 }]}>
          <Text style={{ color: C.text, fontSize: 19, fontWeight: '700' }}>{title}</Text>
          <ActionIcon name="x" onPress={onClose} />
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 25, gap: 12 }}>
          {children}
        </ScrollView>
      </View>
    </View>
  </Modal>;
}

export function PrimaryButton({ title, onPress, disabled = false, kind = 'primary' }: {
  title: string; onPress: () => void; disabled?: boolean; kind?: 'primary' | 'outline'
}) {
  return <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button"
    style={[style.button, kind === 'outline' && { backgroundColor: C.raised, borderColor: C.border, borderWidth: 1 }, disabled && { opacity: .42 }]}>
    <Text style={[style.buttonTxt, kind === 'outline' && { color: C.text }]}>{title}</Text>
  </Pressable>;
}

export function Logo({ size = 36 }: { size?: number }) {
  return <Image
    source={require('../assets/icon.png')}
    accessibilityLabel="LUMAVUN: bulan sabit, satu bintang dan kabut"
    resizeMode="contain"
    style={{ width: size, height: size, borderRadius: size / 4 }}
  />;
}
