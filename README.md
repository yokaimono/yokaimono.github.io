# Trading Journal — Website + Termux CLI V4.0 Pixel Terminal

Trading Journal statis dengan dashboard web dan CLI V4.0 (command-line interface) yang dapat digunakan dari **Termux di HP Android**. CLI V4.0 memiliki dashboard terminal berwarna yang menyesuaikan lebar layar HP, menu satu kolom pada terminal sempit, ringkasan statistik vertikal, dan grafik equity berbasis karakter yang lebih jelas untuk satu atau banyak trade. Website tetap publik untuk dibaca, sedangkan perubahan jurnal hanya diizinkan setelah Cloudflare Worker memverifikasi sesi akun GitHub pemilik.

> **PENTING — PRIVASI:** repository ini publik. Isi `trades.json` dan riwayat commit bisa dibaca siapa saja. Jangan simpan password, nomor akun broker, API key, token, atau catatan pribadi yang tidak ingin dipublikasikan di repository ini.

## Isi paket

- `index.html` — dashboard Trading Journal.
- `trades.json` — data trade yang dipakai website dan CLI.
- `worker.js` — Cloudflare Worker untuk API jurnal, login website, dan login CLI.
- `tj.mjs` — CLI V4.0 untuk Termux dengan dashboard, menu interaktif, warna terminal, dan grafik equity sederhana; tidak memerlukan library Node.js tambahan.
- `README.md` — panduan instalasi dan penggunaan.
- `.github/workflows/deploy-worker.yml` — workflow deploy Worker jika konfigurasi GitHub Actions sudah tersedia.
- `wrangler.toml` — konfigurasi proyek Worker.

## Tampilan CLI V4.0

Jalankan `node tj.mjs` tanpa argumen untuk membuka dashboard dan menu interaktif. Tampilan otomatis memakai satu kolom pada terminal HP yang sempit agar teks tidak saling bertabrakan; terminal lebar akan memakai menu dua kolom. Prompt menu tidak memilih opsi secara otomatis jika kamu hanya menekan Enter. Dari menu, pilih angka yang sesuai:

- `1` — Tambah trade dengan formulir terpandu.
- `2` — Lihat riwayat trade.
- `3` — Statistik trade CLOSED.
- `4` — Periksa koneksi Worker dan sesi.
- `5` — Login GitHub.
- `6` — Logout lokal.
- `7` — Edit trade berdasarkan ID.
- `8` — Hapus trade berdasarkan ID.
- `0` — Keluar.

CLI juga mendukung perintah langsung, misalnya `node tj.mjs add`, `node tj.mjs list`, atau `node tj.mjs stats`. Warna terminal dapat dimatikan dengan `NO_COLOR=1 node tj.mjs`. Grafik equity hanya visualisasi ringkas dari akumulasi P&L trade CLOSED, bukan grafik harga pasar.

---

## Cara kerja

1. Website GitHub Pages menampilkan dashboard.
2. CLI berjalan di Termux menggunakan Node.js.
3. CLI login melalui **GitHub Device Flow**: GitHub menampilkan kode yang kamu konfirmasi sendiri di browser.
4. Cloudflare Worker memeriksa bahwa akun GitHub yang menyetujui login sama dengan `GITHUB_OWNER_USERNAME`.
5. CLI mengirim perubahan ke API Worker menggunakan sesi bertanda tangan. Worker memperbarui `trades.json` melalui GitHub API.
6. Website dan CLI menggunakan sumber data yang sama. Muat ulang website untuk melihat perubahan terbaru.

CLI tidak membutuhkan GitHub repository token (PAT) di HP. `GITHUB_REPO_TOKEN` tetap disimpan sebagai secret Cloudflare Worker.

---

# BAGIAN A — Siapkan Cloudflare Worker untuk CLI (sekali saja)

## 1. Aktifkan GitHub Device Flow

1. Buka GitHub dan masuk ke akun pemilik.
2. Buka **Settings → Developer settings → OAuth Apps**.
3. Pilih OAuth App yang saat ini digunakan Trading Journal.
4. Cari pengaturan **Enable Device Flow** dan aktifkan, lalu simpan.
5. Pastikan Client ID aplikasi tersebut sama dengan nilai `GITHUB_OAUTH_CLIENT_ID` di Cloudflare Worker.

Nama menu dapat sedikit berbeda menurut tampilan GitHub. Jangan membuat OAuth App baru jika aplikasi lama masih bisa digunakan.

