# LUMAVUN Agent

**Native Android AI chat + on-device code-agent runtime** with an original LUMAVUN visual identity, inspired by the navigation patterns of mainstream AI assistants. Not affiliated with OpenAI or Anthropic. This is an independent MVP, **not** a feature-complete clone of ChatGPT or Claude.

## What works in source code

- Android-first conversational chat UI, sidebar history, chat search, new/delete conversation
- Chat and Code Agent toggle in the message composer
- OpenAI-compatible provider integration with OpenAI, OpenRouter, and custom HTTPS endpoints
- Direct provider model discovery and model picker/search (no hardcoded models)
- BYOK stored in Expo SecureStore, local chat history stored in SQLite KV
- On-device JavaScript agent loop with bounded tool-use rounds and explicit approval gates
- Code Agent tools: list_files, read_file, write_file, replace_in_file, delete_file
- App-private project folders, multiple projects, text file import, editing, share/export, previews
- AI responses with fenced-code presentation and copy button
- Cancel a chat/agent request via Stop
- GitHub CI: typecheck, core tests, Expo dependency checks; Android debug APK build

**Important:** The orchestrator and file tools run *inside the Android app*. The intelligence is supplied by a remote AI model/provider. This is not an offline on-device LLM and it does not provide shell/terminal execution. Files outside the app's document sandbox are not touched. Approval previews are truncated; carefully review before approving large changes.

## Technology

- Expo SDK 58 / React Native 0.88 / React 19.3 / TypeScript
- Expo FileSystem, DocumentPicker, SQLite, SecureStore, Sharing, Clipboard
- Provider API: OpenAI-compatible /v1/models and /v1/chat/completions with function tool calling
- Single-app codebase with local state, not a fake chat-only prototype

## Getting started

1. Install Node.js 22+ and npm.
2. Run npm install.
3. Run npx expo install --fix (if npm resolves a different Expo package version).
4. Run npm run typecheck and npm test.
5. Run npx expo start (use Expo Go if the installed SDK is supported, or a dev build).
6. Tap ☰ → Settings & AI provider; choose provider, add API key, Save & sync models.
7. Choose a model in the header.
8. For coding: choose Code Agent in composer → open workspace folder → create project → send prompt → inspect/approve individual file changes.

**Privacy:** Your API key is stored on the device and sent only to the provider URL you choose. Provider requests necessarily transmit the chat text and agent-read file snippets to that provider. Do not put secret tokens into project files you ask the agent to inspect. The local conversation database is not encrypted by this starter implementation.

## Android APK

GitHub Actions workflow [Android APK](.github/workflows/android-apk.yml) builds a **debug-signed installable APK** using Expo prebuild and Gradle. Go to Actions → Android APK → Run workflow. If the job succeeds, download the artifact named lumavun-android-debug. Debug APK is for personal testing, NOT a signed Play Store production release.

You can also build locally:

\`\`\`bash
npm install
npx expo install --fix
npx expo prebuild --platform android --non-interactive
cd android
./gradlew assembleDebug
\`\`\`

Output: android/app/build/outputs/apk/debug/app-debug.apk

## Exact limits compared with proprietary assistants

ChatGPT and Claude have proprietary services and substantial infrastructure. Pixel-perfect and full 100% functional parity is neither asserted nor achieved. This MVP does **not** implement:
- GPT/Claude backend models, their proprietary tools or subscriptions
- Voice chat, vision/image understanding, browsing, remote cloud computer, video, screen sharing
- Persistent autonomous background workers or device-wide file access
- Sandboxed shell / terminal, code execution, git commit or remote GitHub PR workflow
- Agent-to-agent orchestration, vector memory, production OAuth, cross-device sync
- Full markdown renderer, streaming SSE, prompt caching, specialized artifacts

These belong to a follow-on roadmap, not fake buttons. Feature detail is in docs/ARCHITECTURE.md.

## Security boundaries

- No hard-coded API keys, no app server and no silent file modifications.
- All agent write / replace / delete operations require an approval sheet.
- Workspace paths block directory traversal, absolute paths, control characters.
- Tool names are fixed by an allowlist, with limits on rounds, files and file size.
- Model text is not a source of native permissions.
- This is an experimental personal development app, not a security-audited production release.
