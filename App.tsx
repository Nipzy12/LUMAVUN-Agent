import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform,
  Pressable, ScrollView, StatusBar, Text, TextInput, Vibration, View
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { runCodeAgent } from './src/agent';
import { ChatView } from './src/components/ChatView';
import { AccountScreen } from './src/components/AccountScreen';
import { ModelSheet } from './src/components/ModelSheet';
import { SettingsSheet } from './src/components/SettingsSheet';
import { WorkspaceSheet } from './src/components/WorkspaceSheet';
import { id } from './src/paths';
import { createCompletion, fetchModels, type APIMessage } from './src/provider';
import { CHAT_SYSTEM } from './src/prompts';
import { INITIAL_STATE, loadSecret, loadState, saveSecret, saveState, type LocalState } from './src/store';
import type { Approval, Conversation, Entry, ModelInfo, Project, Settings } from './src/types';
import { ActionIcon, C, Logo, PrimaryButton, style } from './src/ui';
import { createWorkspaceTools } from './src/workspace';

function newEntry(role: Entry['role'], text: string): Entry {
  return { id: id('msg'), role, text, createdAt: Date.now() };
}
function newConversation(mode: 'chat' | 'code', model: string): Conversation {
  const now = Date.now();
  return { id: id('chat'), title: 'New chat', mode, model, createdAt: now, updatedAt: now, entries: [] };
}

export default function App() {
  return <SafeAreaProvider><Main /></SafeAreaProvider>;
}