## 2. Perbarui Worker

1. Pastikan file `worker.js` terbaru dari paket ini sudah berada di repository.
2. Commit perubahan ke branch `main` agar workflow `.github/workflows/deploy-worker.yml` menjalankan deployment, jika workflow sudah dikonfigurasi.
3. Buka Cloudflare Dashboard → Workers & Pages → Worker Trading Journal.
4. Pastikan deployment terbaru berhasil. Jika workflow tidak digunakan, perbarui isi Worker secara manual dari `worker.js` lalu deploy.
5. Jangan menghapus variable/secret yang sudah digunakan website.

Worker harus memiliki variable dan secret yang sudah dipakai website:

**Variables**

- `GITHUB_OAUTH_CLIENT_ID` — Client ID OAuth App.
- `GITHUB_OWNER` — username pemilik repository.
- `GITHUB_REPO` — nama repository jurnal.
- `GITHUB_OWNER_USERNAME` — username GitHub yang diizinkan mengubah jurnal.
- `GITHUB_BRANCH` — biasanya `main`.
- `PAGES_ORIGIN` — origin website, misalnya `https://yokaimono.github.io` (tanpa slash akhir).
- `PAGES_PATH` — `/` untuk `yokaimono.github.io`.
- `WORKER_ORIGIN` — URL Worker, misalnya `https://tradingjurnal.yangsudahbolehpulang.workers.dev`.

**Secrets**

- `GITHUB_OAUTH_CLIENT_SECRET` — secret OAuth untuk login website.
- `GITHUB_REPO_TOKEN` — fine-grained token dengan izin `Contents: Read and write` untuk repository jurnal.
- `SESSION_SECRET` — secret acak yang kuat, minimal 32 karakter.

Jangan tempel nilai secret ke `README.md`, `index.html`, atau `tj.mjs`.

## 3. Uji Worker

Buka alamat ini di browser:

`https://tradingjurnal.yangsudahbolehpulang.workers.dev/api/health`

Worker harus mengembalikan JSON dengan `"ok":true`. Health check hanya menguji respons Worker, bukan keseluruhan login dan penyimpanan.

---

# BAGIAN B — Instalasi di Termux (HP Android)

## 1. Instal Node.js dan curl

Buka Termux, lalu jalankan satu per satu:

```bash
pkg update
pkg install nodejs-lts curl
```

Jika Termux tidak menemukan paket `nodejs-lts`, coba `pkg install nodejs curl`.

Periksa instalasi:

```bash
node --version
npm --version
```

Gunakan Node.js versi 18 atau lebih baru.

## 2. Unduh CLI

Jalankan perintah berikut. Ini membuat folder khusus dan mengunduh file CLI dari repository publik:

```bash
mkdir -p ~/trading-journal
cd ~/trading-journal
curl -fsSL https://raw.githubusercontent.com/yokaimono/yokaimono.github.io/main/tj.mjs -o tj.mjs
```

> Perintah unduh ini bekerja setelah `tj.mjs` sudah di-commit dan tersedia di branch `main`. Jika repository menggunakan branch lain, ganti `main` sesuai nama branch tersebut.

Periksa file:

```bash
ls -l tj.mjs
node tj.mjs help
```

Tidak perlu menjalankan `npm install`; CLI menggunakan modul bawaan Node.js.

## 3. Login GitHub (biasanya sekali setiap sesi kedaluwarsa)

```bash
node tj.mjs login
```

CLI akan menampilkan kode sekali pakai, misalnya `ABCD-1234`, dan alamat `https://github.com/login/device`.

1. Buka alamat yang ditampilkan. Termux mungkin otomatis membuka browser.
2. Masukkan kode yang muncul di terminal.
3. Login dengan **akun GitHub pemilik jurnal** dan setujui permintaan.
4. Kembali ke Termux. CLI akan menunggu persetujuan dan memberi tahu jika login berhasil.

Sesi CLI berlaku sekitar **8 jam**. Kode login memiliki masa berlaku lebih singkat; jika kedaluwarsa, jalankan perintah login lagi. Akun GitHub lain akan ditolak.

Token sesi disimpan lokal di `~/.config/trading-journal/config.json` dengan izin file terbatas. Jangan bagikan file tersebut. Untuk menghapus token lokal:

```bash
node tj.mjs logout
```

## 4. Buka dashboard terminal

```bash
node tj.mjs
```

