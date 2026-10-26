import { assertAllowedUrl } from "./url-guard.js";
import type { Operation } from "./openapi.js";

export interface ExecContext {
  baseUrl: string;
  headers: Record<string, string>;
  callTimeoutMs: number;
  maxResultBytes: number;
  allowPrivateNetworks?: boolean;
  fetch?: typeof fetch;
}

export interface ExecResult {
  status: number;
  body: unknown;
  truncated: boolean;
}

function pickFields(value: unknown, fields: Set<string>): unknown {
  if (Array.isArray(value)) return value.map((v) => pickFields(v, fields));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (fields.has(k)) out[k] = pickFields(v, fields);
    return out;
  }
  return value;
}

export function buildUrl(op: Operation, args: Record<string, any>, baseUrl: string): string {
  const base = new URL(baseUrl);
  let path = op.path;
  for (const p of op.params.filter((x) => x.in === "path")) {
    path = path.replace(`{${p.name}}`, encodeURIComponent(String(args[p.name])));
  }
  const url = new URL(base.origin + base.pathname.replace(/\/$/, "") + path);
  for (const p of op.params.filter((x) => x.in === "query")) {
    const v = args[p.name];
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) for (const item of v) url.searchParams.append(p.name, String(item));
    else url.searchParams.set(p.name, String(v));
  }
  return url.toString();
}

export async function readCapped(res: Response, max: number): Promise<{ text: string; truncated: boolean }> {
  if (!res.body) return { text: "", truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      truncated = true;
      chunks.push(value.subarray(0, value.byteLength - (size - max)));
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let off = 0;
  for (const c of chunks) {
    all.set(c, off);
    off += c.byteLength;
  }
  return { text: new TextDecoder().decode(all), truncated };
}

/** Calls the pinned API. Credentials come only from ctx.headers, never from model arguments. */
export async function executeOperation(
  op: Operation,
  args: Record<string, any>,
  ctx: ExecContext,
  signal?: AbortSignal,
): Promise<ExecResult> {
  const url = assertAllowedUrl(buildUrl(op, args, ctx.baseUrl), {
    baseUrl: ctx.baseUrl,
    allowPrivateNetworks: ctx.allowPrivateNetworks,
  });
  const headers: Record<string, string> = { accept: "application/json", ...ctx.headers };
  let body: string | undefined;
  if (op.hasBody && args.body !== undefined) {
    body = JSON.stringify(args.body);
    headers["content-type"] = "application/json";
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error("tool call timed out")), ctx.callTimeoutMs);
  signal?.addEventListener("abort", () => ctrl.abort(signal.reason), { once: true });
  try {
    const res = await (ctx.fetch ?? fetch)(url, {
      method: op.method.toUpperCase(),
      headers,
      body,
      redirect: "manual",
      signal: ctrl.signal,
    });
    if (res.status >= 300 && res.status < 400) {
      return { status: res.status, body: { error: "redirect not followed" }, truncated: false };
    }
    const { text, truncated } = await readCapped(res, ctx.maxResultBytes);
    let parsed: unknown = text;
    if (!truncated) {
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        /* keep text */
      }
    }
    if (op.ext.responseFields && typeof parsed === "object") {
      parsed = pickFields(parsed, new Set(op.ext.responseFields));
    }
    return { status: res.status, body: parsed, truncated };
  } finally {
    clearTimeout(timer);
  }
}
