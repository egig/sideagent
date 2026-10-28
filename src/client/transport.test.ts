import { afterEach, describe, expect, it, vi } from "vitest";
import { threadKey } from "./storage";
import { callJson, fetchAgentName, streamChat } from "./transport";

const sent: Headers[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  sent.length = 0;
});
function mockFetch() {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    sent.push(new Headers(init?.headers));
    return new Response('data: {"type":"turn.end"}\n\n', { headers: { "content-type": "text/event-stream" } });
  });
}
const drain = async <T>(it: AsyncGenerator<T>) => {
  const out: T[] = [];
  for await (const e of it) out.push(e);
  return out;
};

describe("getHeaders", () => {
  it("is called before every request and merged under the static headers", async () => {
    mockFetch();
    let n = 0;
    const getHeaders = async () => ({ authorization: `Bearer t${++n}`, "x-sideagent-key": "forged" });
    const opts = { endpoint: "/agent", headers: { "x-sideagent-key": "pk_live_x" }, getHeaders };
    await drain(streamChat({ message: "hi" }, opts));
    await callJson({ action: "threads.list" }, opts);
    expect(sent.map((h) => h.get("authorization"))).toEqual(["Bearer t1", "Bearer t2"]);
    expect(sent.every((h) => h.get("x-sideagent-key") === "pk_live_x")).toBe(true);
    expect(sent[0]!.get("content-type")).toBe("application/json");
  });

  it("sends nothing when it throws", async () => {
    mockFetch();
    const getHeaders = async () => {
      throw new Error("signed out");
    };
    expect(await drain(streamChat({ message: "hi" }, { endpoint: "/agent", getHeaders }))).toEqual([
      { type: "error", code: "headers_failed", message: "Could not get credentials. Sign in again." },
    ]);
    expect(await callJson({ action: "threads.list" }, { endpoint: "/agent", getHeaders })).toEqual({
      status: 0,
      data: null,
    });
    expect(sent).toHaveLength(0);
  });
});

describe("storageKey", () => {
  it("keeps each user's remembered thread apart", () => {
    expect(threadKey("/agent")).toBe("sideagent:thread:/agent");
    expect(threadKey("/agent", "u1")).toBe("sideagent:thread:/agent:u1");
    expect(threadKey("/agent", "u1")).not.toBe(threadKey("/agent", "u2"));
  });
});

describe("fetchAgentName", () => {
  const reply = (status: number, body: unknown) =>
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify(body), { status }));

  it("returns the name and asks once per endpoint", async () => {
    const f = reply(200, { name: "Billing helper" });
    expect(await fetchAgentName({ endpoint: "/a" })).toBe("Billing helper");
    expect(await fetchAgentName({ endpoint: "/a" })).toBe("Billing helper");
    expect(f).toHaveBeenCalledTimes(1);
    expect(JSON.parse(f.mock.calls[0]![1]!.body as string)).toEqual({ action: "agent.info" });
  });

  it("is null for an error, an empty name or a network failure, and retries after", async () => {
    reply(400, { error: "invalid request" });
    expect(await fetchAgentName({ endpoint: "/b" })).toBeNull();
    reply(200, { name: "  " });
    expect(await fetchAgentName({ endpoint: "/b" })).toBeNull();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    expect(await fetchAgentName({ endpoint: "/b" })).toBeNull();
    reply(200, { name: "Back" });
    expect(await fetchAgentName({ endpoint: "/b" })).toBe("Back");
  });
});
