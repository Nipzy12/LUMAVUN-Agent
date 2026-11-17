# LUMAVUN Research, Memory & Model Catalogue
Updated 17 November 2026.

## 1. Research bug fixed

Before: raw Exa MCP `{"content":[{"type":"text","text":"Title: ..."}]}` was inserted into the 0.5B local model context and often copied verbatim into chat. A broad query such as `tes` returned unrelated TES education sites and a long URL dump.

Now:
- `src/researchFormatter.ts` parses nested JSON/text, extracts per-source title, URL, snippet, deduplicates by URL, ranks by query overlap and caps each snippet at 320 characters.
- `src/directResearch.ts` passes *summarized evidence*, never the raw JSON payload, to the local model. A 4-source / 6-source ceiling is used for quick/deep research.
- Local inference receives a bounded evidence context, and `polishLocalResearchAnswer` replaces obviously malformed or echoed raw MCP results with a concise extractive report.
- `tes`, `ping`, and comparable test messages do not trigger an irrelevant external web search. The app asks the user for a topic.
- Cloud research `src/research.ts` also converts MCP output to small attributable source extracts; external tool approval remains mandatory.
- A URL is not proof the entire page was read. Displayed links are **retrieved search evidence**, not verified full-page citations. For claims beyond snippets, a browse/read tool is required.

## 2. SQLite local adaptive memory

- `src/memoryDb.ts` creates a private SQLite file `lumavun_memory_v1.db`. Notes have a kind, provenance, timestamps, deduplicated key and a 200-note retention cap.
- On app startup, preexisting safe `extra.memoryNotes` are migrated. Old notes that look sensitive remain in legacy storage, visible for removal, and are not injected into prompts.
- Opt-in via **Pengaturan → Kemampuan → Memori → Gunakan memori**. Automatic style preference capture is separately switchable.
- Only explicit response-style preferences are inferred automatically: e.g. short answers, Indonesian, no emoji, simple explanations. Neither full conversation content nor private identifiers are used for automatic learning.
- `ingat: ...` or the memory screen manually saves a note. Notes can be deleted individually or all at once.
- Relevant notes are selected locally and sent as **context** only while memory is enabled. With cloud models, selected notes are sent to the model provider as part of the request.
- The system **does not retrain neural-network weights**, clone ChatGPT's server-side memory, or learn every fact automatically. SQLite is on-device and is **not encrypted by default**; do not store passwords, keys, or highly sensitive data.

## 3. Models and categories

- New selectable GGUF sources:
  - Gemma 2 2B Abliterated Q4_K_M (bartowski, about 1.71 GB, estimated 4 GB RAM).
  - Phi-3.5 Mini 3.8B Q4_K_M (bartowski, about 2.39 GB, estimated 6 GB RAM).
  - Dolphin 2.9 Llama 3 8B Q4_K_M (tensorblock, about 4.58 GB, estimated 8 GB RAM).
- Gemma 4 E4B Heretic is shown **as reference only**, without a download button, since `llama.rn` compatibility for this architecture/version is unverified.
- Existing Qwen 0.5B/1.5B and Llama 1B models remain available.
- Models page adds **Semua / Diunduh / Uncensored / Custom**, size display, RAM guidance and **Import GGUF**. Import verifies the file's GGUF header, copies the file into the app's private folder, records the model in local SQLite-backed KV storage, and warns that third-party model compatibility is not guaranteed.
- These RAM values are *rough guidance*, not measured benchmarks for the user's specific phone.

## 4. GPT-OSS 120B and Cloudflare

- Official Cloudflare Workers AI model IDs:
  - `@cf/openai/gpt-oss-120b`
  - `@cf/openai/gpt-oss-20b`
- In **Provider Settings**, choose **Cloudflare Workers AI**, enter the Cloudflare Account ID, add a Cloudflare API token with Workers AI permission in SecureStore, and sync/select a GPT-OSS model.
- This uses the **official OpenAI-compatible HTTPS endpoint**: `https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1/chat/completions`.
- GPT-OSS 120B is **cloud-only for this Android application**. OpenAI's MXFP4 checkpoint is about 60.8 GiB, and cannot realistically run on a typical phone.
- No custom Cloudflare Worker has been deployed. Workers AI already provides the required hosted inference and adding a proxy Worker would add complexity, credentials management and security surface without solving the search bug. The user may deploy a separate authenticated Worker later if they need orchestration; no nonexistent hosted endpoint is advertised here.
- Model metadata is sourced from the published Cloudflare catalogue. The app does not invent a provider-wide dynamic list for Cloudflare's models.

## References

- Cloudflare Workers AI GPT-OSS 120B model: https://developers.cloudflare.com/workers-ai/models/gpt-oss-120b/
- Cloudflare OpenAI compatibility: https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/
- OpenAI gpt-oss model architecture: https://deploymentsafety.openai.com/gpt-oss/architecture
- Expo SQLite: https://docs.expo.dev/versions/latest/sdk/sqlite/
- Expo FileSystem: https://docs.expo.dev/versions/latest/sdk/filesystem/
- GGUF model files: https://huggingface.co/bartowski/gemma-2-2b-it-abliterated-GGUF
  https://huggingface.co/bartowski/Phi-3.5-mini-instruct-GGUF
  https://huggingface.co/tensorblock/dolphin-2.9-llama3-8b-GGUF
  https://huggingface.co/igorls/gemma-4-E4B-it-heretic-GGUF

## Device acceptance checks

1. In chat with Exa web enabled, send `tes`: it should ask for a specific query, **without** a search call or irrelevant TES result.
2. Ask a meaningful current-topic question and approve the MCP search: see a short summary and at most five source URLs, never raw JSON.
3. Enable memory, save `ingat: Saya ingin jawaban singkat.`, restart the app, confirm a persistent note and adaptation. Delete the note and verify it is not restored.
4. Switch to Cloudflare Workers AI, enter real Account ID/token, sync and select GPT-OSS 120B; confirm model response and billing in the Cloudflare account.
5. On Models, filter by Uncensored and Custom, import a valid GGUF and a non-GGUF file (the latter must be rejected), then test unloading/deleting the imported model.
6. Compare model RAM requirements to available physical RAM and free storage before downloading. Especially avoid an 8B quant on a low-RAM device.
7. Verify GitHub TypeScript/tests/Android build and perform a real Android smoke test. CI alone does not certify on-device inference or Exa connectivity.
