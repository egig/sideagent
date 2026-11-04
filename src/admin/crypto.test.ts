import { describe, expect, it } from "vitest";
import { open, seal } from "./crypto.js";
import { parsePublishableKey, publishableKey } from "../keys.js";

const env = { CONFIG_KEK: btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))) };

describe("envelope encryption", () => {
  it("round-trips and never contains the plaintext", async () => {
    const sealed = await seal(env, "agt_a", "llmKey", "sk-canary-0123456789");
    expect(sealed).not.toContain("canary");
    expect(await open(env, "agt_a", "llmKey", sealed)).toBe("sk-canary-0123456789");
    expect(await seal(env, "agt_a", "llmKey", "same")).not.toBe(await seal(env, "agt_a", "llmKey", "same"));
  });

  it("binds the agent and field, and rejects tampering and other keys", async () => {
    const sealed = await seal(env, "agt_a", "llmKey", "secret");
    await expect(open(env, "agt_b", "llmKey", sealed)).rejects.toThrow();
    await expect(open(env, "agt_a", "other", sealed)).rejects.toThrow();
    const parts = sealed.split(".");
    parts[4] = parts[4]!.slice(0, -2) + (parts[4]!.endsWith("A") ? "BB" : "AA");
    await expect(open(env, "agt_a", "llmKey", parts.join("."))).rejects.toThrow();
    const other = { CONFIG_KEK: btoa(String.fromCharCode(...new Uint8Array(32))) };
    await expect(open(other, "agt_a", "llmKey", sealed)).rejects.toThrow();
  });

  it("refuses to run without a 32-byte key", async () => {
    await expect(seal({ CONFIG_KEK: "" }, "agt_a", "f", "x")).rejects.toThrow(/CONFIG_KEK/);
    await expect(seal({ CONFIG_KEK: btoa("short") }, "agt_a", "f", "x")).rejects.toThrow(/32 bytes/);
  });
});

describe("publishable keys", () => {
  const id = "agt_abcdefghijk23456";
  it("encodes host and agent", () => {
    const key = publishableKey("cloud.sideagent.dev", id);
    expect(key).toMatch(/^pk_[A-Za-z0-9_-]+$/);
    expect(parsePublishableKey(key)).toEqual({ host: "cloud.sideagent.dev", agentId: id });
    expect(parsePublishableKey(publishableKey("localhost:5173", id))).toEqual({ host: "localhost:5173", agentId: id });
  });

  it.each(["", "pk_", "sk_abc", "pk_!!!", `pk_${btoa("host-only")}`, `pk_live_${btoa(`a.com$${id}`)}`])(
    "rejects %s",
    (key) => {
      expect(parsePublishableKey(key)).toBeNull();
    },
  );

  it("rejects a tampered agent ID", () => {
    const tampered = `pk_${btoa(`cloud.sideagent.dev$agt_../../x`).replace(/=+$/, "")}`;
    expect(parsePublishableKey(tampered)).toBeNull();
  });
});
