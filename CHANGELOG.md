# Changelog

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

- A Cloud agent can say it is unavailable: `agent.info` may answer `{ "name": "…", "available": false }` when the agent will refuse every message (a usage cap is reached). `AgentChat` then renders nothing, launcher included, and `useAgent()` returns `available: false` so an app can hide its own "ask" button. Checked once per page load; a cap reached mid-conversation still shows as an error in the chat.
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
- sideagent Cloud agents with token verification (JWKS or a userinfo URL) need both for the documented embed.
- Wire format (`src/protocol.ts`) unchanged.

## 0.3.0

- New `publishableKey` prop on `AgentChat` and `AgentProvider` for agents hosted on sideagent Cloud. The chat derives the endpoint from the key (https, http for `localhost` and `127.0.0.1`) and sends the key in the `x-sideagent-key` header. `endpoint` is now optional and, when given with a key, overrides the derived URL. A malformed key, or neither prop, throws during render.
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
