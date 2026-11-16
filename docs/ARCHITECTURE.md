# Architecture v0.1

Goal: start fresh while preserving the planned LUMAVUN Agent direction.

Client: Expo Router + React Native + TypeScript. Personal bearer token is stored in device SecureStore and never hard-coded into the bundle.
Backend: Fastify modular monolith in TypeScript. The /health route is public; all /v1 routes require a shared bearer token. Provider integration is server-side and OpenAI-compatible.
Data foundation: Supabase Postgres, RLS-scoped workspace records, approvals, task placeholders and an audit stream. Migration is not wired to runtime yet.
Communications planned: REST for commands, SSE for task streams, WebSocket/WebRTC for controlled computer sessions, FCM for push.
Governance planned: explicit tool permissions, bounded planning, human approval for irreversible operations, audit logging, secret encryption at rest, isolated task workers.

Threat boundaries:
- Do not expose provider secrets to mobile apps.
- Never take tool execution requests from untrusted model text without policy and authorization.
- Keep chat read-only: v0.1 intentionally has no order execution, shell, browser control, or wallet signing.
- Do not represent provider model discovery as authorization to invoke remote tools.
- Do not allow arbitrary user-supplied provider base URLs as an SSRF vector; configured server operator controls the base URL.
- The personal access token is temporary MVP authentication, not suitable for multi-user use.
