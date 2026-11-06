// Reference `builtinModel` for Cloudflare, not exported: website/docs/cloudflare-workers.md shows this file and
// builtin-example.test.ts keeps the two identical (imports aside) and checks that it works.
import type { BuiltinModel } from "../create-server.js";
import { workersAiChatModel, workersAiEmbeddings, type WorkersAiBinding } from "./index.js";

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
