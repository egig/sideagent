# sideagent

Library that embeds a chat agent in an app: OpenAPI spec + OpenAI-compatible LLM in, secure agent endpoint (`sideagent/server`) and React chat UI (`sideagent`) out.

## Commands

- `pnpm install`
- `pnpm test` — vitest (uses `src/testing/mock-llm.ts`, no API key needed)
- `pnpm typecheck`
- `pnpm build` — tsup to `dist/`
- `pnpm demo` — demo API on :8787 + vite UI on :5173 (scripted mock LLM unless `LLM_API_KEY` is set)
- Docs: `pnpm --dir website install && pnpm --dir website build`

## Layout

- `src/server/` — `createAgent`, config, executor (OpenAPI → tools), policy, approval, url-guard (SSRF), knowledge, threads, adapters (Hono/Next/Express)
- `src/client/` — `AgentChat`, `AgentProvider`, hooks, transport
- `src/protocol.ts` — wire types shared by both sides
- `src/testing/` — mock LLM, exported as `sideagent/testing`
- `demo/` — example app; `website/docs/` — Docusaurus docs (source of `llms.txt`)

## Rules

- Security defaults are the product. Do not weaken: default-deny `allow`, end-user credentials forwarded, approval for non-GET bound to exact args, pinned `baseUrl`, SSRF guards, origin checks. Any change here needs a test.
- Everything in `src/server/` (non-test) must run on edge runtimes: no `node:*` imports, `Buffer`, or `process.` (enforced by `edge-compat.test.ts`).
- Update `website/docs/` and README when public API changes.
- Run `pnpm test && pnpm typecheck` before finishing.

## Skill evals

`skills/sideagent/SKILL.md` is tested with `claude plugin eval`. Cases are in `skills/sideagent/evals/` (each has a small fixture app and graders). Run `pnpm eval:skill` (costs about $2 per run, uses your Claude credentials). Run it after any change to `SKILL.md`. Each case must score 1.00 with the skill and clearly above the no-skill baseline. Add a case for every new failure you find.
