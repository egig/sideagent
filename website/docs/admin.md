---
sidebar_position: 12
title: Admin
---

`sideagent/admin` is an agent server with a dashboard. It is one workspace by default: every signed-in user shares every agent. Multi-tenancy is a hook (`scope`, below). People sign in, create agents, add knowledge, pick a model, go live and read audit logs and traces. Each agent gets an endpoint that speaks the sideagent wire protocol, so the `AgentChat` component talks to it unchanged. It is the hosted product's server, packaged so you can run it yourself.

Postgres with pgvector is the first supported database. Everything the admin needs from its host is an option, so other databases, sign-in systems and runtimes plug in.

## Run it

```ts
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { createAdmin, dohResolve } from "sideagent/admin";
import { createAuth } from "sideagent/admin/auth";
import { serveAdminUi } from "sideagent/admin/node";
import { createPgStore } from "sideagent/admin/pg";

const db = drizzle(new Pool({ connectionString: process.env.DATABASE_URL }));
const store = createPgStore(db);
await store.migrate(); // safe on every start

const auth = createAuth({
  db,
  baseURL: "https://admin.example.com",
  secret: process.env.BETTER_AUTH_SECRET!,
  sendMagicLink: async (email, url) => mailer.send(email, url),
});

const admin = createAdmin({
  store,
  auth,
  session: auth.session,
  publicUrl: "https://admin.example.com",
  secrets: { CONFIG_KEK: process.env.CONFIG_KEK! }, // openssl rand -base64 32
  resolve: dohResolve,
  fetch,
});

const ui = serveAdminUi({ apiBase: "/api" });
// Hono, Express, anything that hands you a Request: ui(request) ?? admin.fetch(request)
```

`pnpm dev` runs the API on :8788 and the dashboard with hot reload on http://localhost:5174, on PGlite (Postgres in process) unless `DATABASE_URL` is set; sign-in links print to the console. `pnpm build:ui && pnpm admin:start` serves the built dashboard and API together on :8788. With Docker: `docker compose up` starts Postgres with pgvector and the admin on http://localhost:8788 (`ADMIN_PORT`, `ADMIN_PUBLIC_URL`). Put `BETTER_AUTH_SECRET` and `CONFIG_KEK` in `.env`, or it uses throwaway ones that die with the container. Sign-in links appear in `docker compose logs -f admin`. Install the peers you use: `drizzle-orm`, `hono`, `jose`, and `better-auth` for the bundled sign-in.

For a start-to-finish walkthrough (secrets, HTTPS, first agent, embedding), see [Self-hosting](./self-hosting.md).

## What it serves

| Path | What |
|---|---|
| `/api/agents…` | The dashboard API. Session required; writes must carry the admin's own `Origin`. |
| `/api/auth/*`, `/api/auth-providers` | The bundled sign-in, when you pass `auth`. |
| `/v1/agents/:id` | An agent's endpoint for end users. Needs the agent's publishable key. |
| the dashboard | Static files from `sideagent/admin/node`, or `dist/admin-ui` on any static host. |

## Plug in your own

| Option | Default | Notes |
|---|---|---|
| `store` | required | An `AdminStore`. `createPgStore(db)` takes any Drizzle Postgres database: node-postgres, postgres.js, Neon, PGlite, Hyperdrive on Workers. |
| `session(request)` | required | Who is signed in. Return `{ id, email?, name? }` or `null`. `auth.session` is the bundled one. |
| `secrets.CONFIG_KEK` | required | Wraps every stored LLM key. Losing it makes them unreadable. |
| `scope(user, request)` | one shared workspace | Which agents a user sees. Users with the same scope share them. Return `user.id` for one workspace per user, or an organisation id for teams. Another scope's agent answers 404. |
| `background(work)` | runs at once | Starts indexing after the response, e.g. `waitUntil` on a serverless host. |
| `rateLimit`, `clientIp` | per-process limiter, `x-forwarded-for` | Behind a proxy that sets another header, read that one. |

## Another database

A database is an implementation of `AdminStore` (agents, usage counters, audit and traces, knowledge with vector search, threads and checkpoints). `runStoreContract` and `runThreadContract` in `src/admin/store/contract.ts` are the behaviour every store must have; run them against yours.

## Security defaults

- Every dashboard query is scoped by `scope`. Another scope's agent answers like a missing one: 404.
- Customer URLs (model, knowledge pages, token endpoints) pass an SSRF guard that also resolves DNS, and redirects are refused.
- LLM keys are sealed with envelope encryption and are write-only in responses, logs and audit rows.
- Provider errors never reach the end user. The owner previewing sees a coarse reason; the audit log gets a fixed one.
- Traces keep no text at `metadata`, redact credentials at `full`, and expire after 7 and 3 days.
