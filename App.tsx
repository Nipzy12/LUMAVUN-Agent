import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform,
  Pressable, ScrollView, StatusBar, Text, TextInput, View
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { runCodeAgent } from './src/agent';
import { ChatView } from './src/components/ChatView';
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
    <StatusBar barStyle="light-content" backgroundColor={C.bg} />
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <View style={[style.row, {
        height: 62, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: C.border
      }]}>
        <ActionIcon name="menu" onPress={() => setSidebarOpen(true)} />
        <Pressable style={[style.row, { flex: 1, gap: 8, paddingHorizontal: 5 }]} onPress={() => setModelsOpen(true)}>
          <Logo size={31} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: C.text, fontWeight: '800', fontSize: 17, letterSpacing: 0.4 }}>LUMAVUN</Text>
            <Text style={{ color: C.muted, fontSize: 11 }} numberOfLines={1}>
              {state.settings.model || 'Select AI model'} <Feather name="chevron-down" size={10} />
            </Text>
          </View>
        </Pressable>
        <ActionIcon name="folder" onPress={() => setWorkspaceOpen(true)} />
        <ActionIcon name="edit" onPress={() => startNewChat()} />
      </View>

      <ChatView entries={current?.entries || []} busy={busy} mode={mode} onSuggestion={setDraft} />

      {!!notice && <Pressable onPress={() => setNotice('')}
        style={{ paddingHorizontal: 16, paddingVertical: 7, backgroundColor: C.surface }}>
        <Text style={{ color: C.gold, fontSize: 12 }} numberOfLines={3}>{notice}  ×</Text>
      </Pressable>}

      <View style={{ paddingHorizontal: 12, paddingVertical: 10,
        borderTopColor: C.border, borderTopWidth: 1, backgroundColor: C.bg, gap: 9 }}>
        <View style={[style.row, { justifyContent: 'space-between' }]}>
          <View style={[style.row, { backgroundColor: C.surface, borderRadius: 18, padding: 3 }]}>
            {(['chat', 'code'] as const).map(m => <Pressable key={m}
              onPress={() => setConversationMode(m)} disabled={busy}
              style={{ paddingVertical: 7, paddingHorizontal: 13, borderRadius: 15,
                backgroundColor: mode === m ? C.accentDeep : 'transparent' }}>
              <Text style={{ color: C.text, fontWeight: mode === m ? '700' : '400', fontSize: 12 }}>
                {m === 'chat' ? 'Chat' : '⌘ Code Agent'}
              </Text>
            </Pressable>)}
          </View>
          <Pressable onPress={() => setWorkspaceOpen(true)} style={[style.row, { gap: 5, flex: 1, justifyContent: 'flex-end' }]}>
            <Feather name="folder" color={C.accent} size={13} />
            <Text style={{ color: C.muted, fontSize: 11 }} numberOfLines={1}>
              {activeProject?.name || 'No project'}
            </Text>
          </Pressable>
        </View>
        <View style={{ backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
          borderRadius: 23, paddingHorizontal: 9, paddingTop: 5, paddingBottom: 6 }}>
          <TextInput value={draft} onChangeText={setDraft}
            placeholder={mode === 'code' ? 'Ask LUMAVUN to build or edit…' : 'Message LUMAVUN…'}
            placeholderTextColor={C.subtle} multiline maxLength={12000} editable={!busy}
            style={{ color: C.text, fontSize: 15, paddingHorizontal: 8, paddingVertical: 10, maxHeight: 130, minHeight: 44 }}
            textAlignVertical="top" />
          <View style={[style.row, { justifyContent: 'space-between' }]}>
            <View style={style.row}>
              <ActionIcon name="plus" color={C.muted} onPress={() => setWorkspaceOpen(true)} size={19} />
              <Pressable onPress={() => setModelsOpen(true)} style={[style.row, { gap: 5, paddingHorizontal: 7 }]}>
                <Feather name="cpu" size={13} color={C.muted} />
                <Text style={{ color: C.muted, fontSize: 11 }} numberOfLines={1}>
                  {state.settings.model ? state.settings.model.split('/').pop()?.slice(0, 20) : 'Model'}
                </Text>
              </Pressable>
            </View>
            <Pressable accessibilityRole="button" onPress={busy ? stop : () => { void sendMessage(); }}
              disabled={!busy && !draft.trim()} style={{
                width: 36, height: 36, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
                backgroundColor: busy ? C.raised : C.accent,
                opacity: busy || draft.trim() ? 1 : .4
              }}>
              <Feather name={busy ? 'square' : 'arrow-up'} size={18} color={busy ? C.text : C.bg} />
            </Pressable>
          </View>
        </View>
        <Text style={{ color: C.subtle, fontSize: 10, textAlign: 'center' }}>
          Agent edits require approval • Provider model runs online
        </Text>
      </View>
    </KeyboardAvoidingView>

    <Modal visible={sidebarOpen} animationType="fade" transparent onRequestClose={() => setSidebarOpen(false)}>
      <View style={{ flex: 1, flexDirection: 'row', backgroundColor: '#050510C9' }}>
        <View style={{ width: '84%', maxWidth: 370, backgroundColor: C.surface, paddingTop: 25, paddingHorizontal: 15, paddingBottom: 30 }}>
          <View style={[style.row, { gap: 10, marginBottom: 22 }]}>
            <Logo size={42} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: C.text, fontSize: 19, fontWeight: '800' }}>LUMAVUN</Text>
              <Text style={style.subtitle}>Imagine Beyond the Mist</Text>
            </View>
            <ActionIcon name="x" onPress={() => setSidebarOpen(false)} />
          </View>
          <Pressable onPress={() => startNewChat()} style={[style.row, { gap: 11,
            padding: 14, borderRadius: 13, backgroundColor: C.raised, marginBottom: 12 }]}>
            <Feather name="plus-square" color={C.accent} size={20} />
            <Text style={[style.txt, { fontWeight: '700' }]}>New chat</Text>
          </Pressable>
          <TextInput style={style.input} value={sidebarSearch} onChangeText={setSidebarSearch}
            placeholder="Search chats" placeholderTextColor={C.subtle} />
          <Text style={[style.label, { marginTop: 22, marginBottom: 9 }]}>RECENT CHATS</Text>
          <ScrollView style={{ flex: 1 }}>
            {state.chats.filter(c => c.title.toLowerCase().includes(sidebarSearch.toLowerCase()))
              .sort((a, b) => b.updatedAt - a.updatedAt).map(chat =>
              <View key={chat.id} style={[style.row, { gap: 4, paddingVertical: 4,
                borderRadius: 12, backgroundColor: chat.id === state.selectedChatId ? C.raised : 'transparent' }]}>
                <Pressable onPress={() => {
                  if (busy) { setNotice('Stop the running response first.'); return; }
                  setState(s => ({ ...s, selectedChatId: chat.id }));
                  setModeDraft(chat.mode); setSidebarOpen(false);
                }} style={[style.row, { flex: 1, gap: 10, padding: 8 }]}>
                  <Feather name={chat.mode === 'code' ? 'code' : 'message-square'} color={C.muted} size={16} />
                  <Text numberOfLines={1} style={{ color: C.text, flex: 1, fontSize: 13 }}>{chat.title}</Text>
                </Pressable>
                <ActionIcon name="trash-2" size={15} color={C.subtle} onPress={() => confirmDeleteConversation(chat)} />
              </View>)}
          </ScrollView>
          <View style={style.divider} />
          <Pressable style={[style.row, { gap: 12, padding: 13 }]} onPress={() => { setSidebarOpen(false); setWorkspaceOpen(true); }}>
            <Feather name="folder" color={C.accent} size={19} /><Text style={style.txt}>Code workspace</Text>
          </Pressable>
          <Pressable style={[style.row, { gap: 12, padding: 13 }]} onPress={() => { setSidebarOpen(false); setSettingsOpen(true); }}>
            <Feather name="settings" color={C.accent} size={19} /><Text style={style.txt}>Settings & AI provider</Text>
          </Pressable>
          <Text style={[style.subtitle, { padding: 12, fontSize: 11 }]}>LUMAVUN Agent 0.1.0 • Device-first MVP</Text>
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
