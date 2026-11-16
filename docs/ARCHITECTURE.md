# LUMAVUN Agent architecture

## Boundaries

1. User interface (React Native in APK): conversations, settings, Code Agent toggle, workspace, approvals.
2. Model adapter (React Native fetch): /models and /chat/completions; BYOK; provider model must support tool calls for Code Agent.
3. Agent loop (on-device JS): bounded max 8 model rounds / 24 tool calls. Every tool output is returned to model for continuation.
4. File adapter (Expo FileSystem): allowlisted text-file tools, relative paths only, app sandbox only.
5. Local persistence: SQLite KV for chats, projects, provider URL/model; SecureStore for provider key.

### Approval protocol

The remote model may request a write, replace, or delete operation. The agent requests a local preview from the project adapter, opens a modal showing BEFORE/AFTER, and awaits a human response. Denied requests return DENIED BY USER to the model and make no filesystem changes. Approvals apply to single operations only, not the whole agent task.

### Threat model

- Malicious remote model or prompt injection in project files: confined to allowed app workspace and denied unsafe path traversal.
- Data exfiltration through provider messages: user deliberately supplies provider key; chat and read file content are transmitted for model use.
- Accidental destructive actions: every write/delete requires review. No automatic rollback yet.
- Arbitrary local code execution: absent by design; no shell tool is offered.
- Agent runaway costs: bounded iterations and tool-call count. Provider pricing remains user responsibility.

### Roadmap

- v0.2: better markdown, streaming, context pruning, richer diff renderer, automated file backups/undo
- v0.3: local syntax highlighting, search in files, full zip project import/export, Git integration
- v0.4: test runner via authorized isolated worker (not untrusted device shell), connected GitHub workflow
- v0.5: cloud agent tasks, workspace collaboration, Supabase optional login and sync
- v0.6: voice, multimodal attachments, tool/plugin governance, robust multi-provider native API support

The described v0.2+ items are *planned*, not shipping functionality.
