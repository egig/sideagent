---
sidebar_position: 4
title: Hooks
---

Hooks are your code that runs at set points. There are server hooks (on `createAgent`) and client hooks (on `AgentChat` / `AgentProvider`).

## Server hooks

### `getAuth(request)`

Runs on every request, including history calls. Return `{ userId }`. Throw, or return no `userId`, and the request gets `401`. See [Deployments](./deployments.md#authentication).

### `beforeTurn({ request, userId })`

Runs before a chat turn starts. It does not run for history list, open or delete. Throw to reject the turn with `429`. The error message is sent to the client.

```ts
beforeTurn: async ({ userId }) => {
  if (!(await limiter.allow(userId))) throw new Error("Too many requests. Try again in a minute.");
},
```

Use it for rate limits and quotas. It runs before the concurrent-turn check, so a rejected turn does not count as active.

### `callbacks({ request, userId })`

Returns [LangChain callback handlers](https://js.langchain.com/docs/concepts/callbacks/) for this request's turn, to trace what happens under the hood: each model call, each tool call, token usage and errors. Return `undefined` to skip tracing for a request.

```ts
callbacks: ({ userId }) => (isOwner(userId) ? [new MyTraceHandler()] : undefined),
```

- It runs on the server for every request. Nothing in the request body can turn it on.
- Handlers see the raw prompts, replies, search queries and passages. They are not redacted, so redact before you store them.
- A knowledge search is a span tagged `sideagent:tool` and named `search_knowledge`. Handle it in `handleChainStart` and `handleChainEnd`.
- A callback that throws means the turn runs without tracing. A failing handler does not break the turn.

### `onError({ code, error, userId, threadId })`

Called when a turn fails, with the real error. The browser only sees "The agent failed. Try again." (or the step limit or timeout message), so use this to log the cause.

```ts
onError: ({ code, error, threadId }) => console.error("turn failed", { code, threadId, error }),
```

- `code` is `error`, `step_limit` or `timeout`, as sent to the client.
- It is fire-and-forget: the turn does not wait for it, and an error thrown here is swallowed.
- It does not run when the client disconnects.
- `error` can contain details from your model provider or API. Log it on the server; do not send it to the browser.

## Client hooks

Pass `hooks` to `AgentChat` or `AgentProvider`. The model cannot trigger a hook or any other client action.

```tsx
<AgentChat
  endpoint="/agent"
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
