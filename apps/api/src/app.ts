import Fastify from 'fastify';
import cors from '@fastify/cors';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { readConfig, type Config } from './config.js';
import { chat, listModels } from './provider.js';

type Options = { config?: Config; providerFetch?: typeof fetch };

const chatSchema = z.object({
  model: z.string().min(1).max(250).optional(),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().min(1).max(20000)
  })).min(1).max(30)
}).strict();

function matchesSecret(given: string, expected: string): boolean {
  const left = createHash('sha256').update(given).digest();
  const right = createHash('sha256').update(expected).digest();
  return timingSafeEqual(left, right);
}

export function createApp(options: Options = {}) {
  const config = options.config || readConfig();
  const providerFetch = options.providerFetch || fetch;
  const app = Fastify({ logger: false, bodyLimit: 256 * 1024 });

  void app.register(cors, { origin: config.corsOrigins.length ? config.corsOrigins : false });

  app.get('/health', async () => ({ status: 'ok', service: 'lumavun-agent-api', version: '0.1.0' }));

  app.addHook('preHandler', async (request, reply) => {
    if (!request.url.startsWith('/v1/')) return;
    if (!config.accessToken || config.accessToken.length < 24) {
      return reply.code(503).send({ error: 'APP_API_TOKEN must be configured (24+ characters)' });
    }
    const header = request.headers.authorization || '';
    if (!header.startsWith('Bearer ') || !matchesSecret(header.slice(7), config.accessToken)) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  app.get('/v1/models', async (_request, reply) => {
    if (!config.aiApiKey) return reply.code(503).send({ error: 'AI_API_KEY is not configured' });
    try {
      return { models: await listModels(config, providerFetch) };
    } catch {
      return reply.code(502).send({ error: 'Failed to synchronize provider models' });
    }
  });

  app.post('/v1/chat', async (request, reply) => {
    const parsed = chatSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid chat request' });
    if (!config.aiApiKey) return reply.code(503).send({ error: 'AI_API_KEY is not configured' });
    const model = parsed.data.model || config.defaultModel;
    if (!model) return reply.code(400).send({ error: 'Select a model first' });
    try {
      return await chat(config, providerFetch, model, parsed.data.messages);
    } catch {
      return reply.code(502).send({ error: 'AI provider request failed' });
    }
  });

  return app;
}
