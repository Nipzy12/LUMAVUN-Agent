import type { ModelInfo, Settings } from './types';

export type ToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};
export type APIMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
};
export type APITool = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: { type: string; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };
  };
};
export type Completion = { content: string; toolCalls: ToolCall[]; model: string };

export const PRESETS: Record<'openai' | 'openrouter', string> = {
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1'
};

function endpoint(settings: Settings, path: string) {
  const url = settings.baseUrl.trim().replace(/\/+$/, '');
  if (!url.startsWith('https://') && !url.startsWith('http://')) {
    throw new Error('Provider URL must start with https:// (or http:// on a trusted local network)');
  }
  const parsed = new URL(url);
  if (parsed.username || parsed.password || !['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Provider URL is invalid');
  }
  return url + '/' + path;
}

async function api<T>(
  settings: Settings,
  apiKey: string,
  path: string,
  options: { body?: unknown; signal?: AbortSignal } = {}
): Promise<T> {
  if (!apiKey.trim()) throw new Error('Set API Key in Settings first');
  const response = await fetch(endpoint(settings, path), {
    method: options.body === undefined ? 'GET' : 'POST',
    signal: options.signal,
    headers: {
      Authorization: 'Bearer ' + apiKey.trim(),
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(settings.provider === 'openrouter' ? { 'X-Title': 'LUMAVUN Agent' } : {})
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  if (!response.ok) {
    let description = '';
    try {
      const body = await response.json();
      description = String(body?.error?.message || body?.message || '').slice(0, 250);
    } catch { /* avoid leaking unexpected HTML body */ }
    throw new Error('Provider HTTP ' + response.status + (description ? ': ' + description : ''));
  }
  return (await response.json()) as T;
}

export async function fetchModels(settings: Settings, key: string): Promise<ModelInfo[]> {
  const data = await api<{ data?: Array<{ id?: string; name?: string }> }>(settings, key, 'models');
  if (!Array.isArray(data.data)) throw new Error('Invalid provider model list');
  return data.data.filter((m) => typeof m?.id === 'string' && m.id.length > 0)
    .map((m) => ({ id: m.id!, name: m.name || m.id! }))
    .sort((a, b) => a.id.localeCompare(b.id)).slice(0, 1000);
}

export async function createCompletion(
  settings: Settings,
  key: string,
  messages: APIMessage[],
  options: { tools?: APITool[]; signal?: AbortSignal } = {}
): Promise<Completion> {
  if (!settings.model) throw new Error('Select an AI model in Settings');
  const raw = await api<{
    model?: string;
    choices?: Array<{ message?: { content?: string | null; tool_calls?: ToolCall[] } }>;
  }>(settings, key, 'chat/completions', {
    signal: options.signal,
    body: {
      model: settings.model,
      messages,
      temperature: settings.temperature,
      stream: false,
      ...(options.tools?.length ? { tools: options.tools, tool_choice: 'auto' } : {})
    }
  });
  const message = raw.choices?.[0]?.message;
  if (!message || (typeof message.content !== 'string' && !Array.isArray(message.tool_calls))) {
    throw new Error('Provider returned no assistant response');
  }
  return {
    content: message.content || '',
    toolCalls: Array.isArray(message.tool_calls) ? message.tool_calls : [],
    model: raw.model || settings.model
  };
}
