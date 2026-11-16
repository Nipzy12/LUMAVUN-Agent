import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import type { Config } from '../src/config.js';

const config: Config = {
  host: '127.0.0.1',
  port: 3000,
  accessToken: 'unit-test-access-token-that-is-long-enough',
  aiBaseUrl: 'https://provider.example/v1',
  aiApiKey: 'example-secret-for-provider',
  defaultModel: '',
  corsOrigins: []
};

test('health endpoint is public', async () => {
  const app = createApp({ config });
  const response = await app.inject('/health');
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().status, 'ok');
  await app.close();
});

test('model discovery is token protected and dynamically reads provider', async () => {
  let calls = 0;
  const providerFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls++;
    assert.equal(String(url), 'https://provider.example/v1/models');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer example-secret-for-provider');
    return new Response(JSON.stringify({ data: [{ id: 'fresh-model', name: 'Fresh Model' }] }), { status: 200 });
  }) as typeof fetch;
  const app = createApp({ config, providerFetch });
  assert.equal((await app.inject('/v1/models')).statusCode, 401);
  assert.equal(calls, 0);
  const response = await app.inject({
    method: 'GET', url: '/v1/models',
    headers: { authorization: 'Bearer ' + config.accessToken }
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().models, [{ id: 'fresh-model', name: 'Fresh Model' }]);
  assert.equal(calls, 1);
  await app.close();
});

test('chat validates payload and does not send requests without a model', async () => {
  let calls = 0;
  const providerFetch = (async () => {
    calls++;
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Halo juga' } }] }), { status: 200 });
  }) as typeof fetch;
  const app = createApp({ config, providerFetch });
  const headers = { authorization: 'Bearer ' + config.accessToken };
  const bad = await app.inject({ method: 'POST', url: '/v1/chat', headers, payload: { messages: [] } });
  assert.equal(bad.statusCode, 400);
  assert.equal(calls, 0);
  const missingModel = await app.inject({
    method: 'POST', url: '/v1/chat', headers,
    payload: { messages: [{ role: 'user', content: 'Halo' }] }
  });
  assert.equal(missingModel.statusCode, 400);
  const success = await app.inject({
    method: 'POST', url: '/v1/chat', headers,
    payload: { model: 'fresh-model', messages: [{ role: 'user', content: 'Halo' }] }
  });
  assert.equal(success.statusCode, 200);
  assert.equal(success.json().reply, 'Halo juga');
  assert.equal(calls, 1);
  await app.close();
});