function Main() {
  const [state, setState] = useState<LocalState>(INITIAL_STATE);
  const [ready, setReady] = useState(false);
  const [key, setKey] = useState('');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [draft, setDraft] = useState('');
  const [modeDraft, setModeDraft] = useState<'chat' | 'code'>('chat');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarSearch, setSidebarSearch] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [accountPage, setAccountPage] = useState<'settings' | 'profile' | null>(null);
  const [profileFromSettings, setProfileFromSettings] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [approval, setApproval] = useState<Approval | null>(null);
  const approvalResolve = useRef<((approved: boolean) => void) | null>(null);
  const requestAbort = useRef<AbortController | null>(null);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    void Promise.all([loadState(), loadSecret()])
      .then(([loaded, secret]) => {
        setState(loaded); setKey(secret);
        if (secret && loaded.settings.model) {
          void fetchModels(loaded.settings, secret).then(setModels).catch(() => {});
        }
      })
      .catch(error => { setNotice(error instanceof Error ? error.message : 'Failed to restore local state'); })
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!ready) return;
    saveQueue.current = saveQueue.current
      .catch(() => {})
      .then(() => saveState(state))
      .catch(() => { setNotice('Warning: could not save conversation history.'); });
  }, [state, ready]);

  const current = state.chats.find(c => c.id === state.selectedChatId);
  const mode = current?.mode || modeDraft;
  const activeProject = state.projects.find(p => p.id === state.selectedProjectId);

  function addEntry(chatId: string, role: Entry['role'], text: string) {
    setState(previous => ({
      ...previous,
      chats: previous.chats.map(chat => chat.id === chatId ? {
        ...chat,
        entries: [...chat.entries, newEntry(role, text)],
        updatedAt: Date.now()
      } : chat)
    }));
  }
  function startNewChat(nextMode: 'chat' | 'code' = mode) {
    if (busy) { setNotice('Stop the running response before switching chat.'); return; }
    const next = newConversation(nextMode, state.settings.model);
    setState(s => ({ ...s, chats: [next, ...s.chats], selectedChatId: next.id }));
    setModeDraft(nextMode);
    setDraft('');
    setSidebarOpen(false);
  }
  function setConversationMode(next: 'chat' | 'code') {
    setModeDraft(next);
    if (current) {
      setState(s => ({
        ...s,
        chats: s.chats.map(c => c.id === current.id ? { ...c, mode: next } : c)
      }));
    }
    if (next === 'code' && !state.selectedProjectId) setWorkspaceOpen(true);
  }
  function handlePickModel(model: string) {
    setState(s => ({
      ...s, settings: { ...s.settings, model },
      chats: s.chats.map(c => c.id === s.selectedChatId ? { ...c, model } : c)
    }));
    setNotice('Model: ' + model);
  }
  async function handleSaveSettings(settings: Settings, secret: string) {
    await saveSecret(secret);
    setKey(secret);
    setState(s => ({ ...s, settings }));
  }
  function handleModels(items: ModelInfo[]) {
    setModels(items);
    setState(s => ({
      ...s,
      settings: {
        ...s.settings,
        model: items.some(m => m.id === s.settings.model)
          ? s.settings.model : items[0]?.id || s.settings.model
      }
    }));
  }
  function handleProject(project: Project) {
    setState(s => ({
      ...s,
      projects: [...s.projects, project],
      selectedProjectId: project.id
    }));
  }
  function finishApproval(answer: boolean) {
    approvalResolve.current?.(answer);
    approvalResolve.current = null;
    setApproval(null);
  }
  function stop() {
    requestAbort.current?.abort();
    if (approvalResolve.current) finishApproval(false);
    setNotice('Stopping current request…');
  }
  async function sendMessage() {
    const content = draft.trim();
    if (!content || busy) return;
    if (!state.settings.model || !key) {
      setNotice('Set your API key and choose a model first.');
      setSettingsOpen(true);
      return;
    }
    if (mode === 'code' && !state.selectedProjectId) {
      setNotice('Create or choose a Code Workspace first.');
      setWorkspaceOpen(true);
      return;
    }

    const target = current || newConversation(mode, state.settings.model);
    const nextEntries = [...target.entries, newEntry('user', content)];
    const chatId = target.id;
    setState(previous => {
      const existing = previous.chats.some(c => c.id === chatId);
      const updated: Conversation = {
        ...target, entries: nextEntries,
        title: target.entries.length === 0 ? content.slice(0, 58) : target.title,
        updatedAt: Date.now()
      };
      return {
        ...previous,
        chats: existing ? previous.chats.map(c => c.id === chatId ? updated : c) : [updated, ...previous.chats],
        selectedChatId: chatId
      };
    });
    setDraft('');
    if (state.profile.haptics) Vibration.vibrate(10);
    setBusy(true);
    setNotice('');
    const controller = new AbortController();
    requestAbort.current = controller;
    const messages: APIMessage[] = nextEntries
      .filter(e => e.role === 'user' || e.role === 'assistant')
      .slice(-20)
      .map(e => ({ role: e.role as 'user' | 'assistant', content: e.text }));

    try {
      if (mode === 'code') {
        const projectId = state.selectedProjectId;
        await runCodeAgent(messages, {
          workspace: createWorkspaceTools(projectId),
          signal: controller.signal,
          complete: (history, tools, signal) =>
            createCompletion(state.settings, key, history, { tools, signal }),
          event: event => addEntry(chatId, event.type === 'tool' ? 'tool' : 'assistant', event.text),
          approve: action => new Promise(resolve => {
            if (controller.signal.aborted) { resolve(false); return; }
            approvalResolve.current = resolve;
            setApproval(action);
          })
        });
      } else {
        const result = await createCompletion(state.settings, key,
          [{ role: 'system', content: CHAT_SYSTEM }, ...messages], { signal: controller.signal });
        addEntry(chatId, 'assistant', result.content);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown provider error';
      if (controller.signal.aborted) setNotice('Response stopped.');
      else {
        setNotice(reason);
        addEntry(chatId, 'tool', 'Request failed: ' + reason);
      }
    } finally {
      if (requestAbort.current === controller) requestAbort.current = null;
      if (approvalResolve.current) finishApproval(false);
      setBusy(false);
    }
  }

  function clearAllChats() {
    if (busy) { setNotice('Hentikan respons yang aktif terlebih dahulu.'); return; }
    setState(previous => ({ ...previous, chats: [], selectedChatId: null }));
    setAccountPage(null);
    setNotice('Riwayat chat lokal sudah dihapus.');
  }

  function disconnectProvider() {
    if (busy) { setNotice('Hentikan respons yang aktif terlebih dahulu.'); return; }
    void saveSecret('').then(() => {
      setKey('');
      setModels([]);
      setState(previous => ({
        ...previous,
        settings: { ...previous.settings, model: '' }
      }));
      setAccountPage(null);
      setNotice('Kunci API dihapus dari penyimpanan aman.');
    }).catch(() => setNotice('Gagal menghapus kunci API.'));
  }

  function openAccount(screen: 'settings' | 'profile', fromSettings = false) {
    if (busy) { setNotice('Hentikan respons aktif sebelum membuka pengaturan.'); return; }
    setSidebarOpen(false);
    setProfileFromSettings(fromSettings);
    setAccountPage(screen);
  }

  function confirmDeleteConversation(chat: Conversation) {
    Alert.alert('Delete conversation?', chat.title, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => {
        setState(s => ({
          ...s, chats: s.chats.filter(x => x.id !== chat.id),
          selectedChatId: s.selectedChatId === chat.id ? null : s.selectedChatId
        }));
      }}
    ]);
  }

  if (!ready) return <SafeAreaView style={{ flex: 1, backgroundColor: C.bg, justifyContent: 'center' }}>
    <ActivityIndicator color={C.accent} size="large" />
  </SafeAreaView>;

  return <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top', 'bottom']}>
    <StatusBar barStyle="light-content" />
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>

      {!accountPage ? <>
      <View style={[style.row, {
        height: 58, paddingHorizontal: 12
      }]}>
        <ActionIcon name="menu" onPress={() => setSidebarOpen(true)} size={23} />
        <Pressable style={[style.row, { flex: 1, justifyContent: 'center', gap: 7 }]}
          onPress={() => setModelsOpen(true)}>
          <Text style={{ color: C.text, fontWeight: '700', fontSize: 17, letterSpacing: .6 }}>LUMAVUN</Text>
          <Feather name="chevron-down" size={14} color={C.muted} />
        </Pressable>
        <ActionIcon name="edit" onPress={() => startNewChat()} size={21} />
      </View>
      <ChatView entries={current?.entries || []} busy={busy} mode={mode}
        name={state.profile.name} largeText={state.profile.largeText} onSuggestion={setDraft} />

      {!!notice && <Pressable onPress={() => setNotice('')}
        style={{ paddingHorizontal: 16, paddingVertical: 7, backgroundColor: C.surface }}>
        <Text style={{ color: C.gold, fontSize: 12 }} numberOfLines={3}>{notice}  ×</Text>
      </Pressable>}


      <View style={{
        backgroundColor: C.bg, paddingHorizontal: 13, paddingTop: 8, paddingBottom: 8
      }}>
        <View style={{
          backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
          borderRadius: 24, paddingHorizontal: 9, paddingTop: 5, paddingBottom: 7
        }}>
          <TextInput value={draft} onChangeText={setDraft}
            accessibilityLabel="Pesan untuk LUMAVUN"
            placeholder={mode === 'code' ? 'Tulis instruksi Code Agent…' : 'Chat dengan LUMAVUN…'}
            placeholderTextColor={C.subtle} multiline maxLength={12000} editable={!busy}
            style={{
              color: C.text, fontSize: state.profile.largeText ? 18 : 16,
              paddingHorizontal: 10, paddingVertical: 12, maxHeight: 128, minHeight: 54
            }} textAlignVertical="top" />
          <View style={[style.row, { gap: 4 }]}>
            <ActionIcon name="plus" color={C.muted} onPress={() => setWorkspaceOpen(true)} size={21} />
            <Pressable onPress={() => setModelsOpen(true)} style={[style.row, {
              borderRadius: 19, backgroundColor: C.raised,
              paddingHorizontal: 13, paddingVertical: 10, gap: 6,
              maxWidth: 208
            }]}>
              <Feather name="cpu" size={13} color={C.accent} />
              <Text style={{ color: C.text, fontSize: 12, fontWeight: '600', flexShrink: 1 }}
                numberOfLines={1}>
                {state.settings.model ? state.settings.model.split('/').pop() : 'Pilih model'}
              </Text>
              <Feather name="chevron-down" size={12} color={C.muted} />
            </Pressable>
            <View style={{ flex: 1 }} />
            <ActionIcon name="mic" color={C.subtle} size={19}
              onPress={() => Alert.alert('Suara', 'Voice chat belum tersedia di versi ini.')} />
            <Pressable accessibilityRole="button" accessibilityLabel={busy ? 'Hentikan respons' : 'Kirim pesan'}
              onPress={busy ? stop : () => { void sendMessage(); }} disabled={!busy && !draft.trim()}
              style={{
                backgroundColor: busy ? C.raised : C.accent,
                opacity: busy || draft.trim() ? 1 : .4,
                height: 39, width: 39, borderRadius: 20, alignItems: 'center', justifyContent: 'center'
              }}>
              <Feather name={busy ? 'square' : 'arrow-up'} size={18} color={busy ? C.text : C.bg} />
            </Pressable>
          </View>
        </View>
      </View>
      {!state.profile.hideTabs && <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
        backgroundColor: C.surface, borderRadius: 26, marginHorizontal: 13, marginBottom: 8,
        padding: 4, borderWidth: 1, borderColor: C.border
      }}>
        {([
          { id: 'chat', icon: 'message-circle', label: 'Chat' },
          { id: 'project', icon: 'folder', label: 'Proyek' },
          { id: 'code', icon: 'code', label: 'Code' },
          { id: 'artifact', icon: 'layers', label: 'Artefak' }
        ] as const).map(item => {
          const active = (item.id === 'code' && mode === 'code') ||
            (item.id === 'chat' && mode === 'chat');
          return <Pressable key={item.id} accessibilityRole="tab" accessibilityState={{ selected: active }}
            onPress={() => {
              if (item.id === 'chat') setConversationMode('chat');
              if (item.id === 'code') setConversationMode('code');
              if (item.id === 'project') setWorkspaceOpen(true);
              if (item.id === 'artifact') {
                Alert.alert('Artefak', 'Artefak interaktif belum tersedia. File kode hasil agent dapat dilihat melalui menu Proyek.');
              }
            }}
            style={{
              flex: 1, alignItems: 'center', justifyContent: 'center',
              paddingVertical: 10, borderRadius: 22,
              backgroundColor: active ? C.accentDeep : 'transparent', gap: 5
            }}>
            <Feather name={item.icon} size={20} color={active ? C.text : C.muted} />
            <Text style={{ color: active ? C.text : C.muted, fontSize: 11, fontWeight: active ? '700' : '500' }}>
              {item.label}
            </Text>
          </Pressable>;
        })}
      </View>}
      </> : <AccountScreen
        screen={accountPage}
        profile={state.profile}
        chatsCount={state.chats.length}
        projectsCount={state.projects.length}
        hasProviderKey={!!key}
        onBack={() => {
          if (accountPage === 'profile' && profileFromSettings) {
            setAccountPage('settings');
            setProfileFromSettings(false);
          } else {
            setAccountPage(null);
          }
        }}
        onNavigate={next => {
          setProfileFromSettings(accountPage === 'settings' && next === 'profile');
          setAccountPage(next);
        }}
        onUpdate={profile => setState(prev => ({ ...prev, profile }))}
        onProvider={() => setSettingsOpen(true)}
        onModels={() => setModelsOpen(true)}
        onWorkspace={() => setWorkspaceOpen(true)}
        onClearChats={clearAllChats}
        onDisconnectProvider={disconnectProvider}
      />}
    </KeyboardAvoidingView>


    <Modal visible={sidebarOpen} animationType="fade" transparent
      statusBarTranslucent onRequestClose={() => setSidebarOpen(false)}>
      <View style={{ flex: 1, flexDirection: 'row', backgroundColor: '#060608B8' }}>
        <View style={{
          width: '86%', maxWidth: 370, backgroundColor: C.bg,
          paddingTop: 47, paddingHorizontal: 18, paddingBottom: 18
        }}>
          <View style={[style.row, { gap: 9, marginBottom: 23 }]}>
            <Logo size={38} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: C.text, fontSize: 24, fontFamily: 'serif', fontWeight: '700' }}>LUMAVUN</Text>
              <Text style={{ color: C.muted, fontSize: 11 }}>Imagine Beyond the Mist</Text>
            </View>
            <ActionIcon name="search" onPress={() => {
              setSidebarSearch(''); 
              Alert.alert('Cari chat', 'Masukkan kata kunci pada kotak pencarian di bawah daftar menu.');
            }} />
          </View>
          <Pressable onPress={() => startNewChat()} style={[style.row, {
            gap: 12, paddingHorizontal: 14, paddingVertical: 13,
            borderRadius: 16, backgroundColor: C.raised, marginBottom: 9
          }]}>
            <Feather name="edit" color={C.accent} size={20} />
            <Text style={{ color: C.text, fontWeight: '700', fontSize: 15 }}>Chat baru</Text>
          </Pressable>
          {([
            { label: 'Chat', icon: 'message-circle', press: () => { setSidebarOpen(false); setAccountPage(null); } },
            { label: 'Proyek', icon: 'folder', press: () => { setSidebarOpen(false); setWorkspaceOpen(true); } },
            { label: 'Code Agent', icon: 'code', press: () => { setSidebarOpen(false); setConversationMode('code'); } },
            { label: 'Artefak', icon: 'layers', press: () => Alert.alert('Artefak', 'Fitur artefak interaktif belum tersedia; gunakan proyek untuk file kode.') },
            { label: 'Pengaturan', icon: 'settings', press: () => openAccount('settings') }
          ] as const).map(item => (
            <Pressable key={item.label} style={[style.row, { gap: 15, paddingHorizontal: 12, paddingVertical: 12 }]}
              onPress={item.press}>
              <Feather name={item.icon} size={19} color={C.muted} />
              <Text style={{ color: C.text, fontSize: 15 }}>{item.label}</Text>
            </Pressable>
          ))}
          <View style={style.divider} />
          <TextInput style={[style.input, { marginVertical: 8, paddingVertical: 9 }]}
            value={sidebarSearch} onChangeText={setSidebarSearch}
            placeholder="Cari riwayat chat…" placeholderTextColor={C.subtle} />
          <Text style={[style.label, { paddingHorizontal: 11, marginTop: 14, marginBottom: 9 }]}>
            TERBARU
          </Text>
          <ScrollView style={{ flex: 1 }}>
            {state.chats.length === 0 && <Text style={[style.subtitle, { padding: 13 }]}>
              Riwayat chat akan muncul di sini.
            </Text>}
            {state.chats.filter(c => c.title.toLowerCase().includes(sidebarSearch.toLowerCase()))
              .sort((a, b) => b.updatedAt - a.updatedAt).map(chat =>
              <View key={chat.id} style={[style.row, {
                paddingVertical: 3, borderRadius: 12,
                backgroundColor: chat.id === state.selectedChatId ? C.raised : 'transparent'
              }]}>
                <Pressable onPress={() => {
                  if (busy) { setNotice('Hentikan respons yang sedang aktif.'); return; }
                  setState(prev => ({ ...prev, selectedChatId: chat.id }));
                  setModeDraft(chat.mode); setSidebarOpen(false);
                }} style={[style.row, { gap: 11, flex: 1, paddingVertical: 11, paddingHorizontal: 8 }]}>
                  <Feather name={chat.mode === 'code' ? 'code' : 'message-square'} color={C.muted} size={17} />
                  <Text numberOfLines={1} style={{ color: C.text, flex: 1, fontSize: 13.5 }}>{chat.title}</Text>
                </Pressable>
                <ActionIcon name="trash-2" size={15} color={C.subtle}
                  onPress={() => confirmDeleteConversation(chat)} />
              </View>)}
          </ScrollView>
          <View style={style.divider} />
          <Pressable accessibilityRole="button" onPress={() => openAccount('profile')}
            style={[style.row, {
              paddingVertical: 14, paddingHorizontal: 10, gap: 10,
              backgroundColor: C.surface, borderRadius: 17
            }]}>
            <Logo size={43} />
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={{ color: C.text, fontWeight: '700', fontSize: 15 }} numberOfLines={1}>
                {state.profile.name}
              </Text>
              <Text style={{ color: C.muted, fontSize: 12 }}>Profil dan pengaturan</Text>
            </View>
            <Feather name="chevron-right" color={C.muted} size={20} />
          </Pressable>
        </View>
        <Pressable style={{ flex: 1 }} onPress={() => setSidebarOpen(false)} />
      </View>
    </Modal>

    <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)}
      settings={state.settings} apiKey={key} onSave={handleSaveSettings} onModels={handleModels} />
    <ModelSheet open={modelsOpen} onClose={() => setModelsOpen(false)}
      current={state.settings.model} models={models} onPick={handlePickModel} />
    <WorkspaceSheet open={workspaceOpen} onClose={() => setWorkspaceOpen(false)}
      projects={state.projects} activeId={state.selectedProjectId}
      onCreate={handleProject} onSelect={projectId => setState(s => ({ ...s, selectedProjectId: projectId }))} />

    <Modal visible={!!approval} transparent animationType="fade" onRequestClose={() => finishApproval(false)}>
      <View style={{ flex: 1, padding: 17, backgroundColor: '#02030BCC', justifyContent: 'center' }}>
        <View style={{ backgroundColor: C.surface, borderRadius: 22, padding: 18, maxHeight: '85%', gap: 13 }}>
          <View style={[style.row, { gap: 9 }]}>
            <Feather name="shield" color={C.gold} size={24} />
            <Text style={{ color: C.text, fontSize: 19, fontWeight: '800', flex: 1 }}>Approve code change?</Text>
          </View>
          <Text style={style.subtitle}>{approval?.description}</Text>
          <Text style={[style.txt, { fontWeight: '700' }]}>{approval?.path}</Text>
          <ScrollView style={{ backgroundColor: '#0B0F1D', borderRadius: 12, padding: 12, maxHeight: 380 }}>
            <Text selectable style={{ color: '#D4DAFF', fontSize: 12, lineHeight: 18, fontFamily: 'monospace' }}>
              {approval?.proposed}
            </Text>
          </ScrollView>
          <PrimaryButton kind="outline" title="Deny (no changes)" onPress={() => finishApproval(false)} />
          <PrimaryButton title="Approve this change" onPress={() => finishApproval(true)} />
          <Text style={{ color: C.muted, fontSize: 11 }}>Only this individual tool call is approved.</Text>
        </View>
      </View>
    </Modal>
  </SafeAreaView>;
}
