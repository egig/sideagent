---
sidebar_position: 4
title: Hook
---

## Hook klien {#client-hooks}

Berikan `hooks` ke `AgentChat` atau `AgentProvider`. Model tidak dapat memicu hook atau tindakan klien lainnya.

```tsx
<AgentChat
  publishableKey="pk_…"
  hooks={{
    onTurnEnd: () => track("agent_turn"),
    onError: ({ code, message }) => report(code, message),
  }}
/>
```

| Hook | Dipicu |
| --- | --- |
| `onTurnStart()` | Saat pengguna mengirim pesan |
| `onTurnEnd()` | Saat giliran (turn) selesai, gagal, atau dihentikan |
| `onError({ code, message })` | Saat terjadi galat agen. Kode server: `step_limit`, `timeout`, `error`. Kode klien: `headers_failed`, `http_<status>`, `network` |

Hook yang melempar galat akan ditangkap dan dicatat ke konsol sebagai `[sideagent] hook threw:`. Hook tidak pernah merusak chat. Hook bersifat sinkron: jangan mengandalkan chat untuk menunggu promise yang dikembalikan.

## Hook server: `onError` {#server-hook-onerror}

`createServer({ onError })` menerima setiap giliran yang gagal dengan `{ agentId, code, threadId, error }`. Peramban hanya melihat "The agent failed. Try again.", jadi gunakan hook ini untuk mencatat penyebabnya. Hook ini bersifat fire-and-forget, dan `error` dapat memuat detail dari penyedia model Anda: catat di server, jangan pernah kirim ke peramban. Lihat [Server](./server.md).
