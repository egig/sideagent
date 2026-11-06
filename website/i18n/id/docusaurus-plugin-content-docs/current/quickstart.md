---
sidebar_position: 1.5
title: Mulai cepat
---

## 1. Jalankan server {#1-run-the-server}

```sh
npx sideagent
```

Server berjalan di http://localhost:8788 dengan basis data di memori (data hilang saat proses berhenti) dan mencetak tautan masuk ke log. Untuk basis data sungguhan, atur `DATABASE_URL` (Postgres dengan pgvector) dan `SIDEAGENT_SECRET` (`openssl rand -base64 32`); lihat [Server](./server.md).

## 2. Buat agen {#2-create-an-agent}

Buka dasbor, pilih **New agent**, lalu ikuti halaman **Setup**: hubungkan dan uji model, tambahkan pengetahuan, coba di pratinjau, daftarkan origin yang boleh menyematkan chat, lalu aktifkan agen. Salin publishable key-nya (`pk_…`). Kunci ini bersifat publik.

## 3. Tambahkan chat {#3-add-the-chat}

```tsx
import { AgentChat } from "sideagent";

<AgentChat publishableKey="pk_…" />
```

Untuk pengguna yang sudah masuk, berikan `getToken`; lihat [Klien](./client.md).

## Serahkan kepada agen pemrograman Anda {#let-your-coding-agent-do-it}

Pasang skill sekali, lalu beri perintah kepada agen Anda: "Add an AI assistant to this app."

```
npx skills add egig/sideagent
```

Skill ini juga tersedia di paket npm pada `node_modules/sideagent/skills/sideagent/SKILL.md`. Jika agen Anda tidak mendukung skill, minta agen tersebut membaca `https://egig.github.io/sideagent/llms-full.txt` dan mengikutinya. Skill ini diuji dengan kasus eval di `skills/sideagent/evals/` (`pnpm eval:skill`).

Agen hanya menjawab dari pengetahuan. Agen tidak dapat memanggil API Anda atau mengubah data.

## Berkas lain untuk agen {#other-agent-files}

- [`llms.txt`](pathname:///sideagent/llms.txt) dan [`llms-full.txt`](pathname:///sideagent/llms-full.txt): dokumentasi ini untuk LLM (dalam bahasa Inggris).
- `AGENTS.md` di repositori: perintah dan aturan untuk agen yang mengerjakan kode sideagent itu sendiri.
