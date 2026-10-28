# sideagent

Library that embeds a chat agent in an app: OpenAPI spec + OpenAI-compatible LLM in, secure agent endpoint (`sideagent/server`) and React chat UI (`sideagent`) out.

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
  - `http/` — the endpoint: `handler.ts` (request pipeline), `request.ts` (body schema), `thread-routes.ts`, `turn.ts` (approval check + SSE)
  - `graph/` — agent built on LangChain `createAgent` with one middleware (system prompt, relevance gate, one tool call at a time); `summarize.ts` wraps LangChain's summarization middleware (opt-in `summarize`); `tools/operation.ts` (validate → approve → call API), `tools/search.ts` (knowledge)
  - `security/` — approval tokens, origin check, SSRF guard, prompt policy and audit redaction
  - `knowledge/` — chunking, HTML to text, vector store, guarded page fetch, `KnowledgeBase`
  - `openapi.ts` (spec → operations, allowlist), `executor.ts` (HTTP call to your API), `config.ts`, `threads.ts`, `history.ts`, `doctor.ts`, `model.ts`, `adapters/` (Hono/Next/Express)
- `src/client/` — React UI (`sideagent`): `AgentChat.tsx` (panel shell), `Chat.tsx` (runtime adapter), `parts.ts` (pure event → message parts), cards, `transport.ts`, `hooks.ts`
- `src/workers-ai/` — Cloudflare Workers AI chat model and embeddings
- `src/protocol.ts` — wire types shared by both sides
- `src/testing/` — mock LLM, exported as `sideagent/testing`
- `demo/` — example app; `website/docs/` — Docusaurus docs (source of `llms.txt`)

Tests sit next to the code they cover (`*.test.ts`). `e2e.test.ts` drives the full handler.

## Rules

- Security defaults are the product. Do not weaken them. Any change to the code below needs a test.

  | Invariant | Code | Tests |
  |---|---|---|
  | Default-deny `allow` | `openapi.ts` (`loadOperations`) | `e2e.test.ts` "rejects a non-allowlisted tool", "fails when an allow pattern matches nothing" |
  | End-user credentials forwarded, never shown to the model | `http/handler.ts` (`getAuth`), `executor.ts` | `e2e.test.ts` "forwards auth" |
  | Approval for non-GET, bound to exact args | `security/approval.ts`, `graph/tools/operation.ts`, `http/turn.ts` | `e2e.test.ts` "pauses a write", "rejects a tampered approval token", "does not run a rejected write" |
  | Pinned `baseUrl`, SSRF guards | `security/url-guard.ts`, `executor.ts`, `knowledge/fetch-page.ts` | `security/url-guard.test.ts`, `executor.test.ts`, `knowledge/knowledge.test.ts` |
  | Origin, method and content-type checks | `security/origin.ts`, `http/handler.ts` | `e2e.test.ts` "checks origin, method and content type", "cors" |
  | Threads bound to their user | `threads.ts` (`ownsThread`) | `e2e.test.ts` "denies another user's thread", "history" |
  | Passage text reaches the browser only when the host opts in per request | `graph/tools/search.ts`, `http/handler.ts` (`exposeKnowledge`) | `knowledge-expose.e2e.test.ts` "is off by default", "ignores flags sent in the request body" |
  | A dry-run request never sends a write; the request body cannot turn it off | `graph/tools/operation.ts`, `http/handler.ts` (`dryRun`) | `dry-run.e2e.test.ts` "asks for approval, then does not send the write", "cannot be switched on or off from the request body", "treats a throwing callback as a dry run" |
  | Tool output and page context are untrusted data | `security/policy.ts`, `knowledge/format.ts` | `knowledge.e2e.test.ts` "wraps passages as untrusted data" |
  | A conversation summary is untrusted data, and a failed summary keeps the history | `graph/summarize.ts`, `security/policy.ts` (`wrapSummary`) | `summarize.e2e.test.ts` "given to the model as untrusted data", "keeps the history when the summary call fails" |

- Everything in `src/server/` (non-test) must run on edge runtimes: no `node:*` imports, `Buffer`, or `process.` (enforced by `edge-compat.test.ts`, which scans subfolders).
- `src/client/` must not import server code (enforced by `client-isolation.test.ts`).
- Update `website/docs/` and README when public API changes.
- Run `pnpm test && pnpm typecheck && pnpm format:check` before finishing.

## Skill evals

`skills/sideagent/SKILL.md` is tested with `claude plugin eval`. Cases are in `skills/sideagent/evals/` (each has a small fixture app and graders). Run `pnpm eval:skill` (costs about $2 per run, uses your Claude credentials). Run it after any change to `SKILL.md`. Each case must score 1.00 with the skill and clearly above the no-skill baseline. Add a case for every new failure you find.
