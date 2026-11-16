# LUMAVUN Agent

**Native Android AI chat + on-device code-agent runtime** with an original LUMAVUN visual identity, inspired by the navigation patterns of mainstream AI assistants. Not affiliated with OpenAI or Anthropic. This is an independent MVP, **not** a feature-complete clone of ChatGPT or Claude.

## What works in source code

- Android-first conversational chat UI, sidebar history, chat search, new/delete conversation
- Separate Chat and Code Work screens, with Chat / Work modes inside the code workspace
- OpenAI-compatible provider integration with OpenAI, OpenRouter, and custom HTTPS endpoints
- Direct provider model discovery and model picker/search (no hardcoded models)
- BYOK stored in Expo SecureStore, local chat history stored in SQLite KV
- On-device JavaScript agent loop with bounded tool-use rounds and explicit approval gates
- Code Agent tools: list_files, read_file, write_file, replace_in_file, delete_file
- Searchable Projects page and private project folders, with import, editing, and share/export
- AI responses with fenced-code presentation and copy button
- Cancel a chat/agent request via Stop
- GitHub CI: typecheck, core tests, Expo dependency checks; standalone Android release APK build with bundled JavaScript

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

GitHub Actions workflow [Android Standalone APK](.github/workflows/android-apk.yml) builds an **offline-bootable standalone Android APK** (release JavaScript bundle embedded, signed with a temporary debug key for internal testing). Go to Actions → Android Standalone APK → Run workflow. When the job succeeds, download the artifact named `lumavun-android-standalone` and install the enclosed `app-release.apk`. It does **not** need Metro or a USB connection to open the UI. AI provider requests still require internet access.

If you installed an earlier `app-debug.apk`, uninstall that version before installing the standalone APK if Android reports a signing conflict. Back up any locally stored chats or project files first, as uninstalling clears app data. This build is for personal testing, **not a production Play Store signing configuration**.

You can also build locally:

```bash
npm install
npx expo install --fix
npx expo prebuild --platform android --non-interactive
cd android
./gradlew assembleRelease
```

Output: android/app/build/outputs/apk/release/app-release.apk

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


## LUMAVUN v0.3: Projects, Code Work, Artifacts

**Proyek** is the searchable local-project index. Create a project with **Proyek baru**, open it to manage code files, or enter **Code → Work** to let the agent work in the selected project.

**Code** contains a Chat/Work switch:
- **Chat**: discuss code using the chosen AI provider, without file tools.
- **Work**: the on-device agent can list and read local project files. Writing, replacing or deleting files opens a **per-operation approval modal** with BEFORE/AFTER text. The activity timeline displays assistant messages and tool results. Stop cancels the active request. This is **not** a remote cloud computer and has **no shell**.
- Approved file writes automatically refresh the project modified date and save an artifact snapshot when the file is smaller than 120k characters. Deleting a project file does not delete existing snapshots.

