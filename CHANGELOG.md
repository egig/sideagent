# Changelog

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
