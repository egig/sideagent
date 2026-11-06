---
sidebar_position: 13
title: Self-hosting
---

Panduan ini membawa Anda dari nol hingga chat dokumentasi di situs Anda sendiri, dijawab oleh [server sideagent](./server.md) yang Anda jalankan sendiri. Anda mendapat dasbor untuk mengelola agen dan endpoint yang dihubungi situs Anda. Sediakan waktu sekitar 20 menit.

Yang Anda jalankan: Postgres dengan pgvector, dan satu proses Node (admin) yang melayani dasbor, API dasbor, dan endpoint agen `/v1/agents/:id`. Yang Anda siapkan: domain dengan HTTPS, dan kunci API untuk penyedia model yang kompatibel dengan OpenAI.

## 1. Ambil kodenya {#1-get-the-code}

Konfigurasi Docker ada di repositori sideagent.

```sh
git clone https://github.com/egig/sideagent.git
cd sideagent
```

Jika Anda ingin admin berjalan di dalam server Anda sendiri, langsung ke [Menyematkan server di kode Anda sendiri](#embed-the-server-in-your-own-code).

## 2. Atur rahasia {#2-set-the-secrets}

Buat `.env` di sebelah `docker-compose.yml`:

```sh
SIDEAGENT_SECRET=...     # openssl rand -base64 32
POSTGRES_PASSWORD=...    # anything long and random
ADMIN_PUBLIC_URL=https://admin.example.com
```

| Variabel | Fungsinya |
|---|---|
| `SIDEAGENT_SECRET` | Rahasia induk: menandatangani sesi dan membungkus setiap kunci LLM yang tersimpan. Jika diganti, semua orang keluar. **Jika hilang, kunci yang tersimpan tidak dapat dibaca.** Simpan salinannya di luar server. |
| `POSTGRES_PASSWORD` | Berkas compose memakai bawaan `sideagent`. Ganti jika port basis data dapat dijangkau siapa pun. |
| `ADMIN_PUBLIC_URL` | URL persis yang diketik orang di peramban, dengan skema dan tanpa garis miring di akhir. Tautan masuk dan pemeriksaan origin pada penulisan dasbor memakainya. Nilai yang salah: tautan masuk mengarah ke host yang salah dan penyimpanan gagal dengan galat origin. |
| `SIGNUP` | `false` menghentikan pembuatan akun baru. Lihat langkah 4. |

Mode produksi menolak berjalan tanpa `SIDEAGENT_SECRET`.

## 3. Jalankan {#3-start-it}

```sh
docker compose up -d --build
docker compose logs -f admin
```

Tunggu hingga muncul `sideagent on https://admin.example.com`. Migrasi berjalan setiap kali server mulai, jadi tidak ada langkah terpisah. Periksa kesehatannya:

```sh
curl http://localhost:8788/api/health
```

Berkas compose juga membuka Postgres di port host 5433 (`POSTGRES_PORT`). Hapus entri `ports` itu dari layanan `db` jika Anda tidak memerlukannya dari luar Docker.

## 4. Pasang HTTPS di depan {#4-put-https-in-front}

Admin berbicara HTTP biasa di port 8788 (`ADMIN_PORT`). Akhiri TLS di reverse proxy dan arahkan ke sana. Balasan agen berupa server-sent events, jadi matikan buffering untuk rute agen.

```nginx
server {
  server_name admin.example.com;
  # listen 443 ssl; certificates: certbot, Cloudflare, your load balancer

  location / {
    proxy_pass http://127.0.0.1:8788;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
  location /v1/ {
    proxy_pass http://127.0.0.1:8788;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_buffering off;
    proxy_read_timeout 180s;
  }
}
```

Admin membaca alamat klien dari `x-forwarded-for` untuk batas laju. Pastikan proxy Anda menimpa header tersebut, jangan pernah menambahkan ke header yang dikirim klien.

## 5. Buat akun Anda {#5-create-your-account}

Berkas compose tidak memiliki server email, jadi tautan masuk dicetak ke log (`SIDEAGENT_LOG_SIGN_IN_LINKS`):

1. Buka `https://admin.example.com`, masukkan email Anda.
2. Jalankan `docker compose logs admin` dan salin baris `sign-in link for you@example.com: …`.
3. Buka tautan tersebut dan ikuti langkahnya. Tautan hanya dapat dipakai sekali.

Setelah itu, tutup pendaftaran. Secara bawaan, siapa pun yang dapat menjangkau dasbor dapat membuat akun, dan setiap akun berbagi semua agen. Tambahkan `SIGNUP=false` ke `.env` dan jalankan `docker compose up -d`. Akun yang sudah ada tetap dapat masuk; akun baru ditolak. Untuk menambahkan rekan tim nanti, atur `SIGNUP=true`, biarkan mereka masuk sekali, lalu kembalikan pengaturannya.

Untuk masuk dengan GitHub atau Google, atur `GITHUB_CLIENT_ID` dan `GITHUB_CLIENT_SECRET` (atau pasangan Google) dan hapus `SIDEAGENT_LOG_SIGN_IN_LINKS`. Untuk mengirim email sungguhan, [jalankan server Anda sendiri](#embed-the-server-in-your-own-code) dengan `auth.sendMagicLink`.

## 6. Buat agen {#6-create-the-agent}

Di dasbor, pilih **New agent**. Agen dimulai dalam keadaan nonaktif: endpoint-nya menjawab 404 hingga Anda mengaktifkannya. Dasbor membuka halaman **Setup**, lima langkah yang diurutkan sesuai ketergantungannya. Setiap langkah terbuka setelah langkah sebelumnya selesai, dan kemajuannya dibaca dari server, jadi Anda dapat pergi lalu kembali lagi.

1. **Connect a model**. Atur base URL penyedia (kompatibel dengan OpenAI, HTTPS), model chat, model embedding, dan kunci API, simpan, lalu **Test and continue**: satu panggilan chat kecil dan satu panggilan embedding menunjukkan kunci atau model yang salah sebelum pengetahuan gagal diindeks. Model harus mendukung tool calling, karena pencarian pengetahuan adalah sebuah tool. Kunci dienkripsi dan tidak pernah ditampilkan lagi.
2. **Add knowledge**. Tambahkan halaman web (hanya HTTPS publik) atau tempelkan Markdown, serta instruksi opsional. Tunggu hingga setiap sumber berstatus *Indexed*. Sumber yang *Failed* biasanya berarti halamannya tidak publik; menyimpan kunci API baru akan mencoba ulang sumber yang gagal.
3. **Try it**. Buka pratinjau dan ajukan pertanyaan yang akan diajukan pengguna Anda. Langkah ini selesai setelah agen menjawab di sana (atau pilih **Skip for now**).
4. **Deploy to your app**. Daftarkan setiap situs yang menyematkan chat di **Allowed origins**, dengan kecocokan persis termasuk skema dan port, seperti `https://docs.example.com`; `http://localhost:3000` diizinkan untuk pengujian. Di **User auth**, pilih *Nothing, or there is no API* untuk situs dokumentasi publik (siapa pun dapat bertanya dan tidak ada yang diingat), atau mode JWT atau userinfo untuk produk dengan login agar percakapan tetap bersama penggunanya. Kode sematan untuk pilihan Anda ditampilkan di bawahnya.
5. **Go live**. **Activate agent**, lalu kirim pesan dari situs Anda. Langkah ini menunggu permintaan pertama tersebut dan menampilkan permintaan yang ditolak dalam satu jam terakhir, sehingga origin yang salah langsung terlihat.

Pengaturan yang sama tetap dapat diubah nanti di **Knowledge** dan **Settings**.

## 7. Sematkan chat {#7-embed-the-chat}

Salin publishable key dari halaman Overview. Kunci ini publik dan aman berada di peramban.

```sh
npm install sideagent
```

```tsx
import { AgentChat } from "sideagent";

export function Docs() {
  return <AgentChat publishableKey="pk_…" />;
}
```

Kunci tersebut membawa host server dan ID agen, jadi tidak ada lagi yang diperlukan. Lihat [Klien](./client.md) untuk tata letak, tema, dan pengguna yang sudah masuk.

Periksa dari ujung ke ujung:

1. Buka situs Anda dari salah satu origin yang diizinkan dan ajukan pertanyaan yang dapat dijawab oleh pengetahuan Anda.
2. Buka **Audit log** agen di dasbor. Anda seharusnya melihat *Chat turn* dengan hasil *OK*.
3. Baris *Denied* dengan `Origin is not in the allowed list` berarti langkah 6.4 salah: skema, host, atau port berbeda.

## Menjalankannya {#running-it}

**Cadangkan** volume `pgdata` (atau jalankan `pg_dump`) dan `SIDEAGENT_SECRET`. Basis data menyimpan agen, vektor, thread, dan kunci yang disegel. Memulihkan basis data tanpa rahasia yang sama membuat kunci LLM tidak dapat dibaca, dan Anda harus memasukkannya lagi.

**Perbarui** dengan menarik kode baru dan membangun ulang. Migrasi diterapkan saat server mulai dan hanya pernah ditambahkan.

```sh
git pull
docker compose up -d --build
```

**Skala**: pembatas laju dan batas giliran bersamaan berlaku per proses. Dengan beberapa instance admin, masing-masing menghitung sendiri.

**Privasi**: trace (tab Traces) tidak menyimpan teks pada level *Metadata* dan menyimpan teks yang disamarkan pada level *Full content*. Pilih level yang telah disetujui pengguna Anda. Log audit tidak pernah menyimpan teks pesan.

## Menyematkan server di kode Anda sendiri {#embed-the-server-in-your-own-code}

Gunakan ini untuk mengirim email sungguhan, membagi pengguna ke dalam ruang kerja dengan hook `scope`, atau berjalan di runtime lain. Lihat [Server](./server.md): `createServer({ database, publicUrl, secret, auth })`. Dockerfile menjalankan `src/cli.ts`, yang merupakan pembungkus tipis di atasnya.

Basis data memerlukan ekstensi pgvector (`CREATE EXTENSION vector`, yang dilakukan oleh `docker/init.sql`). Postgres terkelola seperti Neon, Supabase, atau RDS menyediakannya.

## Pemecahan masalah {#troubleshooting}

| Gejala | Penyebab |
|---|---|
| Tautan masuk membuka host yang salah | `ADMIN_PUBLIC_URL` tidak sama dengan URL di peramban. |
| Penyimpanan di dasbor gagal dengan galat origin | Penyebab yang sama: penulisan harus membawa origin milik dasbor sendiri. |
| Agen tidak dapat diaktifkan | Ada langkah setup yang belum selesai: model, pengetahuan, origin, atau user auth. Halaman **Setup** menunjukkan yang mana. |
| Sumber pengetahuan tetap *Failed* | Halaman bukan HTTPS publik, atau model embedding atau kuncinya salah. Server sengaja menolak alamat privat. |
| Chat tidak menampilkan apa pun | Agen nonaktif, atau batas harian anonimnya telah tercapai. |
| Galat chat di peramban, *Denied* di log audit | Origin tidak ada di daftar yang diizinkan. |
| Jawaban muncul sekaligus di akhir | Proxy melakukan buffering. Matikan buffering di `/v1/`. |
| Kunci LLM berhenti berfungsi setelah pemulihan atau pemindahan | `SIDEAGENT_SECRET` berbeda dari yang dipakai untuk menyegelnya. |
| Semua orang keluar setelah restart | `SIDEAGENT_SECRET` berubah. |
