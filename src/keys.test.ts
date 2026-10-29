import { describe, expect, it } from "vitest";
import { parsePublishableKey, publishableEndpoint, publishableKey } from "./keys";

const agentId = "agt_abcdefghijkmnpqr";
const enc = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

describe("publishable keys", () => {
  it("round-trips host and agent ID", () => {
    const key = publishableKey("cloud.example.com", agentId);
    expect(key).toMatch(/^pk_[A-Za-z0-9_-]+$/);
    expect(parsePublishableKey(key)).toEqual({ host: "cloud.example.com", agentId });
    expect(parsePublishableKey(publishableKey("localhost:5173", agentId))).toEqual({ host: "localhost:5173", agentId });
  });

  it("is pk_ plus the base64url of host$agentId", () => {
    expect(publishableKey("cloud.example.com", agentId)).toBe(`pk_${enc(`cloud.example.com$${agentId}`)}`);
  });

  it.each([
    ["no prefix", enc(`a.com$${agentId}`)],
    ["an old environment segment", "pk_live_" + enc(`a.com$${agentId}`)],
    ["not base64url", "pk_a+b/c"],
    ["invalid UTF-8", `pk_${enc("\xff\xfe$" + agentId)}`],
    ["no separator", `pk_${enc(`a.com${agentId}`)}`],
    ["empty host", `pk_${enc(`$${agentId}`)}`],
    ["bad agent ID", `pk_${enc("a.com$agt_short")}`],
    ["host with a path", `pk_${enc(`a.com/x$${agentId}`)}`],
    ["host with a scheme", `pk_${enc(`https://a.com$${agentId}`)}`],
  ])("rejects a key with %s", (_, key) => {
    expect(parsePublishableKey(key)).toBeNull();
  });

  it("uses https, and http for loopback hosts only", () => {
    expect(publishableEndpoint({ host: "cloud.example.com", agentId })).toBe(
      `https://cloud.example.com/v1/agents/${agentId}`,
    );
    expect(publishableEndpoint({ host: "localhost:5173", agentId })).toBe(`http://localhost:5173/v1/agents/${agentId}`);
    expect(publishableEndpoint({ host: "127.0.0.1", agentId })).toBe(`http://127.0.0.1/v1/agents/${agentId}`);
    expect(publishableEndpoint({ host: "localhost.example.com", agentId })).toMatch(/^https:/);
  });
});
