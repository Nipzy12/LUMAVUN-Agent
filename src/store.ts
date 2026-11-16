import Storage from 'expo-sqlite/kv-store';
import * as SecureStore from 'expo-secure-store';
import type { Conversation, Project, Settings } from './types';

const KEY = 'lumavun.local.v1';
const SECRET = 'lumavun.provider.secret';

export type LocalState = {
  settings: Settings;
  projects: Project[];
  selectedProjectId: string;
  chats: Conversation[];
  selectedChatId: string | null;
};

export const INITIAL_STATE: LocalState = {
  settings: {
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: '',
    temperature: 0.3
  },
  projects: [],
  selectedProjectId: '',
  chats: [],
  selectedChatId: null
};

export async function loadState(): Promise<LocalState> {
  const text = await Storage.getItem(KEY);
  if (!text) return INITIAL_STATE;
  try {
    const obj = JSON.parse(text) as Partial<LocalState>;
    return {
      ...INITIAL_STATE,
      ...obj,
      settings: { ...INITIAL_STATE.settings, ...(obj.settings || {}) },
      projects: Array.isArray(obj.projects) ? obj.projects : [],
      chats: Array.isArray(obj.chats) ? obj.chats : []
    };
  } catch {
    throw new Error('Local chat database could not be read. Data was not overwritten.');
  }
}

export async function saveState(state: LocalState) {
  await Storage.setItem(KEY, JSON.stringify(state));
}
export async function loadSecret() {
  return await SecureStore.getItemAsync(SECRET) || '';
}
export async function saveSecret(value: string) {
  if (value) return SecureStore.setItemAsync(SECRET, value);
  return SecureStore.deleteItemAsync(SECRET);
}