Pilih nomor menu yang ditampilkan. Pilihan `1` membuka formulir tambah trade; pilihan `2` menampilkan riwayat. Kamu tetap bisa menggunakan perintah langsung seperti `node tj.mjs add`.

## 5. Periksa status

```bash
node tj.mjs status
```

Perintah ini memeriksa status Worker dan apakah sesi login masih berlaku.

---

# BAGIAN C — Menulis jurnal lewat terminal

## 1. Mulai formulir jurnal

```bash
node tj.mjs add
```

CLI akan menanyakan kolom satu per satu. Jawab pada baris setelah tanda `>`. Setiap pertanyaan menyertakan contoh agar kamu tidak bingung.

Contoh tampilan (contoh ini bukan data yang otomatis tersimpan):

```text
TAMBAH JURNAL BARU
Date / tanggal dan jam (contoh: 2026-10-25T14:30) [2026-10-25T14:30]
>
Symbol (contoh: NAS100)
> NAS100
Direction / arah — pilihan: LONG/SHORT (contoh: LONG / SHORT) [LONG]
> SHORT
Setup / strategi (contoh: Breakout retest)
> Trend continuation
Entry price (contoh: 24500)
> 24500
Exit price (contoh: 24600 (kosongkan jika posisi masih terbuka))
> 24420
Lot size / ukuran posisi (contoh: 0.10)
> 0.10
Risk / risiko uang (contoh: 10)
> 10
P&L / hasil uang (boleh minus) (contoh: 20.57) [0]
> -8.00
Currency / mata uang (contoh: USD) [USD]
> USD
Fees / biaya (contoh: 0) [0]
> 0
Status posisi — pilihan: CLOSED/OPEN (contoh: CLOSED / OPEN) [CLOSED]
> CLOSED
Risk-reward (R) (contoh: 2 berarti hasil 2R)
> -0.8
Emotion / emosi (contoh: Calm / Tenang)
> Ragu-ragu
Notes / catatan (contoh: Entry sesuai SOP pada timeframe M15)
> Struktur kurang jelas di M15
Review / pelajaran (contoh: Tunggu konfirmasi sebelum entry)
> Jangan memaksakan entry
Simpan jurnal ini? ketik YA untuk menyimpan [YA]
> YA
```

### Arti kolom

- **Date:** tanggal dan waktu trade, format yang disarankan `YYYY-MM-DDTHH:MM`, misalnya `2026-10-25T14:30`.
- **Symbol:** instrumen, misalnya `NAS100`, `XAUUSD`, `EURUSD`, atau ticker crypto.
- **Direction:** `LONG` untuk posisi beli atau `SHORT` untuk posisi jual.
- **Setup:** nama strategi atau setup trading.
- **Entry price / Exit price:** harga masuk dan keluar. Jika posisi masih terbuka, Exit boleh dikosongkan.
- **Lot size:** ukuran posisi; masukkan sebagai teks seperti `0.10`.
- **Risk:** jumlah uang yang dirisikokan.
- **P&L:** hasil uang untuk trade; angka positif untuk profit, negatif untuk loss. Contoh `20.57` atau `-8.00`.
- **Currency:** mata uang hasil, misalnya `USD`.
- **Fees:** biaya yang dicatat untuk informasi.
- **Status:** `CLOSED` jika sudah ditutup atau `OPEN` jika masih terbuka.
- **Risk-reward (R):** hasil dalam satuan R, misalnya `2` untuk +2R atau `-1` untuk -1R.
- **Emotion:** kondisi emosi saat trading.
- **Notes:** alasan entry, struktur pasar, timeframe, dan hal yang diamati.
- **Review:** evaluasi dan pelajaran setelah trade.

Nilai P&L dimasukkan manual. Pastikan nilai dan mata uang konsisten dengan cara kamu mencatat trade di website. Untuk posisi terbuka, isi status `OPEN`; jangan menganggap P&L belum terealisasi sebagai hasil final.

Setelah semua kolom terisi, CLI menampilkan ringkasan. Ketik `YA` untuk mengirim atau jawaban lain untuk membatalkan. Setelah sukses, data diperbarui di GitHub dan dapat dilihat di website setelah halaman dimuat ulang.

## 2. Lihat daftar jurnal

```bash
node tj.mjs list
```

Daftar menampilkan ID singkat, tanggal, symbol, arah, dan P&L. Catat ID singkat untuk melihat, mengedit, atau menghapus trade.

## 3. Lihat detail trade

```bash
node tj.mjs show ID
```

