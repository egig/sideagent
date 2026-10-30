---
sidebar_position: 9
title: Deployments
---

## Checklist

- [ ] `getAuth` returns a stable `userId` for each signed-in user. Threads are bound to it. Use `anonymous: true` only for public docs: every visitor then shares the user id `"anonymous"`, so they share threads too.
- [ ] `allowedOrigins` lists only your real app origins.
- [ ] Every `knowledge` source is something any user may read: the agent can quote any passage it finds.
- [ ] `checkpointer`, `threadStore` and `vectorStore` are persistent. See [Persistence](./persistence.md).
- [ ] `llm.apiKey` comes from an env var. It never goes to the browser.
- [ ] `beforeTurn` enforces rate limits or quotas.
- [ ] `agent.doctor()` reports `ok: true`.

## Authentication

`getAuth(request)` runs on every request. Throw, or return no `userId`, and the request gets `401`.

```ts
getAuth: async (req) => {
  const session = await verifySession(req.headers.get("cookie"));
  if (!session) throw new Error("no session");
  return { userId: session.userId };
},
```

The `userId` binds each conversation to its user. The agent has no access to your API, so there are no credentials to forward.

## CORS and cookies

- A request without an `Origin` header, or from an origin not in `allowedOrigins`, gets `403`. Server-to-server calls and `curl` need an `Origin` header.
- Only `POST` and `OPTIONS` are allowed. `Content-Type` must be `application/json`.
- If the endpoint is on a different origin than the app and you use cookies, pass `credentials="include"` to `AgentChat`. The default is `same-origin`.

## Rate limits and quotas

sideagent limits concurrent turns per user. It does not count requests. Do that in `beforeTurn`. Throw to reject the turn with `429`; the error message goes to the client.

```ts
beforeTurn: async ({ userId }) => {
  if (!(await limiter.allow(userId))) throw new Error("Too many requests. Try again in a minute.");
},
```

`maxConcurrentTurnsPerUser` is counted per process. With several instances, a user can run up to that number on each instance.

## Limits

Set under `limits`. Defaults:

| Option | Default | Effect when exceeded |
|---|---|---|
| `maxSteps` | 8 | Turn stops with error code `step_limit` |
| `turnTimeoutMs` | 120000 | Turn stops with error code `timeout` |
| `maxResultBytes` | 65536 | Passages sent to the model are cut off |
| `maxConcurrentTurnsPerUser` | 2 | New turn gets `429` |

Fixed limits: request body 256 KB, message 8000 characters.

## Streaming and proxies

Responses are server-sent events. Reverse proxies and CDNs must not buffer them, or the user sees no text until the turn ends. Disable buffering for the agent route (for nginx: `proxy_buffering off;`). Set the platform's function timeout above `turnTimeoutMs`.

## Edge and serverless

- Pass knowledge as strings. There is no filesystem.
- Use persistent stores, because each request can hit a new instance.
- Startup waits up to 60 seconds for knowledge to load, then continues loading in the background. Build the agent once per instance, not per request.

## Other things to know

- The model gets `instructions` as part of its system prompt. Use it for tone and domain rules, not for security. Keep private material out of `knowledge`.
- `context` comes from the browser, so a user can forge it. It is cut to 4000 characters and given to the model as page context. Never use it for access control, and do not put secrets in it.
- Assistant replies render as Markdown (GFM) with raw HTML dropped; links open in a new tab with `noopener noreferrer`. Search results are plain text, never HTML.
- The model must support tool calling, which the knowledge search uses. `doctor()` checks this.
