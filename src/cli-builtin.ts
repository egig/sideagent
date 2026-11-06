// The `builtinModel` the CLI builds from environment variables: any OpenAI-compatible endpoint, metered per owner per
// UTC month in memory (one process; the counts reset on restart, so use createServer with a shared meter in production).
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import type { BuiltinModel } from "./create-server.js";

const DEFAULT_MONTHLY_LIMIT = 100;

/** Undefined unless LLM_API_KEY, LLM_MODEL and EMBEDDING_MODEL are all set. */
export function builtinModelFromEnv(env: Record<string, string | undefined>): BuiltinModel | undefined {
  const apiKey = env.LLM_API_KEY;
  const model = env.LLM_MODEL;
  const embeddingModel = env.EMBEDDING_MODEL;
  if (!apiKey || !model || !embeddingModel) return undefined;

  const baseURL = env.LLM_BASE_URL || undefined;
  const parsed = Number(env.BUILTIN_MONTHLY_LIMIT ?? DEFAULT_MONTHLY_LIMIT);
  const limit = Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MONTHLY_LIMIT;
  const embeddings = new OpenAIEmbeddings({ model: embeddingModel, apiKey, configuration: { baseURL } });

  // owner -> `YYYY-MM:count`; one key per owner, replaced when the month changes.
  const counts = new Map<string, { month: string; used: number }>();
  const current = (ownerId: string, now: Date) => {
    const month = now.toISOString().slice(0, 7);
    const entry = counts.get(ownerId);
    return entry?.month === month ? entry : { month, used: 0 };
  };

  return {
    model,
    embeddingModel,
    models: (onError) => ({
      model: new ChatOpenAI({
        model,
        apiKey,
        streaming: true,
        configuration: { baseURL },
        callbacks: [{ handleLLMError: onError }],
      }),
      embeddings,
    }),
    embed: async (texts) => (await embeddings.embedDocuments(texts)).map((v) => Float32Array.from(v)),
    // No await between read and write, so concurrent callers cannot overshoot.
    consume: async (ownerId, now = new Date()) => {
      const entry = current(ownerId, now);
      if (entry.used >= limit) return { allowed: false };
      counts.set(ownerId, { month: entry.month, used: entry.used + 1 });
      return { allowed: true };
    },
    usage: async (ownerId, now = new Date()) => {
      const { month, used } = current(ownerId, now);
      return { month, used, limit };
    },
  };
}