Ganti `ID` dengan ID singkat dari daftar, misalnya:

```bash
node tj.mjs show aa8dbcdd
```

## 4. Edit trade

```bash
node tj.mjs edit ID
```

CLI akan menanyakan kolom yang bisa diedit. Tekan Enter untuk mempertahankan nilai lama yang ditampilkan dalam tanda kurung siku.

## 5. Hapus trade

```bash
node tj.mjs delete ID
```

Periksa ringkasan trade yang akan dihapus. Penghapusan hanya dilakukan jika kamu mengetik `HAPUS` sebagai konfirmasi.

## 6. Statistik

```bash
node tj.mjs stats
```

Menampilkan jumlah trade `CLOSED`, jumlah menang/kalah, win rate, net P&L, dan profit factor. Perhitungan ini memakai P&L yang tersimpan dan mengasumsikan nilai P&L sudah dicatat sesuai konvensi jurnalmu.

## 7. Bantuan

```bash
node tj.mjs help
```

---

# Pemecahan masalah

- **`Worker belum dikonfigurasi`:** periksa variable dan secret wajib di Cloudflare Worker.
- **`GitHub Device Flow gagal dimulai`:** pastikan Device Flow aktif di pengaturan OAuth App dan Client ID benar.
- **Kode login tidak diterima / kedaluwarsa:** mulai ulang `node tj.mjs login`, lalu gunakan kode baru.
- **`Akun GitHub ini bukan pemilik jurnal`:** periksa `GITHUB_OWNER_USERNAME` di Cloudflare. Harus sama dengan username akun pemilik yang login.
- **`Unauthorized`:** jalankan `node tj.mjs login` kembali. Sesi biasanya berlaku 8 jam.
- **`Origin tidak diizinkan`:** perbarui `worker.js` ke versi CLI terbaru dan deploy ulang. Worker tetap menolak permintaan browser dari origin yang tidak diizinkan; permintaan CLI harus membawa bearer session yang valid.
- **GitHub API 401/403:** periksa `GITHUB_REPO_TOKEN` dan izin `Contents: Read and write` di Cloudflare.
- **GitHub API 404:** periksa `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_BRANCH`, dan keberadaan `trades.json` di root repository.
- **File CLI tidak ditemukan:** pastikan berada di folder `~/trading-journal` dengan `cd ~/trading-journal`.
- **Website belum menampilkan trade baru:** muat ulang website dan periksa apakah commit perubahan `trades.json` muncul di GitHub.

## Catatan keamanan dan batasan

- Repository publik membuat data jurnal dan histori commit terlihat publik.
- Jangan masukkan secret repository ke CLI. Token sesi CLI disimpan lokal di HP; jangan membagikan file konfigurasi CLI.
- Worker memvalidasi akun GitHub saat proses Device Flow. Token sesi CLI ditandatangani Worker dan memiliki masa berlaku terbatas.
- Pemeriksaan CORS/Origin bukan pengganti autentikasi. Endpoint penulisan tetap membutuhkan sesi pemilik yang valid.
- Pengeditan serentak melalui website dan CLI dapat menimbulkan konflik penulisan. Hindari menyimpan perubahan dari dua tempat pada saat bersamaan.
- Uji health check, login Device Flow, penambahan data dummy, dan tampilan website setelah deployment. Pengujian lokal tidak membuktikan deployment Cloudflare berhasil.


## Trading Journal CLI V4.1 — Mobile Polish

Versi V4.1 memoles tampilan terminal agar lebih nyaman di Termux Android:

- Header menampilkan versi V4.1 dan menyesuaikan lebar terminal.
- Statistik dan menu memakai satu kolom pada terminal sempit agar tidak bertabrakan.
- Tampilan desktop/terminal lebar tetap menggunakan layout ringkas dua kolom.
- Perintah dan API tetap kompatibel dengan versi sebelumnya; data jurnal dan sesi login lokal tidak perlu dihapus.

### Memperbarui CLI di Termux

Setelah `tj.mjs` V4.1 di-commit ke branch `main`, jalankan:

```bash
cd ~/trading-journal
curl -fsSL https://raw.githubusercontent.com/yokaimono/yokaimono.github.io/main/tj.mjs -o tj.mjs
node tj.mjs
```

Pembaruan tampilan tidak memerlukan logout. Jika tampilan belum berubah, pastikan file `tj.mjs` V4.1 sudah benar-benar masuk ke branch `main`, lalu unduh ulang file tersebut.
