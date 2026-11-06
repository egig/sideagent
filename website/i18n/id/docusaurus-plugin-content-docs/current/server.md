---
sidebar_position: 2
title: Server
---

Satu panggilan memberi Anda API dashboard, endpoint para agent (`/v1/agents/:id`), sign-in dashboard, dan, di Node, dashboard itu sendiri. Semuanya di balik satu `fetch(request)`.

## Menjalankannya {#run-it}

`npx sideagent` menjalankannya dari environment variable. Tanpa `DATABASE_URL`, server memakai database di memori (hanya untuk pengembangan).

| Variable | |
|---|---|
| `SIDEAGENT_SECRET` | Minimal 32 karakter (`openssl rand -base64 32`). Wajib di produksi. |
| `DATABASE_URL` | Postgres dengan ekstensi pgvector. Wajib di produksi. |
| `PUBLIC_URL` | URL yang diketik orang di browser. Bawaan `http://localhost:$PORT`. |
| `PORT` | Bawaan 8788. |
| `SIGNUP` | `true` mengizinkan orang baru membuat akun. Bawaan: hanya akun yang sudah ada yang dapat sign-in. |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Social sign-in. |
| `SIDEAGENT_LOG_SIGN_IN_LINKS` | `true` mencetak email sign-in link ke log. Tidak ada pengirim email di sini. Siapa pun yang dapat membaca log dapat sign-in. |

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

`createServer` dari `sideagent/server` sama, tetapi tanpa file dashboard dan `listen`: pasang `server.fetch` di Hono, Next, Workers, atau apa pun yang memberi Anda `Request`. Lihat [Cloudflare Workers](./cloudflare-workers.md).

## Opsi {#options}

