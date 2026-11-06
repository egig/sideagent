# Changelog

## Unreleased

The interface is two things now: a React component that takes a publishable key, and one server call. This is a breaking release.

- **Client.** `AgentChat` and `AgentProvider` take `publishableKey` (required) and `getToken` (returns the signed-in user's token, or null). `endpoint`, `headers`, `getHeaders` and `credentials` are gone, and so are the exports `streamChat`, `callJson`, `sideagent/keys` and `sideagent/protocol`. `getHeaders={async () => ({ Authorization: `Bearer ${t}` })}` becomes `getToken={() => t}`.
- **Server.** `sideagent/server` is `createServer({ database, publicUrl, secret, … })`, returning `{ fetch, ready, close }`: dashboard API, agent endpoints, sign-in and (with `sideagent/server/node`) the dashboard. `npx sideagent` runs it from environment variables (`SIDEAGENT_SECRET`, `DATABASE_URL`, `PUBLIC_URL`, `PORT`).
  - One `secret` replaces `CONFIG_KEK` and `BETTER_AUTH_SECRET`; both keys are derived from it (HKDF). Stored LLM keys sealed under the old `CONFIG_KEK` cannot be read with a new `secret`: enter them again.
  - `auth` is one option: `{ sendMagicLink, github, google, signup }` for the bundled sign-in, or `{ session }` for your own. `builtin` is `builtinModel`. New `onError`.
  - Email sign-in links are printed only on `localhost`; elsewhere pass `auth.sendMagicLink`. The Docker image sets `SIDEAGENT_LOG_SIGN_IN_LINKS=true` to keep the old behaviour.
  - New `sideagent/server/store` (the `AdminStore` port and the contract tests, from `sideagent/admin/contract`) and `sideagent/server/node` (`createServer` that also serves the dashboard and `listen`s).
- **Removed.** `createAgent` and the Hono, Next and Express adapters, `sideagent/admin` and its subpaths (`/pg`, `/auth`, `/ui`, `/node`, `/contract`), `sideagent/protocol`, `sideagent/keys`. Knowledge, the model and the agent's settings are set in the dashboard. `sideagent/workers-ai` stays, to build `builtinModel` on Cloudflare; `sideagent/testing` stays.
- `@hono/node-server` is a dependency; `pg` is an optional peer; PGlite is optional (`npx sideagent` without `DATABASE_URL`).
- The skill and its evals teach the new interface.
- **Dashboard setup.** A new agent opens a guided **Setup** page: connect and test the model, add knowledge, try it in the preview, deploy (origins, user auth, embed code), then activate and wait for the first real request. Steps unlock in that order, and progress is read from the server. Instructions moved to the Knowledge page; Settings, General keeps the name and allowed origins. The Overview shows setup progress while inactive and what needs attention once live, and its install line no longer names an old version.
- New `POST /api/agents/:id/llm/check`: one tiny chat call and one embedding call on the saved settings, through the SSRF guard, answering with our own reason codes only. Saving a new API key retries sources that failed to index.
- `pnpm test:e2e`: Playwright tests of the dashboard against an in-memory server with faked DNS and fetch.

### Earlier, unreleased

The admin dashboard and the server behind it move into the library. It is single-tenant by default; multi-tenancy is a `scope` hook.

- New `sideagent/admin`: `createAdmin(deps)` serves the dashboard API (`/api`) and a data plane (`/v1/agents/:id`) for many agents and knowledge bases. All signed-in users share one workspace unless you pass `scope(user, request)`, which groups users per user, organisation or anything else. It takes a store, a `session` function and a few options; nothing is tied to a platform.
- New `sideagent/admin/pg`: `createPgStore(db)`, Postgres with pgvector through any Drizzle pg database, with its own versioned migrations in a `sideagent` schema. `AdminStore` is the contract for other databases; the contract tests are in `src/admin/store/contract.ts`.
- New `sideagent/admin/auth`: bundled sign-in (email magic link, GitHub, Google) on better-auth and the same database. Optional: pass your own `session` instead.
- New `sideagent/admin/node` and `sideagent/admin/ui`: serve the built dashboard (`dist/admin-ui`, a standalone SPA) from any mount path.
- New peers, all optional: `drizzle-orm`, `hono`, `jose`, `better-auth`. `pnpm dev` runs it all on PGlite.
- Every admin agent uses its owner's own OpenAI-compatible LLM and API key, unless the host passes `builtin` (its own model, with a per-owner cap: `BuiltinProvider`); a new agent then starts on it. The LLM config carries a `provider` (`builtin` or `custom`), `PUT /api/agents/:id/llm` needs it, and stored rows without one read as `custom`.
- New `sideagent/admin/contract`: `runStoreContract` and `runThreadContract`, the tests every `AdminStore` must pass (needs `vitest`). `indexPending` is exported from `sideagent/admin`.
- `challenge` (optional) makes anonymous visitors solve a bot challenge before they chat; `turnstileChallenge` is Cloudflare Turnstile. The data plane answers `challenge.verify` with a token for one agent and one address, and `agent.info` carries the site key.
- Existing exports and the wire format (`src/protocol.ts`) are unchanged.

## 0.9.0

sideagent is a docs agent now. Tool calling against your API is gone; the agent answers from `knowledge` and shows its sources. This is a breaking release with no migration path for operations.

- Removed from `createAgent`: `spec`, `baseUrl`, `allow`, `approvalSecret`, `dryRun`, `onAudit`, `limits.callTimeoutMs`, `limits.maxTools`, the `x-agent` spec hints and the `tools` field of `agent.doctor()`. The config now rejects them. `knowledge` is required.
- `getAuth` returns `{ userId }`. `headers` is gone: nothing is forwarded to an API.
- The model's only tool is `search_knowledge`. A call to any other tool name gets an error and never runs. Searches may now run in parallel.
- Wire format (`src/protocol.ts`): removes the `approval.request` and `tool.rejected` events, the `approval` request body, `invalidates` on `tool.complete` and `pending` on thread history. `tool.start`, `tool.complete` and `knowledge.hits` stay, for knowledge search. The `operationId` field of `tool.start`, `tool.complete` and history tool parts is now `tool`.
- Client: removed `resultRenderers`, the approval card, `useAgentBusy`, and the hooks `onApprovalRequested`, `onOperationStart`, `onOperationAbort`, `onAnyOperation`, `onOperationComplete` and `onInvalidate`. `onTurnStart`, `onTurnEnd` and `onError` stay. `ResultView` and `humanize` are no longer exported.
- `sideagent/server` no longer exports `assertAllowedUrl`. The `@scalar/openapi-parser` dependency is gone.
- `sideagent/testing`: the mock model no longer has the invoice shortcuts. New `mockEmbeddings` for the `embeddings` option.
- The skill and its evals now set up a docs agent.

## 0.8.0

- An admin-hosted agent can say it is unavailable: `agent.info` may answer `{ "name": "…", "available": false }` when the agent will refuse every message (a usage cap is reached). `AgentChat` then renders nothing, launcher included, and `useAgent()` returns `available: false` so an app can hide its own "ask" button. Checked once per page load; a cap reached mid-conversation still shows as an error in the chat.
- Wire format (`src/protocol.ts`): adds the optional `available` field to the `agent.info` answer. Old clients ignore it; old servers never send it.

## 0.7.0

- New client hooks `onOperationStart` and `onOperationAbort`. Each started operation ends in exactly one `onAnyOperation` or `onOperationAbort`, so an app can block input while a call runs and never stay blocked after a new chat, a thread switch or a lost connection.
- New `useAgentBusy()` hook: `true` while one of the agent's operations runs, anywhere under `AgentProvider`. It throws outside it, like `useAgent()`.
- An approval restored from history now fires `onApprovalRequested` when shown, and answering it fires `onTurnStart` and `onTurnEnd` around the resumed run. A lost connection there fires `onError` with code `network` instead of an unhandled rejection.
- New `exposeKnowledge({ request, userId })` option on `createAgent`. When it returns `true`, knowledge searches also stream a `knowledge.hits` event with the passage text and scores. Off by default; the request body cannot turn it on. Old clients ignore the event.
- New `dryRun({ request, userId })` option: writes are approved but not sent (status 202, audit status `dry_run`). Host-decided per request; a throwing callback counts as a dry run.
- New `fetch` and `maxRetries` on `llm` and `knowledge.embeddings`: every model and embeddings call goes through `fetch`; `maxRetries` fails fast.
- Wire format (`src/protocol.ts`): adds the `knowledge.hits` event. Existing events unchanged.

## 0.6.0

- New `launcher` prop on `AgentChat` and `AgentProvider`: `false` hides the floating launcher button, so the panel opens only through `useAgent().setOpen` or `defaultOpen`.
- New `history` prop: `false` turns off chat history. No History button, and the chat neither remembers nor reopens the last conversation (nothing is written to `localStorage`). The server still keeps its threads.
- New `headerActions` prop: extra buttons rendered in the panel header, before History.
- Wire format (`src/protocol.ts`) unchanged.

## 0.5.0

- New `getHeaders` prop on `AgentChat` and `AgentProvider`: called before every request (chat turns, approvals, history), for a login token that expires. Its headers are merged under `headers`, which wins on a clash, so it cannot replace the publishable key. If it throws, nothing is sent: a turn shows a `headers_failed` error, a history call fails like a network error.
- New `storageKey` prop: scopes the remembered last conversation in `localStorage` to one user. Changing it starts over with that user's last conversation.
- sideagent admin agents with token verification (JWKS or a userinfo URL) need both for the documented embed.
- Wire format (`src/protocol.ts`) unchanged.

## 0.3.0

- New `publishableKey` prop on `AgentChat` and `AgentProvider` for agents hosted on sideagent admin. The chat derives the endpoint from the key (https, http for `localhost` and `127.0.0.1`) and sends the key in the `x-sideagent-key` header. `endpoint` is now optional and, when given with a key, overrides the derived URL. A malformed key, or neither prop, throws during render.
- New entry point `sideagent/keys`, with no dependencies: `publishableKey`, `parsePublishableKey`, `publishableEndpoint` and `PUBLISHABLE_KEY_HEADER`. It owns the publishable key format (`pk_<test|live>_` + base64url of `<host>$<agentId>`).
- Wire format (`src/protocol.ts`) unchanged. Requests without `publishableKey` are unchanged.

## 0.2.0

- Cloudflare Workers: `sideagent/server` now resolves to the real build under the `workerd` and `worker` export conditions (before `browser`), so Wrangler and `@cloudflare/vite-plugin` need no alias.
- New `model` option on `createAgent`: any LangChain chat model with `bindTools()`, instead of `llm`. The two are mutually exclusive; config errors if neither is given.
- New `embeddings` option on `createAgent`, replacing `knowledge.embeddings` (now optional).
- `doctor()` checks an injected model with `invoke` and no HTTP call.
- New entry point `sideagent/workers-ai`: `workersAiChatModel(env.AI, model)` and `workersAiEmbeddings(env.AI, model)`.
- Registers `AsyncLocalStorage` itself when the runtime has it, which fixes approvals on Workers (needs `nodejs_compat` or `nodejs_als`).
- Wire format (`src/protocol.ts`) unchanged.
