---
sidebar_position: 11
title: Cloudflare Workers
---

`sideagent/server` runs on Workers. Use `nodejs_compat` (or just `nodejs_als`) in `wrangler.jsonc`: LangGraph relies on `AsyncLocalStorage`, and sideagent registers it for you when the runtime has it.

```jsonc
{ "compatibility_date": "2025-09-01", "compatibility_flags": ["nodejs_compat"] }
```

`sideagent/server` resolves to the real build under `workerd` and `worker`. Wrangler and `@cloudflare/vite-plugin` need no alias.

```ts
import { drizzle } from "drizzle-orm/node-postgres";
import { createServer } from "sideagent/server";

let server: ReturnType<typeof createServer> | undefined;

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    // Hyperdrive gives a pooled connection; build the Drizzle database from it.
    server ??= createServer({
      database: drizzle(env.HYPERDRIVE.connectionString),
      publicUrl: env.PUBLIC_URL,
      secret: env.SIDEAGENT_SECRET,
      background: (work) => ctx.waitUntil(work()),
    });
    return server.fetch(request);
  },
};
```

Serve the dashboard from Workers static assets: upload `dist/admin-ui` (built by `pnpm build` in the sideagent repository, shipped in the package) and let the API run on the same origin. Email sign-in needs `auth.sendMagicLink`.

## Workers AI as the built-in model

`env.AI` is a binding, not an HTTP endpoint, so `sideagent/workers-ai` adapts it to a LangChain chat model, embeddings and an optional reranker. Use them to implement `builtinModel`, the model you offer your users next to their own:

```ts
import { workersAiChatModel, workersAiEmbeddings } from "sideagent/workers-ai";

builtinModel: {
  model: "@cf/openai/gpt-oss-120b",
  embeddingModel: "@cf/baai/bge-m3",
  models: () => ({
    model: workersAiChatModel(env.AI, "@cf/openai/gpt-oss-120b"),
    embeddings: workersAiEmbeddings(env.AI, "@cf/baai/bge-m3"),
  }),
  embed: (texts) => embedWithWorkersAi(env.AI, texts),
  consume: (ownerId) => meter.consume(ownerId),
  usage: (ownerId) => meter.usage(ownerId),
},
```

The adapter takes the binding structurally (no `@cloudflare/workers-types` needed) and reads gpt-oss Responses-style output, chat-style `choices[0].message` and `{ response }`.
