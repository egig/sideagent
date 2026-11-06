import { afterEach, describe, expect, it, vi } from "vitest";
import { threadKey } from "./storage";
import { callJson, fetchAgentInfo, streamChat, streamTurn } from "./transport";

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
    const opts = { endpoint: "/agent", headers: { "x-sideagent-key": "pk_x" }, getHeaders };
    await drain(streamChat({ message: "hi" }, opts));
    await callJson({ action: "threads.list" }, opts);
    expect(sent.map((h) => h.get("authorization"))).toEqual(["Bearer t1", "Bearer t2"]);
    expect(sent.every((h) => h.get("x-sideagent-key") === "pk_x")).toBe(true);
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

describe("fetchAgentInfo", () => {
  const reply = (status: number, body: unknown) =>
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify(body), { status }));

  it("returns the name and asks once per endpoint", async () => {
    const f = reply(200, { name: "Billing helper" });
    expect(await fetchAgentInfo({ endpoint: "/a" })).toEqual({ name: "Billing helper", available: true });
    expect(await fetchAgentInfo({ endpoint: "/a" })).toEqual({ name: "Billing helper", available: true });
    expect(f).toHaveBeenCalledTimes(1);
    expect(JSON.parse(f.mock.calls[0]![1]!.body as string)).toEqual({ action: "agent.info" });
  });

  it("reports an agent that says it is unavailable", async () => {
    reply(200, { name: "Docs", available: false });
    expect(await fetchAgentInfo({ endpoint: "/c" })).toEqual({ name: "Docs", available: false });
  });

  it("is null for an error, an empty name or a network failure, and retries after", async () => {
    reply(400, { error: "invalid request" });
    expect(await fetchAgentInfo({ endpoint: "/b" })).toBeNull();
    reply(200, { name: "  " });
    expect(await fetchAgentInfo({ endpoint: "/b" })).toBeNull();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    expect(await fetchAgentInfo({ endpoint: "/b" })).toBeNull();
    reply(200, { name: "Back" });
    expect(await fetchAgentInfo({ endpoint: "/b" })).toEqual({ name: "Back", available: true });
  });
});

const enc = new TextEncoder();
/** A response whose body delivers `chunks` and then ends, or errors when `fail` is set. */
function sse(chunks: string[], fail?: Error) {
  let i = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(c) {
        if (i < chunks.length) c.enqueue(enc.encode(chunks[i++]));
        else if (fail) c.error(fail);
        else c.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}
const ev = (e: unknown) => `data: ${JSON.stringify(e)}\n\n`;
const run = async (body = {}) => drain(streamChat({ message: "hi", ...body }, { endpoint: "/agent" }));

describe("streamChat", () => {
  it("yields events in order, across chunk boundaries", async () => {
    const whole =
      ev({ type: "turn.start", threadId: "t" }) + ev({ type: "text.delta", text: "a" }) + ev({ type: "turn.end" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(sse([whole.slice(0, 20), whole.slice(20, 61), whole.slice(61)]));
    expect((await run()).map((e) => e.type)).toEqual(["turn.start", "text.delta", "turn.end"]);
  });

  it("reads CRLF line endings", async () => {
    const crlf =
      ev({ type: "text.delta", text: "a" }).replace(/\n/g, "\r\n") + ev({ type: "turn.end" }).replace(/\n/g, "\r\n");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(sse([crlf]));
    expect((await run()).map((e) => e.type)).toEqual(["text.delta", "turn.end"]);
  });

  it("skips a block that is not JSON instead of failing the turn", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sse([": keep-alive\n\n", "data: {broken\n\n", ev({ type: "turn.end" })]),
    );
    expect((await run()).map((e) => e.type)).toEqual(["turn.end"]);
  });

  it("says so when the stream ends without turn.end", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(sse([ev({ type: "text.delta", text: "half an ans" })]));
    expect(await run()).toEqual([
      { type: "text.delta", text: "half an ans" },
      expect.objectContaining({ type: "error", code: "stream_interrupted" }),
    ]);
  });

  it("turns a connection that breaks mid-stream into the same error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sse([ev({ type: "text.delta", text: "half" })], new TypeError("network error")),
    );
    expect((await run()).map((e) => e.type === "error" && e.code)).toEqual([false, "stream_interrupted"]);
  });

  it("turns a failed request into an error event", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await run()).toEqual([expect.objectContaining({ type: "error", code: "network" })]);
  });

  it("reports the server's own error text for a refused request", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ error: "thread not found" }, { status: 404 }));
    expect(await run()).toEqual([{ type: "error", code: "http_404", message: "thread not found" }]);
  });

  it("rethrows the caller's own abort, and adds nothing after it", async () => {
    const ac = new AbortController();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      ac.abort();
      throw new DOMException("aborted", "AbortError");
    });
    await expect(drain(streamChat({ message: "hi" }, { endpoint: "/agent", signal: ac.signal }))).rejects.toThrow(
      "aborted",
    );

    const ac2 = new AbortController();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sse([ev({ type: "text.delta", text: "a" })], new DOMException("aborted", "AbortError")),
    );
    const it2 = streamChat({ message: "hi" }, { endpoint: "/agent", signal: ac2.signal });
    await it2.next();
    ac2.abort();
    await expect(it2.next()).rejects.toThrow("aborted");
  });
});

describe("streamTurn", () => {
  const ok = () => sse([ev({ type: "turn.start", threadId: "new" }), ev({ type: "turn.end" })]);
  const gone = () => Response.json({ error: "thread not found" }, { status: 404 });
  const bodies = () =>
    (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => JSON.parse(String(c[1]?.body)));

  it("starts a new conversation when the server no longer has the thread", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(gone()).mockResolvedValueOnce(ok());
    let lost = 0;
    const out = await drain(streamTurn({ threadId: "old", message: "hi" }, { endpoint: "/agent" }, () => lost++));
    expect(lost).toBe(1);
    expect(out.map((e) => e.type)).toEqual(["turn.start", "turn.end"]);
    expect(bodies()).toEqual([{ threadId: "old", message: "hi" }, { message: "hi" }]);
  });

  it("asks again only once", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => gone());
    const out = await drain(streamTurn({ threadId: "old", message: "hi" }, { endpoint: "/agent" }, () => {}));
    expect(out).toEqual([expect.objectContaining({ code: "http_404" })]);
    expect(bodies()).toHaveLength(2);
  });

  it("does not retry other errors, or a turn that had no thread", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ error: "busy" }, { status: 429 }));
    let lost = 0;
    await drain(streamTurn({ threadId: "t", message: "hi" }, { endpoint: "/agent" }, () => lost++));
    await drain(streamTurn({ message: "hi" }, { endpoint: "/agent" }, () => lost++));
    expect(lost).toBe(0);
    expect(bodies()).toHaveLength(2);
  });

  it("passes a normal turn through untouched", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ok());
    let lost = 0;
    const out = await drain(streamTurn({ threadId: "t", message: "hi" }, { endpoint: "/agent" }, () => lost++));
    expect(out.map((e) => e.type)).toEqual(["turn.start", "turn.end"]);
    expect(lost).toBe(0);
  });
});
