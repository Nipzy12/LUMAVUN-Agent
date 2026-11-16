import 'dotenv/config';

export type Config = {
  host: string;
  port: number;
  accessToken: string;
  aiBaseUrl: string;
  aiApiKey: string;
  defaultModel: string;
  corsOrigins: string[];
};

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const base = (env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const url = new URL(base);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('AI_BASE_URL must be an HTTP(S) URL without embedded credentials');
  }
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be a valid TCP port');
  }
  return {
    host: env.HOST || '127.0.0.1',
    port,
    accessToken: env.APP_API_TOKEN || '',
    aiBaseUrl: base,
    aiApiKey: env.AI_API_KEY || '',
    defaultModel: env.AI_DEFAULT_MODEL || '',
    corsOrigins: (env.CORS_ORIGINS || '').split(',').map((x) => x.trim()).filter(Boolean)
  };
}
