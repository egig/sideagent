import { describe, expect, it } from "vitest";
import { builtinModelFromEnv } from "./cli-builtin.js";

const env = {
  LLM_API_KEY: "sk-test",
  LLM_MODEL: "chat-model",
  EMBEDDING_MODEL: "embed-model",
  BUILTIN_MONTHLY_LIMIT: "2",
};

describe("builtinModelFromEnv", () => {
  it("is off unless key, model and embedding model are all set", () => {
    expect(builtinModelFromEnv({})).toBeUndefined();
    expect(builtinModelFromEnv({ ...env, LLM_API_KEY: "" })).toBeUndefined();
    expect(builtinModelFromEnv({ ...env, LLM_MODEL: undefined })).toBeUndefined();
    expect(builtinModelFromEnv({ ...env, EMBEDDING_MODEL: undefined })).toBeUndefined();
  });

  it("names the models and caps each owner per UTC month", async () => {
    const builtin = builtinModelFromEnv(env)!;
    expect([builtin.model, builtin.embeddingModel]).toEqual(["chat-model", "embed-model"]);
    const may = new Date("2026-05-31T23:59:00Z");
    expect(await builtin.consume("a", may)).toEqual({ allowed: true });
    expect(await builtin.consume("a", may)).toEqual({ allowed: true });
    expect(await builtin.consume("a", may)).toEqual({ allowed: false });
    expect(await builtin.usage("a", may)).toEqual({ month: "2026-05", used: 2, limit: 2 });
    expect(await builtin.consume("b", may)).toEqual({ allowed: true });
    expect(await builtin.consume("a", new Date("2026-06-01T00:00:00Z"))).toEqual({ allowed: true });
  });

  it("does not overshoot under concurrent calls", async () => {
    const builtin = builtinModelFromEnv(env)!;
    const results = await Promise.all(Array.from({ length: 5 }, () => builtin.consume("a")));
    expect(results.filter((r) => r.allowed)).toHaveLength(2);
  });

  it("falls back to 100 on a bad limit", async () => {
    const builtin = builtinModelFromEnv({ ...env, BUILTIN_MONTHLY_LIMIT: "abc" })!;
    expect((await builtin.usage("a")).limit).toBe(100);
  });
});
