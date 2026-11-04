# sideagent

Library that embeds a docs chat agent in an app: knowledge (markdown and URLs) + OpenAI-compatible LLM in, secure agent endpoint (`sideagent/server`) and React chat UI (`sideagent`) out. The agent has one tool, knowledge search; it does not call APIs.

## Commands

- `pnpm install`
- `pnpm test` — vitest (uses `src/testing/mock-llm.ts`, no API key needed)
- `pnpm typecheck`
- `pnpm format` / `pnpm format:check` — Prettier (width 120) over `src/`, `dev/` and `admin-ui/`
- `pnpm build` — tsup to `dist/`
- `pnpm dev` — admin API on :8788 + dashboard with hot reload on :5174 (PGlite unless `DATABASE_URL` is set); `pnpm admin:start` serves the built dashboard
- Docs: `pnpm --dir website install && pnpm --dir website build`

## Layout

- `src/server/` — server entry (`sideagent/server`)
  - `create-agent.ts` — wiring only: config → operations → model → graph → handler; `options.ts` — `CreateAgentOptions`; `knowledge/startup.ts` — knowledge load with a startup wait
  - `http/` — the endpoint: `handler.ts` (request pipeline), `request.ts` (body schema), `thread-routes.ts`, `turn.ts` (SSE)
  - `graph/` — agent built on LangChain `createAgent` with one middleware (system prompt, relevance gate); `summarize.ts` wraps LangChain's summarization middleware (opt-in `summarize`); `tools/search.ts` (knowledge search)
  - `security/` — origin check, SSRF guard, prompt policy
  - `knowledge/` — chunking, HTML to text, vector store, guarded page fetch, `KnowledgeBase`
  - `config.ts`, `threads.ts`, `history.ts`, `doctor.ts`, `model.ts`, `adapters/` (Hono/Next/Express)
- `src/client/` — React UI (`sideagent`): `AgentChat.tsx` (panel shell), `panel-hooks.ts` (dock width, agent info), `Chat.tsx` (runtime adapter), `parts.ts` (pure event → message parts), `ToolCard.tsx` (sources), `transport.ts`, `hooks.ts`
- `src/admin/` — server and dashboard API (single workspace by default, multi-tenant via the `scope` hook) (`sideagent/admin`); not under the `src/server/` edge rule, but it still has no `node:*` (enforced by `edge-compat.test.ts`) except `node.ts`, the static-file server
  - `store/types.ts` — `AdminStore`, the only thing handlers and the data plane talk to; `store/pg/` — Postgres + pgvector (Drizzle schema, SQL migrations, one file per area: `agents`, `usage`, `audit`, `threads`, `knowledge`, composed in `store.ts`); `store/contract.ts` — behaviour every store must have
  - `control/` — dashboard API; `data/` — `/v1/agents/:id` (request flow in `router.ts`; `access.ts` origin, key and end-user checks; `quota.ts` caps; `audit.ts` audit row; `runtime.ts` + `provider.ts` the library runtime; `adapters/` store-to-LangChain/LangGraph glue); `auth/` — bundled better-auth sign-in
  - `config.ts`, `retention.ts`, `knowledge/` — validation, retention constants, ingestion; `security/` — sealed secrets (`crypto.ts`), SSRF guard with DNS (`url-guard.ts`, `guarded-fetch.ts`), bot challenge (`challenge.ts`)
- `admin-ui/` — the dashboard SPA (Vite, built to `dist/admin-ui`; its own `tsconfig.json`)
- `src/workers-ai/` — Cloudflare Workers AI: `chat.ts` chat model, `retrieval.ts` embeddings and reranker
- `src/protocol.ts` — wire types shared by both sides
- `src/testing/` — mock LLM, exported as `sideagent/testing`
- `dev/` — the admin dev server (`pnpm dev`, Docker); `website/docs/` — Docusaurus docs (source of `llms.txt`)

Tests sit next to the code they cover (`*.test.ts`). `e2e.test.ts` drives the full handler.

## Rules

