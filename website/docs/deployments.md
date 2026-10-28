---
sidebar_position: 9
title: Deployments
---

## Checklist

- [ ] `getAuth` returns a stable `userId` for each signed-in user. Threads and approvals are bound to it. Use `anonymous: true` only for public, read-only agents: every visitor then shares the user id `"anonymous"`, so they share threads too.
- [ ] `allowedOrigins` lists only your real app origins.
- [ ] `allow` lists only the operations the agent needs. Prefer exact operation ids or `tag:` entries. Globs use `*`.
- [ ] `approvalSecret` is set (16+ characters, from an env var) and the same on every instance.
- [ ] `checkpointer`, `threadStore` and `vectorStore` are persistent. See [Persistence](./persistence.md).
- [ ] `llm.apiKey` comes from an env var. It never goes to the browser.
- [ ] `beforeTurn` enforces rate limits or quotas.
- [ ] `onAudit` writes audit events somewhere durable.
- [ ] `agent.doctor()` reports `ok: true`.

## Authentication

`getAuth(request)` runs on every request. Throw, or return no `userId`, and the request gets `401`.

```ts
getAuth: async (req) => {
  const session = await verifySession(req.headers.get("cookie"));
  if (!session) throw new Error("no session");
  return { userId: session.userId, headers: { authorization: `Bearer ${session.apiToken}` } };
},
```

`headers` are sent to your API on each tool call. The model never sees them. Your API must still enforce its own permissions: the agent can only do what the user's token can do, so do not give it a service token with more rights.

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
| `callTimeoutMs` | 30000 | One API call is aborted and reported to the model as an error |
| `maxResultBytes` | 65536 | API response is cut off and marked truncated |
| `maxConcurrentTurnsPerUser` | 2 | New turn gets `429` |
| `maxTools` | 40 | `createAgent` throws at startup |

Fixed limits: request body 256 KB, message 8000 characters.

## Audit log

`onAudit` gets one event per tool call:

```ts
{ at, userId, threadId, operationId, callId, args, status, httpStatus?, approval, durationMs?, error? }
```

- `status`: `"executed" | "rejected" | "denied" | "error" | "dry_run"`.
- `approval`: `"auto" | "approved" | "rejected"`.
- Values under keys that look sensitive (`password`, `token`, `secret`, `api_key`, `authorization`, `cookie`, `credential`) are replaced with `[redacted]` before the callback. Other personal data in `args` is not.

## Approvals

- An approval token is valid for 10 minutes and bound to the exact arguments. An expired or tampered token gets `403`.
- A pending approval is stored in the checkpointer. With the in-memory checkpointer it is lost on restart.
- A user must resolve a pending approval before sending a new message (`409` otherwise).

## Streaming and proxies

Responses are server-sent events. Reverse proxies and CDNs must not buffer them, or the user sees no text until the turn ends. Disable buffering for the agent route (for nginx: `proxy_buffering off;`). Set the platform's function timeout above `turnTimeoutMs`.

## Edge and serverless

- Pass knowledge as strings. There is no filesystem.
- Set `approvalSecret` and use persistent stores, because each request can hit a new instance.
- Startup waits up to 60 seconds for knowledge to load, then continues loading in the background. Build the agent once per instance, not per request.

## Other things to know

- The model gets `instructions` as part of its system prompt. Use it for tone and domain rules, not for security. Access control belongs in `allow`, approvals and your API.
- `context` comes from the browser, so a user can forge it. It is cut to 4000 characters and given to the model as page context. Never use it for access control, and do not put secrets in it.
- Assistant replies render as Markdown (GFM) with raw HTML dropped; links open in a new tab with `noopener noreferrer`. Tool results are plain text, never HTML.
- The model must support tool calling. `doctor()` checks this.
