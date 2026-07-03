---
title: LLM Avatar
emoji: 💬
colorFrom: purple
colorTo: blue
sdk: docker
app_port: 12393
pinned: false
---

# LLM_Avatar (Open-LLM-VTuber Kustom) - v1.2.1

Proyek ini adalah versi kustomisasi dari **Open-LLM-VTuber** (asisten suara virtual interaktif AI dengan avatar Live2D) yang dikembangkan untuk kebutuhan khusus dengan penyesuaian gaya antarmuka (UI) dan perbaikan bug model backend.

Aplikasi ini berjalan pada versi: **v1.2.1**

---

## ✨ Fitur Kustom & Modifikasi Terbaru

### 1. 🌌 Antarmuka Futuristik Transparan (Holographic Glass HUD)
Seluruh panel kontrol bagian bawah (footer) dan indikator telah didesain ulang agar memiliki estetika cyberpunk/fiksi ilmiah yang futuristik:
* **Tombol Kontrol Transparan**: Tombol mikrofon dan tombol tangan memiliki latar belakang kaca transparan (`rgba` opasitas `0.08` dengan efek `backdrop-filter: blur(8px)`) serta garis tepi neon bercahaya solid.
* **Pendaran Cahaya Ikon (Neon Glow)**: Semua ikon di dalam tombol (termasuk tombol klip lampiran file dan tombol panah collapse/expand) memancarkan pendaran cahaya kustom (`drop-shadow` filter) berwarna sian neon, oranye, atau merah muda.
* **Badge Status HUD (`Share Tech Mono`)**: Badge status koneksi WebSocket (`#futuristic-ws-badge`) dan badge status AI (`#futuristic-ai-badge`) menggunakan font bergaya terminal futuristik, lengkap dengan warna gradasi dinamis dan animasi denyut (*pulsing*) ketika mendengarkan (*listening*).

### 2. 🤖 Sensor & Penyaring Gambar untuk Model Non-Vision (Ollama Bugfix)
* **Masalah Sebelumnya**: Klien web secara otomatis mengirimkan tangkapan gambar layar/media ke backend. Saat menggunakan model teks murni seperti `qwen2.5-coder:1.5b` pada server Ollama lokal, ini memicu error `400 - Multimodal data provided, but model does not support multimodal requests`.
* **Solusi**: Sistem sekarang memiliki pendeteksi cerdas di sisi server. Jika model yang Anda konfigurasikan bukan model visual/multimodal (seperti qwen, llama, dll.), backend akan **menyaring dan menghapus lampiran gambar** dari riwayat pesan sebelum dikirim ke API, sehingga mencegah error status 400.

### 3. 👄 Gerakan Mulut Live2D Lebih Halus & Alami
* Batas pembukaan mulut maksimum dioptimalkan (dari `0.38` menjadi `0.20`) dan penskalaan viseme dikurangi agar gerakan mulut avatar saat berbicara terlihat lebih halus, realistis, dan tidak terlalu lebar terbuka secara berlebihan.
* Menghapus gerakan tangan prosedural kustom yang kaku agar avatar kembali ke animasi bawaan model GLB/Live2D aslinya secara natural.

### 4. 🗂️ Arsitektur Git yang Menyatu (Single Repository)
* Modul `frontend` sekarang telah menyatu secara penuh (bukan sebagai submodule terpisah) di dalam repositori ini. Hal ini memudahkan proses kloning, pemeliharaan, dan deployment dalam satu kali langkah tanpa kendala referensi commit submodule yang rusak.

---

## 🚀 Cara Menjalankan Server

1. Pastikan Anda telah menginstal dependensi menggunakan **uv**:
   ```bash
   uv sync
   ```
2. Jalankan aplikasi server:
   ```bash
   uv run run_server.py
   ```
3. Buka browser dan akses alamat yang tertera di terminal (biasanya `http://localhost:12393`).
4. Jika tampilan tombol belum berubah setelah diperbarui, lakukan **Hard Reload** (`Ctrl + F5` atau `Cmd + Shift + R`) pada browser Anda untuk membersihkan cache aset lama.
