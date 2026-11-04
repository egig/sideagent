import { describe, expect, it } from "vitest";
import { guardedFetch } from "./guarded-fetch.js";
import { BlockedUrlError } from "./url-guard.js";

const resolve = async (host: string) => (host.endsWith("private.example") ? ["10.0.0.9"] : ["93.184.216.34"]);

describe("guardedFetch", () => {
  it("passes a public host through and refuses redirects", async () => {
    const seen: RequestInit[] = [];
    const f = guardedFetch(resolve, async (_i, init) => (seen.push(init!), new Response("ok")));
    expect(await (await f("https://llm.example.com/v1/chat/completions", { method: "POST" })).text()).toBe("ok");
    expect(seen[0]!.redirect).toBe("error");
  });

  it("blocks a host that resolves to a private address, without calling out", async () => {
    let called = false;
    const f = guardedFetch(resolve, async () => ((called = true), new Response("no")));
    await expect(f("https://llm.private.example/v1/embeddings")).rejects.toBeInstanceOf(BlockedUrlError);
    expect(called).toBe(false);
  });

  it("blocks literal internal addresses, plain http and credentials in the URL", async () => {
    const f = guardedFetch(resolve, async () => new Response("no"));
    for (const url of [
      "https://10.0.0.1/v1",
      "https://169.254.169.254/latest",
      "http://llm.example.com/v1",
      "https://u:p@llm.example.com/v1",
    ]) {
      await expect(f(url)).rejects.toBeInstanceOf(BlockedUrlError);
    }
  });

  it("checks the URL of a Request object too", async () => {
    const f = guardedFetch(resolve, async () => new Response("no"));
    await expect(f(new Request("https://llm.private.example/v1"))).rejects.toBeInstanceOf(BlockedUrlError);
  });
});
