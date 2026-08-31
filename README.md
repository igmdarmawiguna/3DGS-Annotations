# PlayCanvas 3D Gaussian Splat + Anotasi

Proyek starter yang menampilkan koleksi 3D Gaussian Splat menggunakan PlayCanvas Engine. Halaman pertama menampilkan galeri kartu berisi semua model di folder `models/`; memilih satu kartu membuka model itu di viewer 3D lengkap dengan sistem anotasi (label teks/marker pada titik tertentu di dalam scene).

Kode ini dibangun berdasarkan panduan resmi PlayCanvas "Using the Engine API" (diverifikasi Agustus 2026), lalu ditambah lapisan galeri dan anotasi HTML yang dibangun sendiri.

## Prasyarat

Cuma butuh **Node.js** terpasang di komputer Anda (versi 18 ke atas; proyek ini dikembangkan dan diuji dengan Node 26). Tidak ada `npm install` atau dependency lain yang perlu dipasang — `server.mjs` dan `scripts/generate-manifest.mjs` murni memakai modul bawaan Node (`node:http`, `node:fs`, `node:path`, `node:url`), dan tidak ada `package.json` di proyek ini.

1. Cek apakah Node.js sudah terpasang:
   ```bash
   node --version
   ```
   Kalau muncul versi (mis. `v26.5.0`), langsung lanjut ke bagian "Cara menjalankan" di bawah.
