import Storage from 'expo-sqlite/kv-store';
import * as SecureStore from 'expo-secure-store';
import type { Conversation, Project, Settings, UserArtifact } from './types';

const KEY = 'lumavun.local.v1';
const SECRET = 'lumavun.provider.secret';

export type UserPreferences = {
  name: string;
  haptics: boolean;
  hideTabs: boolean;
  largeText: boolean;
};

export const DEFAULT_PREFERENCES: UserPreferences = {
  name: 'Pengguna',
  haptics: true,
  hideTabs: false,
  largeText: false
};

export type LocalState = {
  profile: UserPreferences;
  settings: Settings;
  projects: Project[];
  artifacts: UserArtifact[];
  selectedProjectId: string;
  chats: Conversation[];
  selectedChatId: string | null;
};

export const INITIAL_STATE: LocalState = {
  profile: DEFAULT_PREFERENCES,
  settings: {
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: '',
    temperature: 0.3
  },
  projects: [],
  artifacts: [],
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
      profile: { ...DEFAULT_PREFERENCES, ...(obj.profile || {}) },
      projects: Array.isArray(obj.projects) ? obj.projects : [],
      artifacts: Array.isArray(obj.artifacts) ? obj.artifacts : [],
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
