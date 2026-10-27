import { describe, expect, it } from "vitest";
import { publishableKey } from "../keys";
import { resolveTarget } from "./target";

const key = publishableKey("live", "cloud.example.com", "agt_abcdefghijkmnpqr");

describe("resolveTarget", () => {
  it("keeps a plain endpoint and sends no key header", () => {
    expect(resolveTarget({ endpoint: "/agent", headers: { a: "1" } })).toEqual({
      endpoint: "/agent",
      headers: { a: "1" },
    });
  });

  it("derives the endpoint from the publishable key and sends the key header", () => {
    expect(resolveTarget({ publishableKey: key, headers: { authorization: "Bearer t" } })).toEqual({
      endpoint: "https://cloud.example.com/v1/agents/agt_abcdefghijkmnpqr",
      headers: { authorization: "Bearer t", "x-sideagent-key": key },
    });
  });

  it("lets an explicit endpoint override the derived one", () => {
    expect(resolveTarget({ publishableKey: key, endpoint: "/cloud-proxy" })).toEqual({
      endpoint: "/cloud-proxy",
      headers: { "x-sideagent-key": key },
    });
  });

  it("does not let headers replace the key", () => {
    expect(resolveTarget({ publishableKey: key, headers: { "x-sideagent-key": "other" } }).headers).toEqual({
      "x-sideagent-key": key,
    });
  });

  it("throws on a malformed key or when neither prop is set", () => {
    expect(() => resolveTarget({ publishableKey: "pk_live_nope" })).toThrow("sideagent: invalid publishableKey");
    expect(() => resolveTarget({ publishableKey: "" })).toThrow("sideagent: invalid publishableKey");
    expect(() => resolveTarget({})).toThrow("sideagent: pass endpoint or publishableKey");
  });
});
