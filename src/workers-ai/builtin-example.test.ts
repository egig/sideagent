import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BuiltinMeter, workersAiBuiltin, type MeterNamespace } from "./builtin-example.js";
import type { WorkersAiBinding } from "./index.js";

// One BuiltinMeter per name, each with its own storage, as Durable Objects are.
function fakeNamespace() {
  const meters = new Map<string, BuiltinMeter>();
  const ns: MeterNamespace = {
    idFromName: (name) => name,
    get(id) {
      const name = id as string;
      if (!meters.has(name)) {
        const data = new Map<string, unknown>();
        const storage = {
          get: async <T>(key: string) => data.get(key) as T | undefined,
          put: async <T>(key: string, value: T) => void data.set(key, value),
        };
        meters.set(name, new BuiltinMeter({ storage }));
      }
      const meter = meters.get(name)!;
      return { fetch: (input, init) => meter.fetch(new Request(input, init)) };
    },
  };
  return ns;
}

function setup(limit = 2) {
  const calls: { model: string; input: any }[] = [];
  const AI: WorkersAiBinding = {
    async run(model, input: any) {
      calls.push({ model, input });
      return { data: input.text.map((_: string, i: number) => [i, 0.5]) };
    },
  };
  return { builtin: workersAiBuiltin({ AI, BUILTIN_METER: fakeNamespace() }, limit), calls };
}

const nov = new Date("2026-11-06T12:00:00Z");
const dec = new Date("2026-12-01T00:00:00Z");

describe("workersAiBuiltin (the Cloudflare docs recipe)", () => {
  it("names its models and embeds with the one it names", async () => {
    const { builtin, calls } = setup();
    expect(builtin.model).toBe("@cf/openai/gpt-oss-120b");
    expect(builtin.embeddingModel).toBe("@cf/baai/bge-m3");
    const vectors = await builtin.embed(["a", "b"]);
    expect(vectors).toEqual([Float32Array.from([0, 0.5]), Float32Array.from([1, 0.5])]);
    expect(vectors[0]).toBeInstanceOf(Float32Array);
    expect(calls[0]!.model).toBe(builtin.embeddingModel);
    const { model, embeddings } = builtin.models(() => {});
    expect(model).toBeDefined();
    expect(await embeddings!.embedQuery("q")).toEqual([0, 0.5]);
  });

  it("allows messages up to the monthly limit and refuses the rest", async () => {
    const { builtin } = setup(2);
    expect(await builtin.consume("o1", nov)).toEqual({ allowed: true });
    expect(await builtin.consume("o1", nov)).toEqual({ allowed: true });
    expect(await builtin.consume("o1", nov)).toEqual({ allowed: false });
    expect(await builtin.usage("o1", nov)).toEqual({ month: "2026-11", used: 2, limit: 2 });
  });

  it("reads usage without counting", async () => {
    const { builtin } = setup(2);
    await builtin.usage("o1", nov);
    await builtin.usage("o1", nov);
    expect(await builtin.usage("o1", nov)).toEqual({ month: "2026-11", used: 0, limit: 2 });
  });

  it("counts each owner and each UTC month apart", async () => {
    const { builtin } = setup(1);
    expect(await builtin.consume("o1", nov)).toEqual({ allowed: true });
    expect(await builtin.consume("o1", nov)).toEqual({ allowed: false });
    expect(await builtin.consume("o2", nov)).toEqual({ allowed: true });
    expect(await builtin.consume("o1", dec)).toEqual({ allowed: true });
    expect(await builtin.usage("o1", dec)).toEqual({ month: "2026-12", used: 1, limit: 1 });
  });

  it("fails loudly when the meter answers an error", async () => {
    const AI: WorkersAiBinding = { run: async () => ({}) };
    const broken: MeterNamespace = {
      idFromName: (n) => n,
      get: () => ({ fetch: async () => new Response("no", { status: 500 }) }),
    };
    await expect(workersAiBuiltin({ AI, BUILTIN_METER: broken }, 1).consume("o1")).rejects.toThrow("HTTP 500");
  });

  it("is the code the Cloudflare docs show", () => {
    const docs = readFileSync(join(__dirname, "../../website/docs/cloudflare-workers.md"), "utf8");
    const shown = /```ts title="src\/builtin\.ts"\n([\s\S]*?)```/.exec(docs)?.[1];
    const source = readFileSync(join(__dirname, "builtin-example.ts"), "utf8")
      .replace(/^(\/\/.*\n)+/, "")
      .replace('"../create-server.js"', '"sideagent/server"')
      .replace('"./index.js"', '"sideagent/workers-ai"');
    expect(shown).toBe(source);
  });
});
