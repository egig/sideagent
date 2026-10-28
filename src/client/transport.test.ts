import { afterEach, describe, expect, it, vi } from "vitest";
import { threadKey } from "./storage";
import { callJson, streamChat } from "./transport";

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