2. Kalau perintah di atas error/`command not found`, install Node.js dulu:
   - **macOS**: `brew install node` (lewat [Homebrew](https://brew.sh)), atau unduh installer dari [nodejs.org](https://nodejs.org).
   - **Windows**: unduh installer dari [nodejs.org](https://nodejs.org), pilih versi **LTS**.
   - **Linux**: pakai package manager distro (mis. `sudo apt install nodejs npm` di Ubuntu/Debian), atau [nodejs.org](https://nodejs.org) untuk versi terbaru.
3. Buka terminal baru (supaya PATH ter-refresh), lalu cek ulang dengan `node --version` sampai muncul nomor versi.

Setelah itu tinggal jalankan `node server.mjs` seperti biasa — tidak ada langkah instalasi lain.

## Cara menjalankan

```bash
node server.mjs
```

Lalu buka `http://localhost:8000` di browser. Anda akan melihat galeri kartu model dulu, bukan langsung viewer 3D.

`server.mjs` adalah static file server kecil tanpa dependency tambahan (cuma modul bawaan Node), **wajib dipakai** (bukan `python3 -m http.server` atau `npx serve .`) karena ia juga menyediakan endpoint untuk menyimpan anotasi ke file — lihat [Menambahkan anotasi](#menambahkan-anotasi). Kalau Anda hanya ingin melihat-lihat model tanpa perlu menyimpan anotasi baru, server statis biasa tetap bisa dipakai; anotasi yang sudah ada tetap akan terbaca (karena itu cuma file JSON statis), hanya saja anotasi baru tidak akan tersimpan.

Port bisa diganti lewat argumen: `node server.mjs 3000`.

## Menambahkan model splat

1. Taruh file `.ply`, `.splat`, atau `.sog` Anda di folder `models/` (boleh langsung, tidak perlu subfolder).
2. Jalankan generator manifest:
   ```bash
   node scripts/generate-manifest.mjs
   ```
   Script ini memindai folder `models/` dan menulis ulang `models/manifest.json` — daftar yang dibaca galeri untuk menampilkan kartu (judul, format, ukuran file). Judul kartu dibuat otomatis dari nama file (`gedung-tua.ply` → "Gedung Tua"); ganti isi `manifest.json` secara manual kalau ingin judul lain.
3. Refresh browser. Kartu baru akan muncul di galeri.

Jalankan ulang langkah 2 setiap kali menambah atau menghapus file model.

`.ply` didukung langsung oleh PlayCanvas, tidak wajib dikonversi ke `.sog` dulu.

### Tips performa untuk splat berukuran besar (ratusan ribu splat ke atas)

- `app.graphicsDevice.maxPixelRatio = 1` sudah diaktifkan di `main.js`, supaya tidak render di resolusi HiDPI penuh. Hapus baris ini kalau Anda lebih mengutamakan ketajaman visual di layar retina dan splat Anda tidak terlalu berat.
- `antialias: false` juga sudah diaktifkan, karena antialiasing melipatgandakan beban fragment shader yang memang jadi bottleneck utama rendering splat (overdraw dan alpha blending), bukan sekadar jumlah splat.
- Kalau file `.ply` terasa lambat saat **dimuat** (bukan saat render), dan filenya akan diakses lewat internet oleh banyak orang, pertimbangkan konversi ke `.sog` lewat SuperSplat (superspl.at) atau CLI `splat-transform` open source milik PlayCanvas, untuk ukuran unduhan yang lebih kecil.

## Menambahkan anotasi

Di dalam viewer, klik tombol "Mode Tambah Anotasi" di kiri bawah, lalu klik titik yang diinginkan di dalam scene. Sebuah modal akan muncul untuk mengisi judul dan deskripsi. Klik pin yang sudah ada untuk membuka modal yang sama dalam mode edit (bisa ubah judul/deskripsi atau menghapusnya).

Anotasi disimpan sebagai file JSON asli di `models/annotations/<id-model>.json` (mis. `models/annotations/shrine.json`), terpisah per model. Penyimpanan ini butuh `server.mjs` berjalan (bukan static server biasa) karena menulis file lewat endpoint `POST /api/annotations/<id-model>`. File ini boleh di-commit ke git seperti aset biasa, atau diedit manual kalau perlu.

Klik "&larr; Daftar model" di kiri atas untuk kembali ke galeri.

## Catatan penting tentang keterbatasan

PlayCanvas Engine belum punya fitur raycast bawaan ke permukaan gaussian splat (berbeda dari mesh 3D biasa). Untuk mengakalinya, mode "klik untuk menambah anotasi" mengambil data mentah splat (`gsplatData.getCenters()` — posisi asli tiap titik gaussian) lalu mencari titik yang paling dekat dengan garis ray dari klik Anda, dengan mengutamakan titik terdepan (paling dekat ke kamera) supaya tidak salah pilih titik yang sebenarnya tertutup oleh permukaan lain. Ini cukup akurat karena menempel ke titik gaussian sungguhan, bukan sekadar perkiraan bentuk.

Kalau di area yang diklik titik gaussian-nya sangat jarang (misalnya bagian model yang tipis/berlubang) sehingga tidak ada yang cukup dekat dengan ray, sistem jatuh ke fallback berjenjang: uji tabrakan dengan bounding box data splat, lalu kalau itu juga gagal, taruh titik pada bidang datar sejauh jarak kamera-ke-pusat-splat (fallback paling kasar, jarang kepakai). Kalau hasilnya masih meleset, buka DevTools console untuk menyalin koordinat anotasi yang baru dibuat lalu sesuaikan secara manual.

Untuk presisi lebih tinggi lagi (mis. anotasi mengikuti bentuk permukaan yang sangat detail/berlubang), pertimbangkan menentukan koordinat secara manual lewat SuperSplat, yang mendukung anotasi bawaan untuk splat yang dipublikasikan lewat platform tersebut.

## Struktur file

- `index.html` — kerangka halaman: galeri kartu, viewer, modal anotasi, styling, dan import map PlayCanvas.
- `main.js` — render galeri dari manifest, inisialisasi/penghancuran aplikasi PlayCanvas saat pindah model, kamera orbit, modal tambah/edit/hapus anotasi, dan penyimpanan anotasi ke file lewat `server.mjs`.
- `server.mjs` — static file server + endpoint `POST /api/annotations/<id-model>` untuk menyimpan anotasi ke file.
- `models/` — folder berisi file splat (`.ply`/`.splat`/`.sog`), `manifest.json` (dibuat otomatis), dan `annotations/*.json` (dibuat otomatis saat anotasi pertama disimpan).
- `scripts/generate-manifest.mjs` — scanner folder `models/` yang menulis `models/manifest.json`.
