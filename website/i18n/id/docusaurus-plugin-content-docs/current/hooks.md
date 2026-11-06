---
sidebar_position: 4
title: Hooks
---

## Hook client {#client-hooks}

Berikan `hooks` ke `AgentChat` atau `AgentProvider`. Model tidak dapat memicu hook atau tindakan client lainnya.

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
| `onTurnEnd()` | Saat turn selesai, gagal, atau dihentikan |
| `onError({ code, message })` | Saat terjadi error agent. Kode server: `step_limit`, `timeout`, `error`. Kode client: `headers_failed`, `http_<status>`, `network` |

Hook yang melempar error akan ditangkap dan dicatat ke konsol sebagai `[sideagent] hook threw:`. Hook tidak pernah merusak chat. Hook bersifat sinkron: jangan mengandalkan chat untuk menunggu promise yang dikembalikan.

## Hook server: `onError` {#server-hook-onerror}

`createServer({ onError })` menerima setiap turn yang gagal dengan `{ agentId, code, threadId, error }`. Browser hanya melihat "The agent failed. Try again.", jadi gunakan hook ini untuk mencatat penyebabnya. Hook ini bersifat fire-and-forget, dan `error` dapat memuat detail dari model provider Anda: catat di server, jangan pernah kirim ke browser. Lihat [Server](./server.md).
