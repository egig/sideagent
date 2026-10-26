import { describe, expect, it } from "vitest";
import { assertAllowedUrl } from "./url-guard.js";

const opts = { baseUrl: "https://api.example.com" };

describe("assertAllowedUrl", () => {
  it("allows same-origin urls", () => {
    expect(assertAllowedUrl("https://api.example.com/v1/x", opts).pathname).toBe("/v1/x");
  });
  it("blocks other origins", () => {
    expect(() => assertAllowedUrl("https://evil.com/x", opts)).toThrow(/origin/);
  });
  it("blocks non-http schemes", () => {
    expect(() => assertAllowedUrl("file:///etc/passwd", opts)).toThrow(/scheme/);
  });
  it("blocks metadata address even when private networks allowed", () => {
    const o = { baseUrl: "http://169.254.169.254", allowPrivateNetworks: true };
    expect(() => assertAllowedUrl("http://169.254.169.254/latest/meta-data", o)).toThrow(/metadata/);
  });
  it("blocks metadata redirect target", () => {
    expect(() => assertAllowedUrl("http://169.254.169.254/", opts)).toThrow(/metadata/);
  });
});

describe("edge-safe ipv6 handling", () => {
  it("blocks ipv4-mapped metadata address", () => {
    expect(() => assertAllowedUrl("http://[::ffff:169.254.169.254]/", opts)).toThrow(/metadata/);
  });
  it("blocks private ipv4-mapped address by default", () => {
    const o = { baseUrl: "https://api.example.com" };
    expect(() => assertAllowedUrl("http://[::ffff:10.0.0.1]/", o)).toThrow();
  });
});
