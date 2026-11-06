---
slug: /
sidebar_position: 1
title: Pengantar
---

Tambahkan chat dokumentasi ke aplikasi Anda dalam dua bagian:

1. **Server** yang Anda jalankan: `createServer` (atau `npx sideagent`) menyediakan dashboard untuk membuat agent, menambahkan Knowledge Base (markdown dan URL), memilih model, dan membaca audit log, beserta endpoint yang dihubungi chat dan sign-in untuk dashboard.
2. **Komponen React**: `<AgentChat publishableKey="pk_…" />`. Key tersebut menyebutkan agent dan server yang menjalankannya, sehingga tidak ada lagi yang perlu dikonfigurasi.

```
npm i sideagent
```

- [Quickstart](./quickstart.md): dari nol hingga chat di aplikasi Anda.
- [Server](./server.md): `createServer`, opsinya, sign-in, database, dan dashboard.
- [Client](./client.md): komponen `AgentChat` dan sidebar yang menempel.
- [Knowledge Base](./knowledge.md): sumber jawaban agent.
- [Self-hosting](./self-hosting.md), [Deployments](./deployments.md), [Cloudflare Workers](./cloudflare-workers.md).
- [Theming](./theming.md), [Chat history](./history.md), [Hooks](./hooks.md).
