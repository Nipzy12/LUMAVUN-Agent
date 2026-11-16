import type { Config } from './config.js';

export type Model = { id: string; name: string };
type Fetcher = typeof fetch;

async function providerRequest(
  config: Config,
  fetcher: Fetcher,
  endpoint: string,
  payload?: unknown
): Promise<unknown> {
  if (!config.aiApiKey) throw new Error('AI provider key is not configured');
  const url = config.aiBaseUrl + '/' + endpoint;
  const response = await fetcher(url, {
    method: payload === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: 'Bearer ' + config.aiApiKey,
      ...(payload === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
    signal: AbortSignal.timeout(25000)
  });
  if (!response.ok) throw new Error('Provider HTTP ' + response.status);
  return response.json();
}

export async function listModels(config: Config, fetcher: Fetcher): Promise<Model[]> {
  const raw = await providerRequest(config, fetcher, 'models') as {
    data?: Array<{ id?: unknown; name?: unknown }>;
  };
  if (!Array.isArray(raw?.data)) throw new Error('Provider returned an invalid models response');
  return raw.data
    .filter((item) => item && typeof item.id === 'string' && item.id.length > 0)
    .map((item) => ({
      id: item.id as string,
      name: typeof item.name === 'string' ? item.name : item.id as string
    }))
    .slice(0, 500);
}

export type ChatMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

export async function chat(
  config: Config,
  fetcher: Fetcher,
  model: string,
  messages: ChatMessage[]
): Promise<{ reply: string; model: string }> {
  const raw = await providerRequest(config, fetcher, 'chat/completions', {
    model,
    messages,
    stream: false
  }) as {
    model?: string;
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const reply = raw?.choices?.[0]?.message?.content;
  if (typeof reply !== 'string') throw new Error('Provider returned an invalid chat response');
  return { reply, model: raw.model || model };
}
