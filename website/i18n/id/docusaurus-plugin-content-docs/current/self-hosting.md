---
sidebar_position: 13
title: Self-hosting
---

Panduan ini membawa Anda dari nol hingga chat dokumentasi di situs Anda sendiri, dijawab oleh [server sideagent](./server.md) yang Anda jalankan sendiri. Anda mendapat dashboard untuk mengelola agent dan endpoint yang dihubungi situs Anda. Sediakan waktu sekitar 20 menit.

Yang Anda jalankan: Postgres dengan pgvector, dan satu proses Node (admin) yang melayani dashboard, API dashboard, dan endpoint agent `/v1/agents/:id`. Yang Anda siapkan: domain dengan HTTPS, dan API key untuk model provider yang kompatibel dengan OpenAI.

## 1. Ambil kodenya {#1-get-the-code}

Konfigurasi Docker ada di repository sideagent.

```sh
git clone https://github.com/egig/sideagent.git
cd sideagent
```

Jika Anda ingin admin berjalan di dalam server Anda sendiri, langsung ke [Menyematkan server di kode Anda sendiri](#embed-the-server-in-your-own-code).

## 2. Atur secret {#2-set-the-secrets}

Buat `.env` di sebelah `docker-compose.yml`:

```sh
SIDEAGENT_SECRET=...     # openssl rand -base64 32
POSTGRES_PASSWORD=...    # anything long and random
ADMIN_PUBLIC_URL=https://admin.example.com
```

| Variable | Fungsinya |
|---|---|
| `SIDEAGENT_SECRET` | Master secret: menandatangani session dan membungkus setiap LLM key yang tersimpan. Jika diganti, semua orang sign-out. **Jika hilang, key yang tersimpan tidak dapat dibaca.** Simpan salinannya di luar server. |
| `POSTGRES_PASSWORD` | File compose memakai bawaan `sideagent`. Ganti jika port database dapat dijangkau siapa pun. |
| `ADMIN_PUBLIC_URL` | URL persis yang diketik orang di browser, dengan scheme dan tanpa garis miring di akhir. Sign-in link dan pemeriksaan origin pada penulisan dashboard memakainya. Nilai yang salah: sign-in link mengarah ke host yang salah dan penyimpanan gagal dengan error origin. |
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

File compose juga membuka Postgres di port host 5433 (`POSTGRES_PORT`). Hapus entri `ports` itu dari layanan `db` jika Anda tidak memerlukannya dari luar Docker.

## 4. Pasang HTTPS di depan {#4-put-https-in-front}

Admin berbicara HTTP biasa di port 8788 (`ADMIN_PORT`). Akhiri TLS di reverse proxy dan arahkan ke sana. Balasan agent berupa server-sent events, jadi matikan buffering untuk rute agent.

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

Admin membaca alamat client dari `x-forwarded-for` untuk rate limit. Pastikan proxy Anda menimpa header tersebut, jangan pernah menambahkan ke header yang dikirim client.

## 5. Buat akun Anda {#5-create-your-account}

File compose tidak memiliki server email, jadi sign-in link dicetak ke log (`SIDEAGENT_LOG_SIGN_IN_LINKS`):

1. Buka `https://admin.example.com`, masukkan email Anda.
2. Jalankan `docker compose logs admin` dan salin baris `sign-in link for you@example.com: …`.
3. Buka tautan tersebut dan ikuti langkahnya. Tautan hanya dapat dipakai sekali.

Setelah itu, tutup sign-up. Secara bawaan, siapa pun yang dapat menjangkau dashboard dapat membuat akun, dan setiap akun berbagi semua agent. Tambahkan `SIGNUP=false` ke `.env` dan jalankan `docker compose up -d`. Akun yang sudah ada tetap dapat sign-in; akun baru ditolak. Untuk menambahkan rekan tim nanti, atur `SIGNUP=true`, biarkan mereka sign-in sekali, lalu kembalikan pengaturannya.

Untuk sign-in dengan GitHub atau Google, atur `GITHUB_CLIENT_ID` dan `GITHUB_CLIENT_SECRET` (atau pasangan Google) dan hapus `SIDEAGENT_LOG_SIGN_IN_LINKS`. Untuk mengirim email sungguhan, [jalankan server Anda sendiri](#embed-the-server-in-your-own-code) dengan `auth.sendMagicLink`.

## 6. Buat agent {#6-create-the-agent}

Di dashboard, pilih **New agent**. Agent dimulai dalam keadaan nonaktif: endpoint-nya menjawab 404 hingga Anda mengaktifkannya. Dashboard membuka halaman **Setup**, lima langkah yang diurutkan sesuai ketergantungannya. Setiap langkah terbuka setelah langkah sebelumnya selesai, dan kemajuannya dibaca dari server, jadi Anda dapat pergi lalu kembali lagi.

1. **Connect a model**. Atur base URL provider (kompatibel dengan OpenAI, HTTPS), model chat, model embedding, dan API key, simpan, lalu **Test and continue**: satu panggilan chat kecil dan satu panggilan embedding menunjukkan key atau model yang salah sebelum Knowledge Base gagal diindeks. Model harus mendukung tool calling, karena knowledge search adalah sebuah tool. Key dienkripsi dan tidak pernah ditampilkan lagi.
2. **Add knowledge**. Tambahkan halaman web (hanya HTTPS publik) atau tempelkan Markdown, serta instruksi opsional. Tunggu hingga setiap sumber berstatus *Indexed*. Sumber yang *Failed* biasanya berarti halamannya tidak publik; menyimpan API key baru akan mencoba ulang sumber yang gagal.
3. **Try it**. Buka preview dan ajukan pertanyaan yang akan diajukan pengguna Anda. Langkah ini selesai setelah agent menjawab di sana (atau pilih **Skip for now**).
4. **Deploy to your app**. Daftarkan setiap situs yang menyematkan chat di **Allowed origins**, dengan kecocokan persis termasuk scheme dan port, seperti `https://docs.example.com`; `http://localhost:3000` diizinkan untuk pengujian. Di **User auth**, pilih *Nothing, or there is no API* untuk situs dokumentasi publik (siapa pun dapat bertanya dan tidak ada yang diingat), atau mode JWT atau userinfo untuk produk dengan login agar percakapan tetap bersama penggunanya. Embed code untuk pilihan Anda ditampilkan di bawahnya.
5. **Go live**. **Activate agent**, lalu kirim pesan dari situs Anda. Langkah ini menunggu request pertama tersebut dan menampilkan request yang ditolak dalam satu jam terakhir, sehingga origin yang salah langsung terlihat.

Pengaturan yang sama tetap dapat diubah nanti di **Knowledge** dan **Settings**.

## 7. Sematkan chat {#7-embed-the-chat}

Salin publishable key dari halaman Overview. Key ini publik dan aman berada di browser.

```sh
npm install sideagent
```

```tsx
import { AgentChat } from "sideagent";

export function Docs() {
  return <AgentChat publishableKey="pk_…" />;
}
```

Key tersebut membawa host server dan ID agent, jadi tidak ada lagi yang diperlukan. Lihat [Client](./client.md) untuk layout, theming, dan pengguna yang sudah sign-in.

Periksa dari ujung ke ujung:

1. Buka situs Anda dari salah satu origin yang diizinkan dan ajukan pertanyaan yang dapat dijawab oleh Knowledge Base Anda.
2. Buka **Audit log** agent di dashboard. Anda seharusnya melihat *Chat turn* dengan hasil *OK*.
3. Baris *Denied* dengan `Origin is not in the allowed list` berarti langkah 6.4 salah: scheme, host, atau port berbeda.

## Menjalankannya {#running-it}

**Cadangkan** volume `pgdata` (atau jalankan `pg_dump`) dan `SIDEAGENT_SECRET`. Database menyimpan agent, vector, thread, dan key yang disegel. Memulihkan database tanpa secret yang sama membuat LLM key tidak dapat dibaca, dan Anda harus memasukkannya lagi.

**Perbarui** dengan menarik kode baru dan membangun ulang. Migrasi diterapkan saat server mulai dan hanya pernah ditambahkan.

```sh
git pull
docker compose up -d --build
```

**Skala**: rate limiter dan batas turn bersamaan berlaku per proses. Dengan beberapa instance admin, masing-masing menghitung sendiri.

**Privasi**: trace (dibuka dari sebuah turn di **Audit log**, tempat Anda juga mengatur level) tidak menyimpan teks pada level *Metadata* dan menyimpan teks yang disamarkan pada level *Full content*. Pilih level yang telah disetujui pengguna Anda. Audit log tidak pernah menyimpan teks pesan.

## Menyematkan server di kode Anda sendiri {#embed-the-server-in-your-own-code}

Gunakan ini untuk mengirim email sungguhan, membagi pengguna ke dalam workspace dengan hook `scope`, atau berjalan di runtime lain. Lihat [Server](./server.md): `createServer({ database, publicUrl, secret, auth })`. Dockerfile menjalankan `src/cli.ts`, yang merupakan pembungkus tipis di atasnya.

Database memerlukan ekstensi pgvector (`CREATE EXTENSION vector`, yang dilakukan oleh `docker/init.sql`). Postgres terkelola seperti Neon, Supabase, atau RDS menyediakannya.

## Pemecahan masalah {#troubleshooting}

| Gejala | Penyebab |
|---|---|
| Sign-in link membuka host yang salah | `ADMIN_PUBLIC_URL` tidak sama dengan URL di browser. |
| Penyimpanan di dashboard gagal dengan error origin | Penyebab yang sama: penulisan harus membawa origin milik dashboard sendiri. |
| Agent tidak dapat diaktifkan | Ada langkah setup yang belum selesai: model, Knowledge Base, origin, atau user auth. Halaman **Setup** menunjukkan yang mana. |
| Sumber Knowledge Base tetap *Failed* | Halaman bukan HTTPS publik, atau model embedding atau key-nya salah. Server sengaja menolak alamat privat. |
| Chat tidak menampilkan apa pun | Agent nonaktif, atau batas harian anonimnya telah tercapai. |
| Error chat di browser, *Denied* di audit log | Origin tidak ada di daftar yang diizinkan. |
| Jawaban muncul sekaligus di akhir | Proxy melakukan buffering. Matikan buffering di `/v1/`. |
| LLM key berhenti berfungsi setelah pemulihan atau pemindahan | `SIDEAGENT_SECRET` berbeda dari yang dipakai untuk menyegelnya. |
| Semua orang sign-out setelah restart | `SIDEAGENT_SECRET` berubah. |
