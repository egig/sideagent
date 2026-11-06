---
slug: /
sidebar_position: 1
title: Pengantar
---

Tambahkan chat dokumentasi ke aplikasi Anda dalam dua bagian:

1. **Server** yang Anda jalankan: `createServer` (atau `npx sideagent`) menyediakan dasbor untuk membuat agen, menambahkan pengetahuan (markdown dan URL), memilih model, dan membaca log audit, beserta endpoint yang dihubungi chat dan proses masuk untuk dasbor.
2. **Komponen React**: `<AgentChat publishableKey="pk_…" />`. Kunci tersebut menyebutkan agen dan server yang menjalankannya, sehingga tidak ada lagi yang perlu dikonfigurasi.

```
npm i sideagent
```

- [Mulai cepat](./quickstart.md): dari nol hingga chat di aplikasi Anda.
- [Server](./server.md): `createServer`, opsinya, proses masuk, basis data, dan dasbor.
- [Klien](./client.md): komponen `AgentChat` dan sidebar yang menempel.
- [Pengetahuan](./knowledge.md): sumber jawaban agen.
- [Self-hosting](./self-hosting.md), [Deployment](./deployments.md), [Cloudflare Workers](./cloudflare-workers.md).
- [Tema](./theming.md), [Riwayat](./history.md), [Hook](./hooks.md).
