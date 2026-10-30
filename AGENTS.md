# sideagent

Library that embeds a docs chat agent in an app: knowledge (markdown and URLs) + OpenAI-compatible LLM in, secure agent endpoint (`sideagent/server`) and React chat UI (`sideagent`) out. The agent has one tool, knowledge search; it does not call APIs.

## Commands

- `pnpm install`
- `pnpm test` — vitest (uses `src/testing/mock-llm.ts`, no API key needed)
- `pnpm typecheck`
- `pnpm format` / `pnpm format:check` — Prettier (width 120) over `src/` and `demo/`
- `pnpm build` — tsup to `dist/`
- `pnpm demo` — demo API on :8787 + vite UI on :5173 (scripted mock LLM unless `LLM_API_KEY` is set)
- Docs: `pnpm --dir website install && pnpm --dir website build`

## Layout

- `src/server/` — server entry (`sideagent/server`)
  - `create-agent.ts` — wiring only: config → operations → model → graph → handler
  - `http/` — the endpoint: `handler.ts` (request pipeline), `request.ts` (body schema), `thread-routes.ts`, `turn.ts` (SSE)
  - `graph/` — agent built on LangChain `createAgent` with one middleware (system prompt, relevance gate); `summarize.ts` wraps LangChain's summarization middleware (opt-in `summarize`); `tools/search.ts` (knowledge search)
  - `security/` — origin check, SSRF guard, prompt policy
  - `knowledge/` — chunking, HTML to text, vector store, guarded page fetch, `KnowledgeBase`
  - `config.ts`, `threads.ts`, `history.ts`, `doctor.ts`, `model.ts`, `adapters/` (Hono/Next/Express)
- `src/client/` — React UI (`sideagent`): `AgentChat.tsx` (panel shell), `Chat.tsx` (runtime adapter), `parts.ts` (pure event → message parts), `ToolCard.tsx` (sources), `transport.ts`, `hooks.ts`
- `src/workers-ai/` — Cloudflare Workers AI chat model and embeddings
- `src/protocol.ts` — wire types shared by both sides
- `src/testing/` — mock LLM, exported as `sideagent/testing`
- `demo/` — example app; `website/docs/` — Docusaurus docs (source of `llms.txt`)

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

- Everything in `src/server/` (non-test) must run on edge runtimes: no `node:*` imports, `Buffer`, or `process.` (enforced by `edge-compat.test.ts`, which scans subfolders).
- `src/client/` must not import server code (enforced by `client-isolation.test.ts`).
- Update `website/docs/` and README when public API changes.
- Run `pnpm test && pnpm typecheck && pnpm format:check` before finishing.

## Skill evals

`skills/sideagent/SKILL.md` is tested with `claude plugin eval`. Cases are in `skills/sideagent/evals/` (each has a small fixture app and graders). Run `pnpm eval:skill` (costs about $2 per run, uses your Claude credentials). Run it after any change to `SKILL.md`. Each case must score 1.00 with the skill and clearly above the no-skill baseline. Add a case for every new failure you find.
