---
sidebar_position: 4
title: Hooks
---

## Client hooks

Pass `hooks` to `AgentChat` or `AgentProvider`. The model cannot trigger a hook or any other client action.

```tsx
<AgentChat
  publishableKey="pk_…"
  hooks={{
    onTurnEnd: () => track("agent_turn"),
    onError: ({ code, message }) => report(code, message),
  }}
/>
```

| Hook                         | Fires                                                                                                                         |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `onTurnStart()`              | When the user sends a message                                                                                                 |
| `onTurnEnd()`                | When the turn finishes, fails or is stopped                                                                                   |
| `onError({ code, message })` | On an agent error. Server codes: `step_limit`, `timeout`, `error`. Client codes: `headers_failed`, `http_<status>`, `network` |

A hook that throws is caught and logged to the console as `[sideagent] hook threw:`. It never breaks the chat. Hooks are synchronous: do not rely on the chat waiting for a returned promise.

## Server hook: `onError`

`createServer({ onError })` hears every failed turn with `{ agentId, code, threadId, error }`. The browser only sees "The agent failed. Try again.", so use this to log the cause. It is fire-and-forget, and `error` can contain details from your model provider: log it on the server, never send it to the browser. See [Server](./server.md).
