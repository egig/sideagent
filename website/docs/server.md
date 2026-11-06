---
sidebar_position: 2
title: Server
---

One call gives you the dashboard API, the agents' endpoints (`/v1/agents/:id`), the dashboard's sign-in and, on Node, the dashboard itself. All behind one `fetch(request)`.

## Run it

`npx sideagent` runs it from environment variables. Without `DATABASE_URL` it uses an in-memory database (dev only).

| Variable | |
|---|---|
| `SIDEAGENT_SECRET` | At least 32 characters (`openssl rand -base64 32`). Required in production. |
| `DATABASE_URL` | Postgres with the pgvector extension. Required in production. |
| `PUBLIC_URL` | The URL people type in the browser. Default `http://localhost:$PORT`. |
| `PORT` | Default 8788. |
| `SIGNUP` | `true` lets new people create accounts. Default: only existing accounts sign in. |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Social sign-in. |
| `SIDEAGENT_LOG_SIGN_IN_LINKS` | `true` prints email sign-in links to the log. There is no mail sender here. Anyone who can read the log can sign in. |

In your own code:

```ts
import { createServer } from "sideagent/server/node";

const server = createServer({
  database: process.env.DATABASE_URL!,
  publicUrl: "https://agent.example.com",
  secret: process.env.SIDEAGENT_SECRET!,
  auth: { sendMagicLink: (email, url) => mailer.send(email, url) },
});
await server.listen(8788);
```

`createServer` from `sideagent/server` is the same without the dashboard's files and `listen`: mount `server.fetch` in Hono, Next, Workers or anything that hands you a `Request`. See [Cloudflare Workers](./cloudflare-workers.md).

## Options

| Option | Default | |
|---|---|---|
| `database` | required | A Postgres URL (Node), a Drizzle Postgres database (Workers with Hyperdrive, PGlite, node-postgres, Neon...) or your own `AdminStore`. The tables are created and migrated on first use, except for your own store. |
| `publicUrl` | required | The server's public origin. Publishable keys name its host, and dashboard writes must carry it as `Origin`. |
| `secret` | required | One master secret. The key that wraps stored LLM keys and the one that signs sign-in cookies are derived from it, so rotating it signs everyone out **and makes stored LLM keys unreadable**. |
| `auth` | bundled sign-in | Either `{ sendMagicLink, github, google, signup }` for the bundled sign-in, or `{ session(request) }` to use your own (SSO proxy, Auth.js...) instead. |
| `scope(user, request)` | one shared workspace | Which agents a user sees. Users with the same scope share them. Return `user.id` for one workspace per user, or an organisation id for teams. Another scope's agent answers 404. |
| `builtinModel` | none | Your own model, offered next to each owner's endpoint and metered per owner (`BuiltinModel`). On Cloudflare, build it with `sideagent/workers-ai`. |
| `challenge` | none | A bot challenge anonymous visitors solve before they chat (`turnstileChallenge`). Without it, anonymous agents are open. |
| `rateLimit`, `clientIp` | per-process limiter, `x-forwarded-for` | Behind a proxy that sets another header, read that one. |
| `anonDailyMessages` | 25 | Anonymous messages one agent answers per UTC day. |
| `background(work)` | runs at once | Keeps work alive after the response, e.g. `waitUntil`. |
| `onError` | none | Hears every failed turn: `{ agentId, code, threadId, error }`. The error can echo keys and customer text: log it, never return it. |

`createServer` throws at once on a missing `database`, a `publicUrl` that is not a URL, or a missing `secret`; a `secret` shorter than 32 characters rejects `server.ready`. Email sign-in links are only printed to the log on `localhost`. Elsewhere, without `sendMagicLink`, email sign-in is refused (GitHub and Google keep working).

## What it serves

| Path | What |
|---|---|
| `/api/agents…` | The dashboard API. Session required; writes must carry the server's own `Origin`. |
| `/api/auth/*`, `/api/auth-providers` | The bundled sign-in. |
| `/api/health` | `{ "ok": true }`. |
| `/v1/agents/:id` | An agent's endpoint for end users. Needs the agent's publishable key. |
| the dashboard | Node: served by `sideagent/server/node`. Elsewhere: upload `dist/admin-ui` as static assets, or pass `ui`. |

## Another database

A database is an implementation of `AdminStore` (agents, usage counters, audit and traces, knowledge with vector search, threads and checkpoints). `sideagent/server/store` exports the type and `runStoreContract` / `runThreadContract`, the behaviour every store must have (they need `vitest`); run them against yours.

## Security defaults

- Every dashboard query is scoped by `scope`. Another scope's agent answers like a missing one: 404.
- Customer URLs (model, knowledge pages, token endpoints) pass an SSRF guard that also resolves DNS, and redirects are refused.
- LLM keys are sealed with envelope encryption and are write-only in responses, logs and audit rows.
- Provider errors never reach the end user. The owner previewing sees a coarse reason; the audit log gets a fixed one.
- Traces keep no text at `metadata`, redact credentials at `full`, and expire after 7 and 3 days.
- The agent's only tool is knowledge search; any other tool name the model asks for is refused.
