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

`env.AI` is a binding, not an HTTP endpoint, so `sideagent/workers-ai` adapts it to a LangChain chat model, embeddings and an optional reranker. The adapter takes the binding structurally (no `@cloudflare/workers-types` needed) and reads gpt-oss Responses-style output, chat-style `choices[0].message` and `{ response }`.

`builtinModel` is the model you offer every owner next to their own endpoint. You meter it: `consume` counts one message before each new turn and must be atomic, and `usage` reads the count without changing it. The recipe below uses Workers AI for chat and embeddings and one Durable Object per owner as the meter, with a counter per UTC month. Copy it into your Worker:

```ts title="src/builtin.ts"
import type { BuiltinModel } from "sideagent/server";
import { workersAiChatModel, workersAiEmbeddings, type WorkersAiBinding } from "sideagent/workers-ai";

const CHAT_MODEL = "@cf/openai/gpt-oss-120b";
const EMBEDDING_MODEL = "@cf/baai/bge-m3";

/** The part of a Durable Object namespace binding used here; wrangler's `DurableObjectNamespace` fits. */
export interface MeterNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(input: string, init?: RequestInit): Promise<Response> };
}

interface MeterReply {
  allowed: boolean;
  month: string;
  used: number;
  limit: number;
}

/** Workers AI for chat and embeddings, metered per owner by `BuiltinMeter`. */
export function workersAiBuiltin(
  env: { AI: WorkersAiBinding; BUILTIN_METER: MeterNamespace },
  monthlyLimit: number,
): BuiltinModel {
  const embeddings = workersAiEmbeddings(env.AI, EMBEDDING_MODEL);
  const meter = async (op: "consume" | "usage", ownerId: string, now = new Date()): Promise<MeterReply> => {
    const stub = env.BUILTIN_METER.get(env.BUILTIN_METER.idFromName(ownerId));
    const month = now.toISOString().slice(0, 7); // UTC YYYY-MM
    const res = await stub.fetch(`https://meter/${op}`, {
      method: "POST",
      body: JSON.stringify({ month, limit: monthlyLimit }),
    });
    if (!res.ok) throw new Error(`meter answered HTTP ${res.status}`);
    return (await res.json()) as MeterReply;
  };
  return {
    model: CHAT_MODEL,
    embeddingModel: EMBEDDING_MODEL,
    models: () => ({ model: workersAiChatModel(env.AI, CHAT_MODEL), embeddings }),
    // Indexing wants Float32Array vectors; the LangChain embeddings return number[][].
    embed: async (texts) => (await embeddings.embedDocuments(texts)).map((v) => Float32Array.from(v)),
    consume: async (ownerId, now) => ({ allowed: (await meter("consume", ownerId, now)).allowed }),
    usage: async (ownerId, now) => {
      const { month, used, limit } = await meter("usage", ownerId, now);
      return { month, used, limit };
    },
  };
}

interface MeterStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

/** One instance per owner (`idFromName(ownerId)`), one counter per UTC month. */
export class BuiltinMeter {
  #storage: MeterStorage;

  constructor(ctx: { storage: MeterStorage }) {
    this.#storage = ctx.storage;
  }

  async fetch(request: Request): Promise<Response> {
    const { month, limit } = (await request.json()) as { month: string; limit: number };
    const key = `used:${month}`;
    // Input gates hold other requests while storage is awaited, so two consumes cannot read the same count.
    const used = (await this.#storage.get<number>(key)) ?? 0;
    const allowed = used < limit;
    if (new URL(request.url).pathname === "/usage") return Response.json({ allowed, month, used, limit });
    if (allowed) await this.#storage.put(key, used + 1);
    return Response.json({ allowed, month, used: allowed ? used + 1 : used, limit });
  }
}
```

`embed` indexes knowledge and must return `Float32Array` vectors, so the recipe converts the embeddings output. Query embeddings (`models().embeddings`) and indexing use the same model, as they must. Changing `EMBEDDING_MODEL` later is not automatic: every agent on the built-in model answers `knowledge_stale` until its owner re-indexes its knowledge.

Bind the model and the meter in `wrangler.jsonc`:

```jsonc
{
  "ai": { "binding": "AI" },
  "durable_objects": { "bindings": [{ "name": "BUILTIN_METER", "class_name": "BuiltinMeter" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["BuiltinMeter"] }]
}
```

Export the meter class from the Worker entry and pass the model to `createServer`:

```ts
import { workersAiBuiltin } from "./builtin";
export { BuiltinMeter } from "./builtin";

// inside fetch, next to the options above:
server ??= createServer({
  // ...database, publicUrl, secret, background
  builtinModel: workersAiBuiltin(env, 500), // messages per owner per UTC month
});
```

New agents start on the built-in model, so owners can try an agent without an API key. When an owner reaches the limit, new messages get `limit_reached` (HTTP 429) until the next UTC month; approvals and history reads are not counted, and agents on the owner's own endpoint are never counted.
