---
sidebar_position: 11
title: Cloudflare Workers
---

`sideagent/server` runs on Workers. Use `nodejs_compat` (or just `nodejs_als`) in `wrangler.jsonc`. LangGraph relies on `AsyncLocalStorage`, and the Workers build of LangGraph does not register it. sideagent registers it for you when the runtime has it.

```jsonc
{ "compatibility_date": "2025-09-01", "compatibility_flags": ["nodejs_compat"] }
```

**Export conditions.** `sideagent/server` resolves to the real build under `workerd` and `worker`, listed before `browser` (which stays a throwing stub for real browser bundles). Wrangler (esbuild) and `@cloudflare/vite-plugin` need no alias. Both also set `browser`, so the order in `exports` matters.

**Workers AI as the LLM.** `env.AI` is a binding, not an HTTP endpoint, so use the adapter from `sideagent/workers-ai` instead of `llm`:

```ts
import { createAgent } from "sideagent/server";
import { workersAiChatModel, workersAiEmbeddings, workersAiReranker } from "sideagent/workers-ai";

export default {
  async fetch(request: Request, env: Env) {
    agent ??= await createAgent({
      allowedOrigins: ["https://app.example.com"],
      getAuth,
      model: workersAiChatModel(env.AI, "@cf/openai/gpt-oss-120b"),
      knowledge: { sources },
      embeddings: workersAiEmbeddings(env.AI, "@cf/baai/bge-m3"), // replaces knowledge.embeddings
      reranker: workersAiReranker(env.AI),
    });
    return agent.handler(request);
  },
};
let agent: Awaited<ReturnType<typeof createAgent>> | undefined;
```

`model` and `llm` are mutually exclusive; so are the `embeddings` option and `knowledge.embeddings`. `model` can be any LangChain chat model that supports `bindTools()`. `doctor()` checks an injected model with one `invoke`, not an HTTP call. The adapter takes the binding structurally (no `@cloudflare/workers-types` needed) and reads gpt-oss Responses-style output, chat-style `choices[0].message` and `{ response }`.

`workersAiReranker(env.AI)` uses the Workers AI cross-encoder `@cf/baai/bge-reranker-base` by default. Pass another Workers AI model id as the second argument to select a compatible reranker.

A custom `checkpointer` (D1, Durable Object storage) is a `BaseCheckpointSaver` with four methods: `getTuple`, `list`, `put`, `putWrites`. sideagent also calls `deleteThread` when a user deletes a thread.
