import { useEffect, useState } from 'react';
import {
  ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet,
  Text, TextInput, View
} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { sendChat, syncModels, type Message, type Model } from '../src/api';

const navy = '#101426';
const panel = '#1b2036';
const gold = '#eacb82';
const keyUrl = 'lumavun.api.url';
const keyToken = 'lumavun.api.token';

export default function Home() {
  const [server, setServer] = useState('');
  const [token, setToken] = useState('');
  const [models, setModels] = useState<Model[]>([]);
  const [model, setModel] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('Configure your API server and sync models.');

  useEffect(() => {
    void (async () => {
      const [savedUrl, savedToken] = await Promise.all([
        SecureStore.getItemAsync(keyUrl), SecureStore.getItemAsync(keyToken)
      ]);
      if (savedUrl) setServer(savedUrl);
      if (savedToken) setToken(savedToken);
    })().catch(() => setNotice('Could not load saved settings'));
  }, []);

  async function saveAndSync() {
    if (!/^https?:\/\/\S+$/i.test(server.trim()) || token.length < 24) {
      setNotice('Enter a valid HTTP(S) URL and an access token of at least 24 characters.');
      return;
    }
    setBusy(true);
    setNotice('Synchronizing live provider models...');
    try {
      const url = server.trim().replace(/\/+$/, '');
      await Promise.all([
        SecureStore.setItemAsync(keyUrl, url),
        SecureStore.setItemAsync(keyToken, token)
      ]);
      const data = await syncModels(url, token);
      setModels(data.models);
      const first = data.models[0]?.id || '';
      setModel((previous) => data.models.some((item) => item.id === previous) ? previous : first);
      setNotice(data.models.length + ' model(s) available.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Model sync failed');
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    const content = draft.trim();
    if (!content || !model || busy) return;
    const next: Message[] = [...messages, { role: 'user', content }];
    setMessages(next);
    setDraft('');
    setBusy(true);
    try {
      const result = await sendChat(server, token, model, next.slice(-30));
      setMessages((previous) => [...previous, { role: 'assistant', content: result.reply }]);
      setNotice('Connected to ' + result.model);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Chat request failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.eyebrow}>LUMAVUN • AGENT</Text>
        <Text style={styles.heading}>Imagine Beyond the Mist.</Text>
        <Text style={styles.description}>Private AI workspace • Rebuild v0.1</Text>

        <View style={styles.card}>
          <Text style={styles.label}>Backend URL</Text>
          <TextInput style={styles.input} value={server} onChangeText={setServer}
            placeholder="http://192.168.1.10:3000" placeholderTextColor="#778099"
            autoCapitalize="none" keyboardType="url" />
          <Text style={styles.label}>Personal access token</Text>
          <TextInput style={styles.input} value={token} onChangeText={setToken}
            placeholder="APP_API_TOKEN from backend" placeholderTextColor="#778099"
            secureTextEntry autoCapitalize="none" />
          <Pressable onPress={() => { void saveAndSync(); }} disabled={busy} style={styles.button}>
            <Text style={styles.buttonText}>Save & Sync Models</Text>
          </Pressable>
        </View>

        <Text style={styles.label}>Discovered models</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.modelScroll}>
          {models.map((item) => (
            <Pressable key={item.id} onPress={() => setModel(item.id)}
              style={[styles.modelChip, model === item.id && styles.selectedChip]}>
              <Text style={styles.chipText}>{item.name}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={styles.chatCard}>
          <Text style={styles.label}>Chat</Text>
          {messages.length === 0 && <Text style={styles.description}>No messages yet. Connect a model to begin.</Text>}
          {messages.map((msg, index) => (
            <View key={index} style={[styles.bubble, msg.role === 'user' && styles.userBubble]}>
              <Text style={styles.bubbleRole}>{msg.role.toUpperCase()}</Text>
              <Text style={styles.bubbleText}>{msg.content}</Text>
            </View>
          ))}
          <TextInput style={[styles.input, styles.messageInput]} value={draft}
            onChangeText={setDraft} placeholder="Ask LUMAVUN..." placeholderTextColor="#778099"
            multiline />
          <Pressable onPress={() => { void submit(); }} disabled={busy || !model || !draft.trim()}
            style={[styles.button, (busy || !model || !draft.trim()) && styles.disabled]}>
            <Text style={styles.buttonText}>Send</Text>
          </Pressable>
        </View>
        {busy && <ActivityIndicator color={gold} />}
        <Text style={styles.notice}>{notice}</Text>
        <Text style={styles.footer}>No tools, trading orders, or wallet signing enabled in this build.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: navy },
  content: { paddingHorizontal: 20, paddingTop: 28, paddingBottom: 56, gap: 12 },
  eyebrow: { color: gold, fontSize: 12, letterSpacing: 3, fontWeight: '700' },
  heading: { color: '#f2e8ff', fontSize: 27, fontWeight: '700' },
  description: { color: '#aeb3c7', fontSize: 13, lineHeight: 19 },
  card: { backgroundColor: panel, padding: 16, borderRadius: 18, gap: 9 },
  label: { color: '#d1d3e8', fontSize: 13, fontWeight: '700' },
  input: { color: '#ffffff', backgroundColor: '#11182b', padding: 12,
    borderRadius: 12, borderColor: '#3c4565', borderWidth: 1 },
  button: { backgroundColor: gold, borderRadius: 12, padding: 13, alignItems: 'center' },
  buttonText: { color: '#101426', fontWeight: '800' },
  modelScroll: { maxHeight: 52 },
  modelChip: { backgroundColor: '#30374f', marginRight: 8, borderRadius: 18, padding: 12 },
  selectedChip: { backgroundColor: '#6c4b98' },
  chipText: { color: '#ffffff', fontSize: 12 },
  chatCard: { backgroundColor: panel, borderRadius: 18, padding: 16, gap: 12 },
  bubble: { padding: 12, backgroundColor: '#30374f', borderRadius: 12 },
  userBubble: { backgroundColor: '#34234d' },
  bubbleRole: { color: gold, fontSize: 10, letterSpacing: 1, marginBottom: 4 },
  bubbleText: { color: '#f6f1ff', lineHeight: 20 },
  messageInput: { minHeight: 68, textAlignVertical: 'top' },
  disabled: { opacity: 0.4 },
  notice: { color: '#eacb82', fontSize: 12 },
  footer: { color: '#83879b', fontSize: 11, marginTop: 8 }
});
