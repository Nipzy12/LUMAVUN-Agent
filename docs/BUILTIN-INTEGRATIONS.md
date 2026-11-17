# Integrasi Bawaan LUMAVUN (17 November 2026)

## Prinsip

Katalog di `src/builtinRegistry.ts` menyimpan referensi, kategori, fungsi, dan persyaratan yang dikurasi. Pengguna tidak dapat mengganti URL GitHub asli atau menghapus entri bawaan melalui antarmuka APK. **Pengaturan operasional tetap dapat diubah**: Exa dapat dinyalakan/dimatikan, API key disimpan terpisah di Android SecureStore, dan panduan skill bawaan dapat diaktifkan/dinonaktifkan. Katalog tidak otomatis mengunduh, menjalankan atau memuat kode sumber dari semua repositori.

## Status sumber

| Sumber | Fungsi | Status runtime dalam APK |
|---|---|---|
| [Exa MCP](https://github.com/exa-labs/exa-mcp-server) | Search + fetch web | Konektor HTTP bawaan, perlu uji jaringan; anonim dengan limit |
| [Open-WebSearch](https://github.com/Aas-ee/open-webSearch) | MCP/CLI/daemon pencarian multi-engine | Referensi, perlu MCP server milik pengguna |
| [Heventure Search MCP](https://github.com/HughesCuit/heventure-search-mcp) | Web search multi-engine | Referensi, perlu Python/Docker MCP server |
| [ZimZilla](https://github.com/Mr-Destroyer/ZimZilla) | Terminal coding agent | Perlu runtime terminal terpisah; bukan shell Android |
| [Uncensored AI](https://github.com/AnkitNayak-dev/Uncensored-ai) | UI web pihak ketiga | Referensi desain saja, bukan model lokal; konten bypass tidak diimpor |
| [Openjutsu](https://github.com/D3voz/openjutsu) | Edit karakter/objek video | Perlu GPU, ComfyUI dan worker terpisah |
| [Kimi K3 in C](https://github.com/FareedKhan-dev/kimi-k3-in-c) | Eksperimen inferensi C99 | Bukan GGUF siap unduh; checkpoint sangat besar |
| [Wan2.2](https://github.com/Wan-Video/Wan2.2) | Generasi video | Perlu GPU/worker serta checkpoint |
| [VoiceStudio](https://github.com/debpalash/VoiceStudio) | Voice synthesis dan dubbing | Perlu instance aplikasi/backend yang cocok |
| [ComfyUI](https://github.com/Comfy-Org/ComfyUI) | Workflow media generatif | Perlu API ComfyUI/gateway dan runtime sendiri |
| [Artemis](https://github.com/google/artemis) | Automasi/pengujian perangkat Android | Perlu host Python, ADB dan izin perangkat |
| [Vibe-Trading](https://github.com/HKUDS/Vibe-Trading) | Agent analisis dan trading | Perlu Python dan konektor data/broker tersendiri |
| [Trader Skill](https://github.com/Jakeschincariol/trader-skill) | Metodologi trading dan risk management | Panduan relevan tersedia, skrip tidak dijalankan |
| [Replica Skill](https://github.com/Jakeschincariol/replica-skill) | Metodologi clean-room rekreasi aplikasi | Panduan relevan tersedia, skrip tidak dijalankan |

URL Google Translate untuk Openjutsu dinormalisasi ke `https://github.com/D3voz/openjutsu`.

## Bagaimana internet bekerja

- **Chat, provider cloud**: jika pencarian web diaktifkan, LUMAVUN menemukan MCP tools dari konektor pengguna, kemudian Exa bawaan bila aktif. Model yang mendukung tool calling dapat mengirim tool calls; semua pemanggilan eksternal tetap meminta persetujuan. Deep Research melakukan hingga 12 panggilan yang nyata dan mengumpulkan URL dari respons server.
- **Chat, GGUF lokal**: model lokal kecil tidak memerlukan tool calling; aplikasi sendiri memanggil MCP search (satu pencarian cepat atau hingga tiga pencarian mode mendalam) atas persetujuan pengguna. Potongan hasil diberikan sebagai konteks kepada model lokal, kemudian URL yang benar-benar ditemukan dilampirkan. Kualitas rangkuman dibatasi kemampuan dan context window GGUF.
- **Tanpa koneksi**: riset menampilkan alasan yang spesifik, tidak mengarang hasil maupun sumber.
- **Exa**: bisa anonim dengan rate limit, atau API key tersimpan aman di Pengaturan → Konektor. Kredensial tidak dikirim sebagai teks pesan ke model, hanya sebagai header HTTP ke MCP Exa.

## Mengaktifkan

1. Buka Pengaturan → Kemampuan → Konektor MCP.
2. Aktifkan Exa bawaan dan tekan **Tes Exa MCP**. Jika akses anonim ditolak atau dibatasi, simpan API key Exa dari layanan Exa dan ulangi tes.
3. Untuk Open-WebSearch / Heventure / backend media lainnya, jalankan servis sesuai dokumentasi repository di komputer/server dan hubungkan endpoint **MCP Streamable HTTP** yang tepercaya dari menu konektor kustom. Endpoint aplikasi web/ComfyUI mentah **bukan** otomatis MCP; gunakan gateway MCP yang sesuai.
4. Di Chat, ketuk **+ → Pencarian web** atau **Deep Research**. Permintaan eksternal akan menampilkan dialog persetujuan.
5. Pengaturan → Skill menampilkan panduan bawaan dan pilihan memasang SKILL.md tambahan yang path-nya terverifikasi; pemasangan hanya menyimpan teks yang dipilih, bukan menginstal runtime Python/Node.

## Identitas model

Pertanyaan eksplisit tentang model aktif dijawab dari ID model yang benar-benar dipilih di aplikasi, bukan dari identitas yang dihalusinasikan model. Misalnya model lokal `qwen-05-q4` dilaporkan sebagai Qwen2.5 0.5B Instruct Q4_K_M, **bukan Mia**. Provider cloud dapat memiliki lapisan routing yang tidak dapat diverifikasi aplikasi.

## Pembatasan

- Katalog terkunci tidak sama dengan semua runtime sudah terpasang.
- Tool Claude/OpenAI yang disediakan oleh host platform tidak ikut tertanam secara otomatis ke aplikasi LUMAVUN.
- Exa dan aplikasi pihak ketiga tunduk pada syarat layanan, jaringan, API key, privasi, dan limit masing-masing.
- Menambahkan API key Exa tidak memberikan akses ke model AI cloud; kamu tetap butuh model terpilih untuk rangkuman.
- Automasi trading langsung, manipulasi media GPU, dan pengendalian perangkat Android oleh server eksternal tidak dieksekusi tanpa konektor operasional, izin dan verifikasi tersendiri.
- Build CI menilai TypeScript, unit tests dan packaging. Pengujian koneksi Exa langsung dan penggunaan di perangkat Android harus dilakukan pada perangkat dengan internet.