- Security defaults are the product. Do not weaken them. Any change to the code below needs a test.

  | Invariant | Code | Tests |
  |---|---|---|
  | The model can run only the knowledge search; any other tool name is refused | `graph/index.ts` (`wrapToolCall`) | `e2e.test.ts` "does not run a tool the model asks for that does not exist" |
  | Operations config is gone: `spec`, `baseUrl`, `allow`, `approvalSecret` are rejected | `config.ts` | `config.test.ts` "no longer takes operations" |
  | Pinned SSRF guards on pages the server fetches | `security/url-guard.ts`, `knowledge/fetch-page.ts` | `security/url-guard.test.ts`, `knowledge/knowledge.test.ts` |
  | Origin, method and content-type checks | `security/origin.ts`, `http/handler.ts` | `e2e.test.ts` "checks origin, method and content type", "cors" |
  | Threads bound to their user | `threads.ts` (`ownsThread`) | `e2e.test.ts` "denies another user's thread", "history" |
  | Passage text reaches the browser only when the host opts in per request | `graph/tools/search.ts`, `http/handler.ts` (`exposeKnowledge`) | `knowledge-expose.e2e.test.ts` "is off by default", "ignores flags sent in the request body" |
  | Page context and passages are untrusted data | `security/policy.ts`, `knowledge/format.ts` | `knowledge.e2e.test.ts` "wraps passages as untrusted data" |
  | A conversation summary is untrusted data, and a failed summary keeps the history | `graph/summarize.ts`, `security/policy.ts` (`wrapSummary`) | `summarize.e2e.test.ts` "given to the model as untrusted data", "passages reach the summary only", "keeps the history when the summary call fails" |

  | Admin: another scope's agent (the `scope` hook; one shared workspace by default) looks like a missing one on every dashboard route | `admin/control/context.ts`, `store/pg/agents.ts` (`getOwned`, `update`, `remove`) | `admin/control/agents.test.ts` "hides another integrator's agent", "groups users by the host's scope hook", `store/contract.ts` "treats another owner's agent as missing" |
  | Admin: writes need the dashboard's own origin, reads need a session | `admin/app.ts` | `agents.test.ts` "requires a session on every route", "refuses writes from another origin" |
  | Admin: LLM keys are sealed and never in responses, logs or rows | `admin/security/crypto.ts`, `control/llm.ts` | `agents.test.ts` "seals the key", "never leaks a stack trace or secret" |
  | Admin: provider errors never reach end users | `admin/data/router.ts` | `data/router.test.ts` "never shows provider errors to the client" |
  | Admin: a preview is the owner's alone and the public route cannot start one | `admin/data/router.ts` (`__preview`) | `data/router.test.ts` "preview (D-31)" |
  | Admin: threads stay with their user | `store/pg/threads.ts` | `store/contract.ts` `runThreadContract` |
  | Admin: the dashboard server stays inside its folder and keeps the server path out of the page | `admin/node.ts` | `admin/ui.test.ts` |

- `src/admin/` layering (see `src/admin/README.md`): `store` imports no service, `control` and `data` never import each other, `security` imports no service, and the library is reached only through `server/index.js` (enforced by `admin/layering.test.ts`).
- Everything in `src/server/` (non-test) must run on edge runtimes: no `node:*` imports, `Buffer`, or `process.` (enforced by `edge-compat.test.ts`, which scans subfolders).
- `src/client/` must not import server code (enforced by `client-isolation.test.ts`).
- Update `website/docs/` and README when public API changes.
- `src/admin/` is new code that was moved from the hosted product, so comments cite its decision numbers (`D-12`); keep them. Schema changes to Postgres append a step to `store/pg/migrations.ts`, never edit a shipped one, and update `store/pg/schema.ts` to match (the contract tests catch drift).
- Run `pnpm test && pnpm typecheck && pnpm format:check` before finishing.

## Skill evals

`skills/sideagent/SKILL.md` is tested with `claude plugin eval`. Cases are in `skills/sideagent/evals/` (each has a small fixture app and graders). Run `pnpm eval:skill` (costs about $2 per run, uses your Claude credentials). Run it after any change to `SKILL.md`. Each case must score 1.00 with the skill and clearly above the no-skill baseline. Add a case for every new failure you find.
