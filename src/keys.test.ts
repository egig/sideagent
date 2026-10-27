import { describe, expect, it } from "vitest";
import { parsePublishableKey, publishableEndpoint, publishableKey } from "./keys";

const agentId = "agt_abcdefghijkmnpqr";
const enc = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

describe("publishable keys", () => {
  it("round-trips environment, host and agent ID", () => {
    const key = publishableKey("live", "cloud.example.com", agentId);
    expect(key).toMatch(/^pk_live_[A-Za-z0-9_-]+$/);
    expect(parsePublishableKey(key)).toEqual({ environment: "live", host: "cloud.example.com", agentId });
    expect(parsePublishableKey(publishableKey("test", "localhost:5173", agentId))).toEqual({
      environment: "test",
      host: "localhost:5173",
      agentId,
    });
  });

  it("matches the format sideagent Cloud already issued", () => {
    // base64url of "cloud.example.com$agt_abcdefghijkmnpqr", as worker/lib/api-keys.ts minted it.
    expect(publishableKey("live", "cloud.example.com", agentId)).toBe(`pk_live_${enc(`cloud.example.com$${agentId}`)}`);
  });

  it.each([
    ["no prefix", enc(`a.com$${agentId}`)],
    ["unknown environment", `pk_prod_${enc(`a.com$${agentId}`)}`],
    ["not base64url", "pk_live_a+b/c"],
    ["invalid UTF-8", `pk_live_${enc("\xff\xfe$" + agentId)}`],
    ["no separator", `pk_live_${enc(`a.com${agentId}`)}`],
    ["empty host", `pk_live_${enc(`$${agentId}`)}`],
    ["bad agent ID", `pk_live_${enc("a.com$agt_short")}`],
    ["host with a path", `pk_live_${enc(`a.com/x$${agentId}`)}`],
    ["host with a scheme", `pk_live_${enc(`https://a.com$${agentId}`)}`],
  ])("rejects a key with %s", (_, key) => {
    expect(parsePublishableKey(key)).toBeNull();
  });

  it("uses https, and http for loopback hosts only", () => {
    expect(publishableEndpoint({ environment: "live", host: "cloud.example.com", agentId })).toBe(
      `https://cloud.example.com/v1/agents/${agentId}`,
    );
    expect(publishableEndpoint({ environment: "test", host: "localhost:5173", agentId })).toBe(
      `http://localhost:5173/v1/agents/${agentId}`,
    );
    expect(publishableEndpoint({ environment: "test", host: "127.0.0.1", agentId })).toBe(
      `http://127.0.0.1/v1/agents/${agentId}`,
    );
    expect(publishableEndpoint({ environment: "live", host: "localhost.example.com", agentId })).toMatch(/^https:/);
  });
});
