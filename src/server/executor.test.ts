import { describe, expect, it } from "vitest";
import { executeOperation } from "./executor.js";
import type { Operation } from "./openapi.js";

const op: Operation = {
  operationId: "x", method: "get", path: "/x", description: "", tags: [], params: [], hasBody: false,
  inputSchema: {}, ext: {}, needsApproval: false,
};
const ctx = { baseUrl: "https://api.example.com", headers: {}, callTimeoutMs: 1000, maxResultBytes: 50 };

describe("executeOperation", () => {
  it("does not follow redirects", async () => {
    const fetchMock = (async (_u: any, init: any) => {
      expect(init.redirect).toBe("manual");
      return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } });
    }) as typeof fetch;
    const r = await executeOperation(op, {}, { ...ctx, fetch: fetchMock });
    expect(r.status).toBe(302);
  });
  it("truncates oversized results", async () => {
    const fetchMock = (async () => new Response("x".repeat(500))) as typeof fetch;
    const r = await executeOperation(op, {}, { ...ctx, fetch: fetchMock });
    expect(r.truncated).toBe(true);
    expect(String(r.body).length).toBe(50);
  });
  it("refuses to call a metadata baseUrl", async () => {
    await expect(executeOperation(op, {}, { ...ctx, baseUrl: "http://169.254.169.254" })).rejects.toThrow(/metadata/);
  });
});
