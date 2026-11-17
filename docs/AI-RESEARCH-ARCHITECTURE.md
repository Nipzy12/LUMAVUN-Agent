# LUMAVUN AI Brain, Work & Mobile Chat UX

Updated: 17 November 2026

## What is implemented

- Android keyboard: edge-to-edge chat content uses a padding `KeyboardAvoidingView`, IME resize configuration, keyboard-aware safe-area and hidden bottom navigation while typing. Both Chat and Work scroll to latest messages.
- Chat add menu: camera, gallery photo, text files (source code/Markdown/JSON/CSV/text), project association, memory toggle, web search toggle, MCP connector settings, installed GitHub skills, AI prompt/reasoning settings, Deep Research mode.
- Attachment transfer: supported images are sent to vision-capable OpenAI-compatible chat endpoints as `image_url` base64 data. Text documents are read from the device after selection and sent as text context. Images are **not** persisted as base64 in local chat history. PDF and binary parsing are not implemented.
- Work: foreground file tools remain sandbox-bound and approval-gated. Provider models use tool calling; GGUF models use an **experimental** structured tool-action bridge that cannot guarantee reliable tool calling on small local models. Work never executes shell commands.
- Brain prompt: user-configurable prompt, fast/balanced/deep problem-solving instruction modes, current configured model identifier, uncertainty and source provenance rules. Instruction modes are **not** provider-native reasoning-effort settings.
- Web Research: selected configured MCP search/browse tools run in a bounded foreground loop. The web mode permits up to 4 external calls; deep mode permits up to 12 across up to 9 model rounds. Each external tool invocation requires foreground approval. Evidence links are extracted from actual tool outputs and listed for checking. If no search was performed, the response explicitly says so.

## Reference research and design decisions

1. **Expo Keyboard Handling** [Expo keyboard-handling guide](https://docs.expo.dev/guides/keyboard-handling/). Expo explicitly recommends `KeyboardAvoidingView behavior="padding"` on edge-to-edge Android; hiding bottom tabs during keyboard use improves composer visibility.
2. **Expo ImagePicker and DocumentPicker** [ImagePicker reference](https://docs.expo.dev/versions/latest/sdk/imagepicker/) and [DocumentPicker reference](https://docs.expo.dev/versions/latest/sdk/document-picker/). These are the native media/file selection interfaces used in Chat.
3. **Gemini Deep Research** [Google documentation](https://ai.google.dev/gemini-api/docs/deep-research?hl=en). Its described pattern is plan -> search -> read -> iterate -> cited report, with long-running management. LUMAVUN implements a bounded **foreground MCP** research loop, not Google's hosted Deep Research agent.
4. **Claude prompt-engineering guidance** [Anthropic prompting best practices](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/prompt-templates-and-variables). Clear instructions, explicit tool use, scoped autonomy, source handling, and concise final explanations inform the prompt layers.
5. **OpenAI Responses/tool guidance** [OpenAI Assistants migration guide](https://platform.openai.com/docs/assistants/migration). Modern tool use and conversations favor explicit orchestration. LUMAVUN currently uses OpenAI-compatible Chat Completions because the application supports third-party generic model providers; it does **not** claim native Responses/hosted research compatibility.

## Requirements and limitations

- Configure a cloud provider and a tool-capable model for reliable Work and Deep Research.
- Configure an **actual, trusted MCP server** that exposes search and browse/read tools. Enabling search without a connection does not supply internet access.
- Image analysis depends on the selected cloud model supporting images. Incompatible model/provider responses are surfaced rather than silently treated as successful.
- Tiny local GGUF models may not follow the JSON tool protocol; their Work use is experimental, while all mutations still require approval.
- Neither camera nor image output can be fully verified without an Android-device smoke test; CI verifies TypeScript, unit tests, and Android APK packaging, not physical IME behavior.
- PDFs, generated images, sketched images, audio attachments, asynchronous research queues, and full document library indexing remain outside this iteration. Do not label them as supported.

## Manual device acceptance checks

1. Open Chat with a long history; focus the composer. The last message and send field must stay above the keyboard; bottom tabs must hide, then return when keyboard closes.
2. Open Work, select a project, focus the input; confirm the send field is visible. Try a local GGUF request to list files, inspect the approval dialog, deny mutation, and verify no file changes.
3. Use + to select a camera photo, library photo and small .txt file. Verify a removable chip before send. Test a vision-capable cloud model for images, and verify unsupported PDF is rejected with a clear explanation.
4. Set reasoning and custom prompt; restart the app and verify settings persist. Request the model identity and compare reported configured model ID against the model picker.
5. Without MCP search connected, start Deep Research and verify explicit no-search feedback. With a configured trusted MCP search, accept a limited search, observe progress and source URLs, then deny another call and verify it was not executed.

