# Trading Journal — Terminal Edition

Trading journal statis bergaya terminal retro 8-bit. Website dibaca publik; hanya akun GitHub pemilik yang diizinkan mengubah catatan melalui Cloudflare Worker.

> **Penting:** repository ini publik. Semua isi file repository, termasuk `trades.json` dan riwayat commit, dapat dilihat siapa saja. Jangan masukkan data rahasia, nomor akun, password, API key, data broker sensitif, atau informasi pribadi.

## Isi paket

- `index.html` — antarmuka responsif, dashboard, jurnal, statistik, filter, grafik, backup/restore.
- `worker.js` — Cloudflare Worker untuk membaca/menulis `trades.json` dan login GitHub OAuth.
- `trades.json` — data jurnal awal kosong.
- `wrangler.toml.example` — contoh konfigurasi Worker.
- `.gitignore` — mengabaikan file lokal umum.

## Arsitektur

- GitHub Pages menayangkan `index.html`.
- Cloudflare Worker mengelola OAuth dan memverifikasi sesi pemilik.
- Worker menggunakan GitHub fine-grained Personal Access Token (PAT) untuk membaca dan memperbarui `trades.json`.
- Browser tidak pernah menerima token GitHub repository.

## A. Buat repository

1. Di GitHub, buat **repository baru** khusus jurnal ini.
2. Pilih **Public** (sesuai pilihan kita).
3. Jangan aktifkan template atau masukkan secret ke repository.
4. Upload `index.html`, `trades.json`, `worker.js`, `README.md`, `.gitignore`, dan `wrangler.toml.example`.
5. Ganti `OWNER_USERNAME` pada konfigurasi nanti dengan username GitHub kamu yang tepat.

## B. Aktifkan GitHub Pages

1. Buka repository → **Settings** → **Pages**.
2. Pada Build and deployment pilih **Deploy from a branch**.
3. Branch `main`, folder `/(root)`, lalu **Save**.
4. Tunggu sampai URL Pages muncul, biasanya `https://USERNAME.github.io/REPOSITORY/`.
5. Catat URL persisnya; masukkan sebagai `PAGES_ORIGIN` di Worker. Untuk project Pages di subpath, `PAGES_ORIGIN` tetap origin saja, misalnya `https://USERNAME.github.io`. Di OAuth callback redirect, Worker perlu mengembalikan pengguna ke path repo. Untuk konfigurasi paling mudah dan aman, pertahankan URL project Pages dan sesuaikan `PAGES_PATH` di worker bila deploy pada subpath.

## C. Buat GitHub OAuth App

1. GitHub → Settings → Developer settings → OAuth Apps → New OAuth App.
2. Homepage URL: URL GitHub Pages kamu.
3. Authorization callback URL: `https://NAMA-WORKER.SUBDOMAIN.workers.dev/auth/callback`.
4. Buat app dan catat Client ID.
5. Generate Client Secret. Jangan masukkan Client Secret ke `index.html` atau repository.

OAuth ini hanya untuk mengenali akun GitHub yang login. Token repository yang dipakai Worker adalah secret terpisah.

## D. Buat token repository terbatas

1. GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens.
2. Resource owner: akun pemilik repository.
3. Repository access: **Only select repositories**, pilih repository jurnal baru.
4. Repository permissions: **Contents: Read and write**. Metadata read biasanya diberikan otomatis.
5. Generate token dan simpan hanya sebagai Cloudflare Worker secret.
6. Jangan pernah menaruh PAT dalam HTML, README, screenshot, atau chat.

## E. Deploy Cloudflare Worker

Buat Worker baru di dashboard Cloudflare, lalu tempel isi `worker.js`.

Tambahkan **Variables** (bukan rahasia):
- `GITHUB_OAUTH_CLIENT_ID` — OAuth Client ID
- `GITHUB_OWNER` — username pemilik repository
- `GITHUB_REPO` — nama repository baru
- `GITHUB_OWNER_USERNAME` — username yang boleh mengedit
- `GITHUB_BRANCH` — `main`
- `PAGES_ORIGIN` — origin persis dari Pages, tanpa slash di akhir
- `PAGES_PATH` — path website Pages; untuk repo project gunakan `/NAMA-REPOSITORY/`, untuk situs user/organisasi di root gunakan `/`
- `WORKER_ORIGIN` — URL Worker, mis. `https://nama-worker.username.workers.dev`

