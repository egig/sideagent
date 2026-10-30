import { describe, expect, it } from "vitest";
import { assertPublicUrl } from "./url-guard.js";

describe("assertPublicUrl", () => {
  it("allows public http(s) hosts", () => {
    expect(assertPublicUrl("https://docs.example.com/guide").pathname).toBe("/guide");
  });
  it("blocks non-http schemes", () => {
    expect(() => assertPublicUrl("file:///etc/passwd")).toThrow(/scheme/);
  });
  it("blocks private hosts unless allowed", () => {
    expect(() => assertPublicUrl("http://10.0.0.1/x")).toThrow(/private/);
    expect(assertPublicUrl("http://10.0.0.1/x", true).hostname).toBe("10.0.0.1");
  });
  it("blocks the metadata address even when private networks are allowed", () => {
    expect(() => assertPublicUrl("http://169.254.169.254/latest/meta-data", true)).toThrow(/metadata/);
  });
});

describe("edge-safe ipv6 handling", () => {
  it("blocks ipv4-mapped metadata address", () => {
    expect(() => assertPublicUrl("http://[::ffff:169.254.169.254]/")).toThrow(/metadata/);
  });
  it("blocks private ipv4-mapped address by default", () => {
    expect(() => assertPublicUrl("http://[::ffff:10.0.0.1]/")).toThrow();
  });
});
