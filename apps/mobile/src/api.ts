export type Message = { role: 'user' | 'assistant'; content: string };
export type Model = { id: string; name: string };

async function request<T>(baseUrl: string, token: string, path: string, body?: unknown): Promise<T> {
  const url = baseUrl.replace(/\/+$/, '') + path;
  const response = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const raw = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(raw.error || 'HTTP ' + response.status);
  return raw as T;
}

export function syncModels(baseUrl: string, token: string) {
  return request<{ models: Model[] }>(baseUrl, token, '/v1/models');
}

export function sendChat(baseUrl: string, token: string, model: string, messages: Message[]) {
  return request<{ reply: string; model: string }>(baseUrl, token, '/v1/chat', { model, messages });
}