Tambahkan **Secrets**:
- `GITHUB_OAUTH_CLIENT_SECRET`
- `GITHUB_REPO_TOKEN`
- `SESSION_SECRET` — string acak kuat, minimal 32 karakter

Contoh membuat `SESSION_SECRET` yang kuat dapat dilakukan di password manager. Jangan gunakan password utama akun.

Pastikan callback OAuth di pengaturan GitHub sama persis dengan `WORKER_ORIGIN/auth/callback`.

## F. Hubungkan HTML ke Worker

Di `index.html`, cari baris:

```js
const API_BASE = 'https://REPLACE-WITH-YOUR-WORKER.workers.dev';
```

Ganti dengan URL Worker kamu yang sebenarnya. Simpan dan commit perubahan. Jangan menambahkan token atau secret ke baris ini.

### Catatan penting tentang URL Pages

Project Pages biasa umumnya berada di subpath `https://USERNAME.github.io/REPOSITORY/`, sedangkan `PAGES_ORIGIN` adalah `https://USERNAME.github.io`. Worker perlu mengarahkan callback sukses/gagal kembali ke path project tersebut. Worker mendukung variable `PAGES_PATH` untuk redirect OAuth. Untuk repository Pages di subpath, set `PAGES_PATH=/NAMA-REPOSITORY/`; untuk situs Pages pada root, set `/`.

## G. Checklist pengujian sebelum dipakai

- [ ] `GET /api/health` merespons `ok: true`.
- [ ] `GET /api/trades` menampilkan array kosong pada instalasi baru.
- [ ] Website menampilkan data tanpa login.
- [ ] Login menggunakan akun pemilik yang benar berhasil.
- [ ] Akun GitHub lain ditolak dan tidak memperoleh sesi owner.
- [ ] Permintaan `PUT /api/trades` tanpa sesi owner ditolak `401`.
- [ ] Setelah menambah trade, isi `trades.json` di repository berubah.
- [ ] Refresh halaman tetap menampilkan trade yang sama.
- [ ] Ekspor JSON/CSV dan impor JSON diuji dengan data dummy.
- [ ] Uji dari browser Android.
- [ ] Periksa GitHub commit history: tidak ada token atau secret yang pernah terunggah.

## Batasan dan keamanan

- Data pada repository publik benar-benar publik, termasuk histori commit.
- P&L dihitung dari nilai yang diinput manual. Aplikasi bukan integrasi broker.
- Net P&L mengasumsikan nilai `pnl` yang dimasukkan sudah net; kolom biaya hanya catatan informatif agar biaya tidak terpotong dua kali.
- Profit factor tidak terdefinisi bila belum ada gross loss; UI menampilkan `∞` jika ada gross profit tanpa loss, dan `—` jika belum ada profit maupun loss.
- Worker menggunakan cookie sesi `HttpOnly; Secure`; browser perlu mengizinkan third-party cookies lintas origin agar cookie sesi Worker dapat terkirim dari GitHub Pages. Jika browser memblokirnya, gunakan domain kustom satu situs untuk Pages dan Worker atau revisi arsitektur sesi.
- Worker menggunakan pemeriksaan Origin/CORS, tetapi CORS bukan pengganti autentikasi. Otorisasi dilakukan di Worker.
- Untuk menghindari benturan update bersamaan, implementasi ini membaca SHA file terbaru sebelum menulis. Pada penggunaan multi-editor atau banyak update simultan, tambahkan mekanisme konflik/retry.
- Paket ini belum terhubung ke akun GitHub/Cloudflare kamu dan belum dideploy. Pengujian lokal kode tidak membuktikan OAuth/deployment berhasil.

## Pemecahan masalah

- **Worker belum dikonfigurasi:** periksa variable dan secret yang wajib.
- **CORS error:** `PAGES_ORIGIN` harus cocok dengan origin halaman, tanpa path dan tanpa trailing slash.
- **GitHub API 404:** pastikan owner/repo/branch benar dan `trades.json` ada pada root.
- **GitHub API 401/403:** periksa PAT dan izin `Contents: Read and write`.
- **Login kembali ke halaman yang salah:** atur `PAGES_PATH` untuk repository Pages yang berada di subpath dan sesuaikan `safeReturn()`.
- **Login berhasil tapi mode owner tidak aktif:** periksa username pemilik, callback URL, dan dukungan cookie lintas situs di browser.
