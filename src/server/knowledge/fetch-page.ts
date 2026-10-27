import { readCapped } from "../executor.js";
import { assertPublicUrl } from "../security/url-guard.js";
import { htmlToText } from "./html.js";

const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 15_000;

export interface FetchPageOptions {
  maxBytes: number;
  allowPrivateNetworks?: boolean;
  fetch?: typeof fetch;
}

/** Fetches a config-listed page. Every hop goes through the SSRF guard; redirects must stay on the same host. */
export async function fetchPage(url: string, opts: FetchPageOptions): Promise<{ title?: string; text: string }> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const target = assertPublicUrl(current, opts.allowPrivateNetworks);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await (opts.fetch ?? fetch)(target, {
        redirect: "manual",
        signal: ctrl.signal,
        headers: { accept: "text/markdown,text/plain,text/html;q=0.9", "user-agent": "sideagent-knowledge" },
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) throw new Error("redirect without location");
        const next = new URL(loc, target);
        if (next.hostname !== target.hostname) throw new Error("cross-host redirect refused");
        current = next.toString();
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const type = (res.headers.get("content-type") ?? "").toLowerCase();
      const { text, truncated } = await readCapped(res, opts.maxBytes);
      if (truncated) throw new Error(`page larger than maxSourceBytes (${opts.maxBytes})`);
      if (type.includes("html")) return htmlToText(text);
      if (type.includes("markdown") || type.startsWith("text/")) return { text };
      throw new Error(`unsupported content-type "${type || "unknown"}"`);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("too many redirects");
}
