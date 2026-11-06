---
sidebar_position: 2
title: Server
---

Satu panggilan memberi Anda API dasbor, endpoint para agen (`/v1/agents/:id`), proses masuk dasbor, dan, di Node, dasbor itu sendiri. Semuanya di balik satu `fetch(request)`.

## Menjalankannya {#run-it}

`npx sideagent` menjalankannya dari variabel lingkungan. Tanpa `DATABASE_URL`, server memakai basis data di memori (hanya untuk pengembangan).

| Variabel | |
|---|---|
| `SIDEAGENT_SECRET` | Minimal 32 karakter (`openssl rand -base64 32`). Wajib di produksi. |
| `DATABASE_URL` | Postgres dengan ekstensi pgvector. Wajib di produksi. |
| `PUBLIC_URL` | URL yang diketik orang di peramban. Bawaan `http://localhost:$PORT`. |
| `PORT` | Bawaan 8788. |
| `SIGNUP` | `true` mengizinkan orang baru membuat akun. Bawaan: hanya akun yang sudah ada yang dapat masuk. |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Masuk dengan akun sosial. |
| `SIDEAGENT_LOG_SIGN_IN_LINKS` | `true` mencetak tautan masuk email ke log. Tidak ada pengirim email di sini. Siapa pun yang dapat membaca log dapat masuk. |

Di kode Anda sendiri:

```ts
import { createServer } from "sideagent/server/node";

const server = createServer({
  database: process.env.DATABASE_URL!,
  publicUrl: "https://agent.example.com",
  secret: process.env.SIDEAGENT_SECRET!,
  auth: { sendMagicLink: (email, url) => mailer.send(email, url) },
});
await server.listen(8788);
```

`createServer` dari `sideagent/server` sama, tetapi tanpa berkas dasbor dan `listen`: pasang `server.fetch` di Hono, Next, Workers, atau apa pun yang memberi Anda `Request`. Lihat [Cloudflare Workers](./cloudflare-workers.md).

## Opsi {#options}

