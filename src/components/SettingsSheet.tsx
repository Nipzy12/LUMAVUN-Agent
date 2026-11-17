import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import type { ModelInfo, Settings, ProviderKind } from '../types';
import { PRESETS, fetchModels } from '../provider';
import { C, PrimaryButton, Sheet, style } from '../ui';

const PROVIDERS: Array<{ id: ProviderKind; label: string }> = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'openrouter', label: 'OpenRouter' },
  { id: 'cloudflare', label: 'Cloudflare Workers AI' },
  { id: 'custom', label: 'Custom API' }
];

export function SettingsSheet({ open, onClose, settings, apiKey, onSave, onModels }: {
  open: boolean; onClose: () => void; settings: Settings; apiKey: string;
  onSave: (settings: Settings, key: string) => Promise<void>;
  onModels: (models: ModelInfo[]) => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [key, setKey] = useState(apiKey);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setDraft(settings);
      setKey(apiKey);
      setStatus('');
    }
  }, [open, settings, apiKey]);

  async function save(sync: boolean) {
    setBusy(true);
    try {
      await onSave(draft, key);
      setStatus('Settings saved locally.');
      if (sync) {
        setStatus('Fetching model catalogue...');
        const models = await fetchModels(draft, key);
        onModels(models);
        setStatus(models.length + ' models synchronized.');
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Failed to save provider settings');
    } finally { setBusy(false); }
  }

  return <Sheet open={open} onClose={onClose} title="Settings">
    <Text style={style.label}>AI PROVIDER</Text>
    <View style={[style.row, { gap: 7, flexWrap: 'wrap' }]}>
      {PROVIDERS.map(p => <Pressable key={p.id} onPress={() => setDraft(s => ({
          ...s, provider: p.id, baseUrl: p.id === 'custom' ? s.baseUrl : PRESETS[p.id],
          model:p.id==='cloudflare'?'@cf/openai/gpt-oss-120b':(p.id===s.provider?s.model:'')
        }))}
        style={[style.pill, draft.provider === p.id && { backgroundColor: C.accentDeep }]}>
        <Text style={style.txt}>{p.label}</Text>
      </Pressable>)}
    </View>
    {draft.provider==='cloudflare'&&<>
      <Text style={style.label}>CLOUDFLARE ACCOUNT ID</Text>
      <TextInput style={style.input} autoCapitalize="none" autoCorrect={false}
        placeholder="Account ID Cloudflare"
        placeholderTextColor={C.subtle}
        value={draft.baseUrl.match(/\/accounts\/([^/]+)\/ai\/v1/)?.[1]?.replace('ACCOUNT_ID','')||''}
        onChangeText={v=>setDraft(prev=>({...prev,
          baseUrl:'https://api.cloudflare.com/client/v4/accounts/'+v.trim()+'/ai/v1'}))}/>
      <Text style={style.subtitle}>GPT-OSS 120B tersedia sebagai model cloud, tidak diunduh ke Android. Dibutuhkan token Cloudflare dengan izin Workers AI.</Text>
    </>}
    <Text style={style.label}>BASE URL (OPENAI-COMPATIBLE)</Text>
    <TextInput style={style.input} value={draft.baseUrl}
      onChangeText={v => setDraft(s => ({ ...s, baseUrl: v }))}
      placeholder="https://api.example.com/v1" placeholderTextColor={C.subtle}
      autoCapitalize="none" keyboardType="url" autoCorrect={false} />
    <Text style={style.label}>API KEY • STORED IN ANDROID KEYSTORE</Text>
    <TextInput style={style.input} value={key} onChangeText={setKey}
      secureTextEntry autoCapitalize="none" autoCorrect={false}
      placeholder="sk-... / provider token" placeholderTextColor={C.subtle} />
    <Text style={style.label}>DEFAULT MODEL ID</Text>
    <TextInput style={style.input} value={draft.model}
      onChangeText={v => setDraft(s => ({ ...s, model: v }))}
      placeholder="Use Sync to pick a model" placeholderTextColor={C.subtle}
      autoCapitalize="none" autoCorrect={false} />
    <Text style={style.label}>TEMPERATURE: {draft.temperature.toFixed(1)}</Text>
    <View style={[style.row, { gap: 8 }]}>
      {[0, .3, .7, 1].map(v =>
        <Pressable key={v} onPress={() => setDraft(s => ({ ...s, temperature: v }))}
          style={[style.pill, { flex: 1, alignItems: 'center' }, draft.temperature === v && { backgroundColor: C.accentDeep }]}>
          <Text style={style.txt}>{v.toFixed(1)}</Text>
        </Pressable>)}
    </View>
    <PrimaryButton title={busy ? 'Working…' : 'Save & sync models'} disabled={busy}
      onPress={() => { void save(true); }} />
    <PrimaryButton title="Save without syncing" kind="outline" disabled={busy}
      onPress={() => { void save(false); }} />
    {busy && <ActivityIndicator color={C.accent} />}
    {!!status && <Text style={{ color: C.gold, fontSize: 13 }}>{status}</Text>}
    <Text style={style.subtitle}>
      Your API key stays in device SecureStore. API requests are made directly from this app to your chosen provider.
      Code agent files remain in the app sandbox. Provider API usage may incur charges.
    </Text>
  </Sheet>;
}
