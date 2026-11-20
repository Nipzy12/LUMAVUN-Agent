# LUMAVUN Desktop for Windows

A standalone Electron companion for the LUMAVUN Agent project. Its layout is inspired by modern AI chat interfaces, with LUMAVUN branding. It is **not affiliated with OpenAI** and does not log into ChatGPT.

## Included

- Responsive sidebar with resizable width, project groups, recent chats, search and account menu.
- Conversation UI with editable composer, basic formatted code blocks, copy and save-to-library actions.
- Non-streaming chat API with cancellation, model switcher and provider model discovery.
- Provider settings for OpenAI, OpenRouter and custom **HTTPS** OpenAI-compatible services.
- API key encrypted using Electron safeStorage / Windows DPAPI. It is not stored in browser localStorage or exported with backups.
- Local chat and project state, search, profile, personality instructions, user-written memories, JSON import/export.
- Temporary chat mode, dark/light/system theme, accent customisation.
- Image creation with OpenAI gpt-image-1 (requires OpenAI API key and model access), images stored locally.
- Image and plain text attachments (file type and size limits apply).
- Windows Speech Recognition dictation when supported; Windows Voice Typing (Win+H) otherwise.

## Limitations

This is a new Windows desktop edition, not a direct binary port of the Android React Native app. Features that require an Android-specific native module, MCP integration, comprehensive web search, plugins, background scheduled tasks, actual ChatGPT account sync, or full duplex voice are **not** implemented in this version. These are not fake buttons: the interface discloses unavailable capabilities. "Pikir mendalam" adds a careful reasoning instruction to the system prompt; it does not select a proprietary thinking mode. Cloud API usage may incur costs. Local chat data is not end-to-end encrypted; only the API key is encrypted.

## Local development

Requires Node.js 22+ and Windows for making the executable.

```bash
cd desktop
npm install
npm run check
npm start
npm run dist
```

Output: `desktop/dist/LUMAVUN-Desktop-0.1.0-portable.exe`.

CI: workflow `.github/workflows/windows-desktop.yml` builds the Windows x64 portable EXE and uploads a ZIP artifact.

The portable executable has no publisher code-signing certificate. Windows SmartScreen may flag an unrecognized app. Verify its origin and SHA256 before installation. Do not confuse an unsigned internal-test executable with a trusted production release.

## Data & security

State is stored in the Electron userData folder for the signed-in Windows user. The provider key uses safeStorage encryption when available and is never included in exports. Provider URLs must use HTTPS. The renderer has context isolation, sandboxing, a restrictive content-security policy and no Node.js integration. The browser profile used by TinyFish for design auditing is **not** copied into the app.

The Windows desktop implementation is independent of the Android codebase and does not change Android build assets.
