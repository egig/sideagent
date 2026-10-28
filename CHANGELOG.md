# Changelog

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
