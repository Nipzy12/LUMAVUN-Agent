# LUMAVUN Agent

Rebuild 2026-11-16. A lightweight, security-first foundation for a personal AI agent. The previous Python application was removed from the current branch deliberately. Old commits remain available in Git history.

## Current capabilities (v0.1)

- Fastify + TypeScript backend with health check, token authentication, and OpenAI-compatible chat API.
- Automatic model discovery from the configured AI provider. No manually maintained model catalogue.
- Expo Router Android/iOS starter UI: configure backend and access token, synchronize models, and chat.
- Supabase SQL foundation for workspaces, chat history, task approvals, and audit events with RLS.
- Tests and CI for the backend.

**Not yet implemented:** autonomous task execution, cloud/local computer control, MCP tool runtime, persistent chat API, agent memory, Supabase Auth login, realtime events, and production multi-user authorization. This is an initial rebuild, not a finished Grok-equivalent product. Do not deploy it as a public multi-user service without adding real user identity and rate limiting.

## Run the API

Requires Node.js >= 22.13.

1. Copy .env.example to apps/api/.env.
2. Set APP_API_TOKEN to a long random secret, AI_API_KEY to your provider key, and AI_BASE_URL to the provider's OpenAI-compatible /v1 endpoint.
3. Run: npm install
4. Run: npm run dev
5. Test health: curl http://127.0.0.1:3000/health

Authenticated routes:
- GET /v1/models, reads the provider's live model list.
- POST /v1/chat with JSON {"model":"<provider-model-id>","messages":[{"role":"user","content":"Halo"}]}.

Send the HTTP header Authorization: Bearer <APP_API_TOKEN> on all /v1 endpoints. Provider keys remain on the server. This token is a single-user access secret, NOT a complete user authentication system.

## Run the Expo app

1. cd apps/mobile
2. npm install
3. npx expo install --fix
4. npx expo start
5. Enter the backend URL reachable by the phone (example: http://192.168.1.10:3000) and the API access token, then tap Save & Sync.

For access from another device, set HOST=0.0.0.0 in apps/api/.env and restrict exposure to a trusted LAN. Never expose an HTTP endpoint or your API token on the public internet. Use HTTPS, a trusted reverse proxy, proper identity authentication, and rate limiting before public deployment. The token is stored with expo-secure-store on the device.

## Supabase

The SQL migration under supabase/migrations is an optional foundation, not run automatically. Review and apply it using your Supabase migration process. The API does not yet connect to these tables. Never put Supabase service role keys, AI keys, or other secrets in EXPO_PUBLIC_* settings.

## Repo structure

- apps/api: backend and tests
- apps/mobile: Expo Router mobile client
- supabase/migrations: initial SQL schema
- docs: architecture and milestones
- .github/workflows: backend CI

Previous state can be recovered from commit 98908b7b24ad364148ef76326f58f5c24bd48944.