| Opsi | Bawaan | |
|---|---|---|
| `database` | wajib | URL Postgres (Node), basis data Postgres Drizzle (Workers dengan Hyperdrive, PGlite, node-postgres, Neon...) atau `AdminStore` Anda sendiri. Tabel dibuat dan dimigrasikan pada penggunaan pertama, kecuali untuk store Anda sendiri. |
| `publicUrl` | wajib | Origin publik server. Publishable key menyebutkan host-nya, dan penulisan dari dasbor harus membawanya sebagai `Origin`. |
| `secret` | wajib | Satu rahasia induk. Kunci yang membungkus kunci LLM tersimpan dan kunci yang menandatangani cookie masuk diturunkan darinya, sehingga menggantinya mengeluarkan semua orang **dan membuat kunci LLM tersimpan tidak dapat dibaca**. |
| `auth` | proses masuk bawaan | `{ sendMagicLink, github, google, signup }` untuk proses masuk bawaan, atau `{ session(request) }` untuk memakai milik Anda sendiri (proxy SSO, Auth.js...). |
| `scope(user, request)` | satu ruang kerja bersama | Agen mana yang dilihat seorang pengguna. Pengguna dengan scope yang sama berbagi agen. Kembalikan `user.id` untuk satu ruang kerja per pengguna, atau ID organisasi untuk tim. Agen milik scope lain menjawab 404. |
| `builtinModel` | tidak ada | Model Anda sendiri, ditawarkan di samping endpoint setiap pemilik dan dihitung pemakaiannya per pemilik (`BuiltinModel`). Di Cloudflare, lihat [resep Workers AI](./cloudflare-workers.md#workers-ai-as-the-built-in-model). |
| `challenge` | tidak ada | Tantangan bot yang diselesaikan pengunjung anonim sebelum chat (`turnstileChallenge`). Tanpanya, agen anonim terbuka. |
| `rateLimit`, `clientIp` | pembatas per proses, `x-forwarded-for` | Di belakang proxy yang mengatur header lain, bacalah header tersebut. |
| `anonDailyMessages` | 25 | Jumlah pesan anonim yang dijawab satu agen per hari UTC. |
| `background(work)` | langsung dijalankan | Menjaga pekerjaan tetap berjalan setelah respons, misalnya `waitUntil`. |
| `onError` | tidak ada | Menerima setiap giliran yang gagal: `{ agentId, code, threadId, error }`. Galat dapat memuat kunci dan teks pelanggan: catat, jangan pernah kembalikan. |

`createServer` langsung melempar galat jika `database` tidak ada, `publicUrl` bukan URL, atau `secret` tidak ada; `secret` yang lebih pendek dari 32 karakter membuat `server.ready` ditolak. Tautan masuk email hanya dicetak ke log di `localhost`. Di tempat lain, tanpa `sendMagicLink`, proses masuk lewat email ditolak (GitHub dan Google tetap berfungsi).

## Yang dilayani {#what-it-serves}

| Path | Isi |
|---|---|
| `/api/agents…` | API dasbor. Memerlukan sesi; penulisan harus membawa `Origin` milik server sendiri. |
| `/api/auth/*`, `/api/auth-providers` | Proses masuk bawaan. |
| `/api/health` | `{ "ok": true }`. |
| `/v1/agents/:id` | Endpoint agen untuk pengguna akhir. Memerlukan publishable key agen. |
| dasbor | Node: dilayani oleh `sideagent/server/node`. Di tempat lain: unggah `dist/admin-ui` sebagai aset statis, atau berikan `ui`. |

## Basis data lain {#another-database}

Basis data adalah implementasi `AdminStore` (agen, penghitung pemakaian, audit dan trace, pengetahuan dengan pencarian vektor, thread dan checkpoint). `sideagent/server/store` mengekspor tipe tersebut serta `runStoreContract` / `runThreadContract`, yaitu perilaku yang wajib dimiliki setiap store (memerlukan `vitest`); jalankan keduanya terhadap store Anda.

## Perilaku percakapan {#how-a-conversation-behaves}

- **Pertanyaan lanjutan dan pertanyaan yang tidak jelas.** Pesan yang hanya lemah kecocokannya dengan pengetahuan tidak langsung ditolak. Jika pesan tersebut, bersama pertanyaan sebelumnya, cukup dekat dengan pengetahuan, model menerimanya bersama aturan cakupan dan dapat menanyakan maksud pengguna. Hanya pesan yang sama sekali tidak dekat yang mendapat balasan tetap "off topic", dan model tidak dipanggil. Penolakan tetap terlihat oleh pengguna, tetapi tidak ditunjukkan ke model pada giliran berikutnya.
- **Pengunjung anonim** melanjutkan percakapan melalui ID thread-nya, yang hanya dipegang pengunjung tersebut. Percakapan disimpan di basis data Anda, seperti milik pengguna yang masuk, dan dihapus satu jam setelah pesan terakhirnya (pengunjung yang kembali setelahnya memulai percakapan baru, yang dilakukan chat secara otomatis). Percakapan ini memuat pesan pengunjung, jadi sertakan dalam pemberitahuan privasi Anda. Pengunjung anonim tidak memiliki daftar riwayat.
- **Satu giliran per thread.** Pesan kedua yang dikirim ke thread selagi gilirannya masih berjalan ditolak dengan `409`. Giliran per pengguna juga dibatasi (`429`). Kedua batas berlaku per proses: di belakang beberapa instance, arahkan setiap thread ke instance yang sama atau tambahkan batas bersama di `rateLimit`.
- **Giliran yang ditinggalkan peramban** (tab ditutup, permintaan dibatalkan) menghentikan model dan tool, lalu dicatat di log audit dengan alasan `client_aborted`. Pemanggilan tool yang tidak pernah selesai ditunjukkan ke model sebagai terputus, sehingga thread tetap berfungsi.

## Keamanan bawaan {#security-defaults}

- Setiap kueri dasbor dibatasi oleh `scope`. Agen milik scope lain dijawab seperti agen yang tidak ada: 404.
- URL pelanggan (model, halaman pengetahuan, endpoint token) melewati pelindung SSRF yang juga meresolusi DNS, dan pengalihan ditolak.
- Kunci LLM disegel dengan enkripsi amplop dan bersifat hanya-tulis di respons, log, dan baris audit.
- Galat penyedia tidak pernah sampai ke pengguna akhir. Pemilik yang sedang melihat pratinjau melihat alasan umum; log audit mendapat alasan tetap.
- Trace tidak menyimpan teks pada level `metadata`, menyamarkan kredensial pada level `full`, dan kedaluwarsa setelah 7 dan 3 hari.
- Satu-satunya tool agen adalah pencarian pengetahuan; nama tool lain yang diminta model akan ditolak.
