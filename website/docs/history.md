---
sidebar_position: 7
title: Chat history
---

`AgentChat` has a History button (list, open, delete) and reopens the last conversation after a refresh. Messages live in your LangGraph `checkpointer`; the list lives in a `threadStore` (in-memory by default). Both must be persistent in production. See [Persistence](./persistence.md) for setup:

```ts
createAgent({ …, checkpointer: new PostgresSaver(…), threadStore: myThreadStore }); // ThreadStore: list / has / touch / delete
```

## Limits

- The default `threadStore` is in-memory. History is lost on restart, and not shared between instances. Use a persistent one in production.
- A persistent `checkpointer` is required too. Without it, a thread listed in history may have no messages.
- Users only see their own threads.
- With [`summarize`](./server.md#long-threads-summarize) on, older messages of a long thread are replaced by a summary and no longer appear in its history.