**Artefak** stores up to 80 private local code snapshots:
- Assistant responses containing fenced code can be saved via **Simpan kode sebagai artefak**.
- File edits and imports from **Code Workspace** are saved to the gallery as snapshots.
- Search saved artifacts and open the detail view to copy or delete, or return to the source project.
- HTML artifacts have an interactive embedded preview. The WebView runs **only** self-contained HTML/CSS/JS, with CSP blocking network access, external frames, and file access. This is an experimental local preview, not a fully hardened browser sandbox. Do not paste untrusted secrets into HTML previews.
- JS/TS/TSX/JSX/Python/SVG/Markdown and other text files are displayed as source, **not compiled or executed**. To preview a website, ask Code Agent to create a self-contained \`index.html\` with inline CSS/JS.
- Existing local chat history, project folders, and API key settings are retained when upgrading from v0.2.

### Getting an Android APK

The standalone workflow builds the **release** JavaScript bundle into \`app-release.apk\` and checks signing plus \`assets/index.android.bundle\`. Open the [Android Standalone APK workflow](.github/workflows/android-apk.yml), choose the latest green run for version **0.4.0 (Android versionCode 4)**, and download the \`lumavun-android-standalone\` artifact. Extract the ZIP to install \`app-release.apk\`.

The artifact is signed with an ephemeral debug key for personal testing. Android may reject in-place upgrades if the key differs across builds. Back up project files and local chat before uninstalling, because uninstalling deletes app-private data. A stable production signing key and backup/restore are not implemented.

### Privacy and limitations

Data and code snapshots live on-device in SQLite KV and private application file storage. They are not encrypted by this starter app. AI requests send user prompts and any agent-read file contents to the selected provider. API keys are in device SecureStore. No hosted workspace, cloud agent, automated code runner, GitHub PR runner, real Canvas editor, or subscription management is claimed.


## LUMAVUN v0.4 | Kemampuan, MCP, Skills dan AI lokal

### Kemampuan
Buka Profil -> Pengaturan -> Kemampuan.

- Pencarian web: hanya aktif dengan konektor MCP yang menyediakan tool search/web/browse. Setiap panggilan meminta persetujuan. Tanpa server, chat tetap berjalan tanpa hasil pencarian.
- Artefak: mengontrol snapshot file dan chat. Visualisasi: mengontrol preview HTML.
- Eksekusi kode/file: mengontrol Code Agent untuk folder aplikasi, bukan shell.
- Fallback model: hanya pada error jaringan/provider sementara (contohnya HTTP 429, 503). Tidak untuk menghindari penolakan keamanan.
- Memori: OFF secara default. Aktifkan dan tulis pesan dengan awalan "ingat:" agar tersimpan lokal. Semua memori bisa dibaca/hapus di halaman File memori.
- Akses alat: mode sesuai permintaan meminta izin baca. Semua perubahan file dan panggilan MCP eksternal tetap meminta izin setiap kali.

### Konektor MCP Server
Buka Pengaturan -> Konektor -> tombol + -> Tambahkan kustom. Masukkan nama, URL HTTPS Streamable HTTP dan bearer token opsional. HTTP hanya untuk localhost/loopback. Tombol tes menjalankan initialize dan tools/list. Token disimpan di SecureStore.

Tool terhubung tersedia pada Code -> Work dengan persetujuan eksplisit per aksi. Tool pencarian tersedia pada Chat bila Pencarian web aktif dan model cloud mendukung tool calling. Contoh integrasi Gmail, Google Drive, Alpha Vantage dan lainnya tidak otomatis tersambung: tiap layanan memerlukan server MCP dan otorisasi sendiri.

### Skill GitHub
Buka Pengaturan -> Skill. Pilih dari contoh repo GitHub yang terverifikasi, atau masukkan owner/repository dan path SKILL.md. Konten Markdown diunduh dari main, disimpan lokal, bisa diaktifkan, dilihat, dan dihapus. Kontennya menjadi referensi, bukan skrip yang dieksekusi; seluruh perubahan file tetap memerlukan izin.

### Izin dan penggunaan
- Izin menampilkan status izin lokasi Android saat digunakan dan akses kalender. Aplikasi tidak meminta background location.
- Penggunaan menampilkan jumlah panggilan cloud/lokal dalam 7 hari serta jumlah token yang memang dilaporkan provider. Kuota akun, tanggal reset, kredit dan penagihan tidak tersedia melalui API generik sehingga nilainya tidak dipalsukan.
- Proyek membuka halaman detail dengan file konteks, instruksi khusus, memori, chat proyek dan menu sematkan/edit/arsipkan/hapus. Arsip bisa dibuka dari daftar proyek untuk memulihkan proyek.

### AI lokal Android: llama.cpp (bukan server Ollama)
APK v0.4 memuat native runtime llama.rn untuk model GGUF. Model diunduh terpisah ke penyimpanan privat HP dan dapat dipilih, dibatalkan saat unduh, serta dihapus.

Model rekomendasi: Qwen2.5 0.5B Q4_K_M sekitar 491 MB, Qwen2.5 1.5B Q4_K_M sekitar 986 MB, dan Llama 3.2 1B Q4_K_M sekitar 808 MB. RAM yang dibutuhkan bisa melebihi ukuran file. Pengujian langsung di HP tetap diperlukan.

Model cloud disinkronkan dari endpoint /models provider yang dipilih. Ukuran bobot cloud biasanya tidak tersedia dan model cloud bukan file yang bisa diunduh ke HP. Chat lokal tersedia setelah model terpasang; Code Agent dengan tool calling tetap memerlukan provider yang mendukung tools.

### Batas versi ini
Aplikasi tidak meniru layanan langganan/kuota ChatGPT atau Claude, tidak mempunyai server Ollama penuh, tidak menjalankan shell native, dan belum memiliki pengelolaan OAuth Gmail/Drive otomatis, sync antardevice, atau cloud computer.
