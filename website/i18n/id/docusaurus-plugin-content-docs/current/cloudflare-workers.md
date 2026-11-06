---
sidebar_position: 11
title: Cloudflare Workers
---

`sideagent/server` berjalan di Workers. Gunakan `nodejs_compat` (atau cukup `nodejs_als`) di `wrangler.jsonc`: LangGraph bergantung pada `AsyncLocalStorage`, dan sideagent mendaftarkannya untuk Anda jika runtime menyediakannya.

```jsonc
{ "compatibility_date": "2025-09-01", "compatibility_flags": ["nodejs_compat"] }
```

`sideagent/server` mengarah ke build yang sebenarnya pada kondisi `workerd` dan `worker`. Wrangler dan `@cloudflare/vite-plugin` tidak memerlukan alias.

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

Sajikan dashboard dari static asset Workers: upload `dist/admin-ui` (dibangun oleh `pnpm build` di repository sideagent, dan disertakan dalam paket) dan biarkan API berjalan di origin yang sama. Sign-in lewat email memerlukan `auth.sendMagicLink`.

## Workers AI sebagai built-in model {#workers-ai-as-the-built-in-model}

`env.AI` adalah binding, bukan endpoint HTTP, sehingga `sideagent/workers-ai` mengadaptasinya menjadi model chat LangChain, embedding, dan reranker opsional. Adaptor ini menerima binding secara struktural (tidak memerlukan `@cloudflare/workers-types`) dan membaca keluaran gaya Responses dari gpt-oss, `choices[0].message` gaya chat, serta `{ response }`.

`builtinModel` adalah model yang Anda tawarkan kepada setiap pemilik di samping endpoint mereka sendiri. Anda yang menghitung pemakaiannya: `consume` menghitung satu pesan sebelum setiap turn baru dan harus atomik, sedangkan `usage` membaca hitungan tanpa mengubahnya. Resep di bawah memakai Workers AI untuk chat dan embedding, serta satu Durable Object per pemilik sebagai meter, dengan satu hitungan per bulan UTC. Salin ke Worker Anda:

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

`embed` mengindeks Knowledge Base dan harus mengembalikan vektor `Float32Array`, sehingga resep ini mengonversi keluaran embedding. Query embedding (`models().embeddings`) dan pengindeksan memakai model yang sama, sebagaimana mestinya. Mengganti `EMBEDDING_MODEL` di kemudian hari tidak ditangani otomatis: setiap agent yang memakai built-in model menjawab `knowledge_stale` hingga pemiliknya mengindeks ulang Knowledge Base-nya.

Ikat model dan meter di `wrangler.jsonc`:

```jsonc
{
  "ai": { "binding": "AI" },
  "durable_objects": { "bindings": [{ "name": "BUILTIN_METER", "class_name": "BuiltinMeter" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["BuiltinMeter"] }]
}
```

Ekspor kelas meter dari entri Worker dan berikan model ke `createServer`:

```ts
import { workersAiBuiltin } from "./builtin";
export { BuiltinMeter } from "./builtin";

// inside fetch, next to the options above:
server ??= createServer({
  // ...database, publicUrl, secret, background
  builtinModel: workersAiBuiltin(env, 500), // messages per owner per UTC month
});
```

Agent baru dimulai dengan built-in model, sehingga pemilik dapat mencoba agent tanpa API key. Ketika seorang pemilik mencapai batas, pesan baru mendapat `limit_reached` (HTTP 429) hingga bulan UTC berikutnya; persetujuan dan pembacaan history tidak dihitung, dan agent yang memakai endpoint milik pemilik sendiri tidak pernah dihitung.