| Opsi | Bawaan | |
|---|---|---|
| `database` | wajib | URL Postgres (Node), database Postgres Drizzle (Workers dengan Hyperdrive, PGlite, node-postgres, Neon...) atau `AdminStore` Anda sendiri. Tabel dibuat dan dimigrasikan pada penggunaan pertama, kecuali untuk store Anda sendiri. |
| `publicUrl` | wajib | Origin publik server. Publishable key menyebutkan host-nya, dan penulisan dari dashboard harus membawanya sebagai `Origin`. |
| `secret` | wajib | Satu master secret. Key yang membungkus LLM key tersimpan dan key yang menandatangani cookie sign-in diturunkan darinya, sehingga menggantinya membuat semua orang sign-out **dan membuat LLM key tersimpan tidak dapat dibaca**. |
| `auth` | sign-in bawaan | `{ sendMagicLink, github, google, signup }` untuk sign-in bawaan, atau `{ session(request) }` untuk memakai milik Anda sendiri (proxy SSO, Auth.js...). |
| `scope(user, request)` | satu workspace bersama | Agent mana yang dilihat seorang pengguna. Pengguna dengan scope yang sama berbagi agent. Kembalikan `user.id` untuk satu workspace per pengguna, atau ID organisasi untuk tim. Agent milik scope lain menjawab 404. |
| `builtinModel` | tidak ada | Model Anda sendiri, ditawarkan di samping endpoint setiap pemilik dan dihitung pemakaiannya per pemilik (`BuiltinModel`). Di Cloudflare, lihat [resep Workers AI](./cloudflare-workers.md#workers-ai-as-the-built-in-model). |
| `challenge` | tidak ada | Bot challenge yang diselesaikan pengunjung anonim sebelum chat (`turnstileChallenge`). Tanpanya, agent anonim terbuka. |
| `rateLimit`, `clientIp` | limiter per proses, `x-forwarded-for` | Di belakang proxy yang mengatur header lain, bacalah header tersebut. |
| `anonDailyMessages` | 25 | Jumlah pesan anonim yang dijawab satu agent per hari UTC. |
| `background(work)` | langsung dijalankan | Menjaga pekerjaan tetap berjalan setelah response, misalnya `waitUntil`. |
| `onError` | tidak ada | Menerima setiap turn yang gagal: `{ agentId, code, threadId, error }`. Error dapat memuat key dan teks pelanggan: catat, jangan pernah kembalikan. |

`createServer` langsung melempar error jika `database` tidak ada, `publicUrl` bukan URL, atau `secret` tidak ada; `secret` yang lebih pendek dari 32 karakter membuat `server.ready` ditolak. Email sign-in link hanya dicetak ke log di `localhost`. Di tempat lain, tanpa `sendMagicLink`, sign-in lewat email ditolak (GitHub dan Google tetap berfungsi).

## Yang dilayani {#what-it-serves}

| Path | Isi |
|---|---|
| `/api/agents…` | API dashboard. Memerlukan session; penulisan harus membawa `Origin` milik server sendiri. |
| `/api/auth/*`, `/api/auth-providers` | Sign-in bawaan. |
| `/api/health` | `{ "ok": true }`. |
| `/v1/agents/:id` | Endpoint agent untuk pengguna akhir. Memerlukan publishable key agent. |
| dashboard | Node: dilayani oleh `sideagent/server/node`. Di tempat lain: upload `dist/admin-ui` sebagai static asset, atau berikan `ui`. |

## Database lain {#another-database}

Database adalah implementasi `AdminStore` (agent, usage counter, audit dan trace, Knowledge Base dengan vector search, thread dan checkpoint). `sideagent/server/store` mengekspor tipe tersebut serta `runStoreContract` / `runThreadContract`, yaitu perilaku yang wajib dimiliki setiap store (memerlukan `vitest`); jalankan keduanya terhadap store Anda.

## Perilaku percakapan {#how-a-conversation-behaves}

- **Pertanyaan lanjutan dan pertanyaan yang tidak jelas.** Pesan yang hanya lemah kecocokannya dengan Knowledge Base tidak langsung ditolak. Jika pesan tersebut, bersama pertanyaan sebelumnya, cukup dekat dengan Knowledge Base, model menerimanya bersama aturan cakupan dan dapat menanyakan maksud pengguna. Hanya pesan yang sama sekali tidak dekat yang mendapat balasan tetap "off topic", dan model tidak dipanggil. Penolakan tetap terlihat oleh pengguna, tetapi tidak ditunjukkan ke model pada turn berikutnya.
- **Pengunjung anonim** melanjutkan percakapan melalui ID thread-nya, yang hanya dipegang pengunjung tersebut. Percakapan disimpan di database Anda, seperti milik pengguna yang sudah sign-in, dan dihapus satu jam setelah pesan terakhirnya (pengunjung yang kembali setelahnya memulai percakapan baru, yang dilakukan chat secara otomatis). Percakapan ini memuat pesan pengunjung, jadi sertakan dalam pemberitahuan privasi Anda. Pengunjung anonim tidak memiliki daftar history.
- **Satu turn per thread.** Pesan kedua yang dikirim ke thread selagi gilirannya masih berjalan ditolak dengan `409`. Turn per pengguna juga dibatasi (`429`). Kedua batas berlaku per proses: di belakang beberapa instance, arahkan setiap thread ke instance yang sama atau tambahkan batas bersama di `rateLimit`.
- **Turn yang ditinggalkan browser** (tab ditutup, request dibatalkan) menghentikan model dan tool, lalu dicatat di audit log dengan alasan `client_aborted`. Pemanggilan tool yang tidak pernah selesai ditunjukkan ke model sebagai terputus, sehingga thread tetap berfungsi.

## Keamanan bawaan {#security-defaults}

- Setiap query dashboard dibatasi oleh `scope`. Agent milik scope lain dijawab seperti agent yang tidak ada: 404.
- URL pelanggan (model, halaman Knowledge Base, endpoint token) melewati SSRF guard yang juga meresolusi DNS, dan redirect ditolak.
- LLM key disegel dengan envelope encryption dan bersifat hanya-tulis di response, log, dan baris audit.
- Error provider tidak pernah sampai ke pengguna akhir. Pemilik yang sedang melihat preview melihat alasan umum; audit log mendapat alasan tetap.
- Trace tidak menyimpan teks pada level `metadata`, menyamarkan kredensial pada level `full`, dan kedaluwarsa setelah 7 dan 3 hari.
- Satu-satunya tool agent adalah knowledge search; nama tool lain yang diminta model akan ditolak.
