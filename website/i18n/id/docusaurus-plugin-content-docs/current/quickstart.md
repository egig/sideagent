---
sidebar_position: 1.5
title: Quickstart
---

## 1. Jalankan server {#1-run-the-server}

```sh
npx sideagent
```

Server berjalan di http://localhost:8788 dengan database di memori (data hilang saat proses berhenti) dan mencetak sign-in link ke log. Untuk database sungguhan, atur `DATABASE_URL` (Postgres dengan pgvector) dan `SIDEAGENT_SECRET` (`openssl rand -base64 32`); lihat [Server](./server.md).

## 2. Buat agent {#2-create-an-agent}

Buka dashboard, pilih **New agent**, lalu ikuti halaman **Setup**: hubungkan dan uji model, tambahkan Knowledge Base, coba di preview, daftarkan origin yang boleh menyematkan chat, lalu aktifkan agent. Salin publishable key-nya (`pk_…`). Key ini bersifat publik.

## 3. Tambahkan chat {#3-add-the-chat}

```tsx
import { AgentChat } from "sideagent";

<AgentChat publishableKey="pk_…" />
```

Untuk pengguna yang sudah sign-in, berikan `getToken`; lihat [Client](./client.md).

## Serahkan kepada agent pemrograman Anda {#let-your-coding-agent-do-it}

Pasang skill sekali, lalu beri perintah kepada agent Anda: "Add an AI assistant to this app."

```
npx skills add egig/sideagent
```

Skill ini juga tersedia di paket npm pada `node_modules/sideagent/skills/sideagent/SKILL.md`. Jika agent Anda tidak mendukung skill, minta agent tersebut membaca `https://egig.github.io/sideagent/llms-full.txt` dan mengikutinya. Skill ini diuji dengan kasus eval di `skills/sideagent/evals/` (`pnpm eval:skill`).

Agent hanya menjawab dari Knowledge Base. Agent tidak dapat memanggil API Anda atau mengubah data.

## File lain untuk agent {#other-agent-files}

- [`llms.txt`](pathname:///sideagent/llms.txt) dan [`llms-full.txt`](pathname:///sideagent/llms-full.txt): dokumentasi ini untuk LLM (dalam bahasa Inggris).
- `AGENTS.md` di repository: perintah dan aturan untuk agent yang mengerjakan kode sideagent itu sendiri.
