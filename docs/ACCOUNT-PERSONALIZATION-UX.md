# LUMAVUN • Profil, Umum, Sesuaikan, Kepribadian

Pembaruan 17 November 2026. Referensi tata letak: empat screenshot yang diberikan pengguna (Profil, Umum, Sesuaikan, Kepribadian). Antarmuka settings memakai kartu terang; chat utama tetap mengikuti tema Midnight Navy LUMAVUN.

## Navigasi

- **Profil:** nama lengkap (opsional), nama panggilan, preferensi respons pribadi, dan penghapusan data akun lokal. Menu Workspace, model/provider, tampilan, dan kontrol agent **dipindahkan ke Pengaturan**. Ikon roda gigi di Profil membuka Pengaturan.
- **Pengaturan:** Profil, Umum, Sesuaikan LUMAVUN, model/provider, workspace, proyek, kemampuan, konektor, skill, memori, izin, penggunaan, tampilan, haptik, dan kontrol data.
- **Umum:** nama panggilan, bahasa respons Indonesia/English, galeri foto referensi lokal, nama peliharaan, pemilih model yang sudah ada, preferensi jawaban visual, jawaban cepat, saran chat beranda, pencarian web MCP, pencarian pustaka lokal.
- **Sesuaikan LUMAVUN:** Kepribadian, Memori SQLite, Plugin/MCP, Email, Kalender, Kontak, Dompet, Kata sandi, Lokasi, Peramban. Layanan yang belum ada **tidak ditandai tersambung**.
- **Kepribadian:** enam gaya (Bawaan, Sinis, Ramah, Profesional, Lugas, Kreatif), masing-masing 3 level untuk kehangatan, antusiasme, judul/daftar, emoji, plus teks instruksi khusus. Preferensi ditambahkan sebagai instruksi normal pada semua permintaan Chat dan Work.

## Perilaku terhubung

- Pengaturan disimpan dalam `UserPreferences` dengan migrasi data lama `normalizePreferences`.
- `personalityPrompt` menyusun instruksi gaya yang dibatasi panjangnya. Gaya Sinis berarti humor kering, bukan menghina orang atau mengesampingkan fakta.
- Jawaban cepat meminta jawaban singkat dan tidak mengirim catatan memori ke AI ataupun memicu riset web otomatis.
- Saran beranda ditampilkan/disembunyikan sesuai toggle.
- Pencarian pustaka lokal memeringkat judul percakapan, metadata proyek, dan potongan artefak berdasarkan relevansi; tidak mengarang hasil yang tidak ada. Cuplikan dapat dikirim ke provider cloud ketika pengguna mengaktifkan fiturnya.
- Foto referensi disalin ke folder privat aplikasi, paling banyak tiga file dan masing-masing maksimal 6 MB. Foto **belum** dipakai otomatis untuk image generation atau identitas model.
- Nama peliharaan adalah catatan profil, **bukan** konektor hewan.
- Bahasa aplikasi saat ini mengatur bahasa respons AI. Penerjemahan keseluruhan UI belum lengkap.
- Email dapat disambungkan melalui MCP yang tersedia, Kalender dan Lokasi membuka kontrol izin Android, Browser melalui MCP. Kontak, dompet dan password manager tidak dinyatakan terhubung bila layanan tidak ada.

## Penghapusan akun

Aplikasi belum memakai autentikasi cloud LUMAVUN tersendiri. **Hapus data akun lokal** meminta konfirmasi dan menghapus metadata lokal, percakapan, file proyek lokal, memori SQLite, referensi foto dan kunci API yang diketahui. Tidak menghapus akun atau data pada layanan AI cloud eksternal. File GGUF unduhan aplikasi bisa tetap ada dan dikelola dari halaman Model.

## Kriteria verifikasi perangkat

1. Buka Profil dari sidebar, edit nama lengkap dan nama panggilan lalu simpan. Tutup/buka aplikasi dan pastikan datanya tetap ada.
2. Tekan roda gigi, buka Pengaturan → Umum, ubah bahasa respons, model, peliharaan, tombol saran beranda, dan coba unggah/hapus satu foto referensi.
3. Pengaturan → Sesuaikan LUMAVUN → Kepribadian, pilih Sinis, ubah keempat level dan instruksi khusus; kirim chat baru untuk memeriksa perubahan gaya.
4. Aktifkan Jawaban cepat; cek tidak ada konteks memori atau riset web otomatis pada chat. Matikan untuk kembali ke mode normal.
5. Aktifkan Pencarian pustaka lokal dan tanyakan judul proyek yang benar-benar tersimpan. Periksa hasilnya.
6. Dari Sesuaikan, buka Memori dan Plugin; kembali harus mengarah ke Sesuaikan, bukan melempar pengguna ke Chat.
7. Pada akun tanpa konektor, Kontak/Dompet/Kata sandi harus menyatakan keterbatasan, bukan membuka akses palsu.
8. Konfirmasi penghapusan data **hanya** pada perangkat uji dengan data yang dapat dibuang.
9. TypeScript, unit tests, build APK CI, dan uji fisik Android semuanya perlu diperiksa. CI tidak menguji interaksi sentuh, IME, maupun kamera asli.
