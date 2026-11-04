// Response helpers for /v1: uniform error bodies, CORS for allowed origins, SSE.
import type { Context } from "hono";

/** Every failure is `{ error }` with a fixed code; never a message, stack or upstream detail. */
export const uniform = (
  c: Context,
  status: 400 | 401 | 403 | 404 | 429 | 501 | 503,
  error: string,
  headers?: Record<string, string>,
) => c.json({ error }, status, headers);

/**
 * A library error response, as a uniform body. The library words its own errors ("thread not
 * found"); clients of the admin get fixed codes only.
 */
export function uniformFrom(c: Context, status: number, headers: Record<string, string>) {
  if (status === 400 || status === 413 || status === 415) return uniform(c, 400, "bad_request", headers);
  if (status === 401) return uniform(c, 401, "unauthorized", headers);
  if (status === 403) return uniform(c, 403, "forbidden", headers);
  if (status === 404) return uniform(c, 404, "not_found", headers);
  if (status === 429) return uniform(c, 429, "rate_limited", headers);
  return uniform(c, 503, "unavailable", headers);
}

// The library's preflight allows content-type and authorization only, so the end user's token travels
// in Authorization (D-29). x-sideagent-key carries the publishable key (D-27); the sideagent client
// sends it with publishableKey.
export function corsHeaders(origin: string | undefined, allowed: string[]): Record<string, string> {
  if (!origin || !allowed.includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization, x-sideagent-key",
    "access-control-max-age": "600",
    vary: "Origin",
  };
}

/** A complete turn as one SSE response (events of src/protocol.ts in the library). */
export function sse(events: unknown[], headers: Record<string, string>): Response {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(ctrl) {
        for (const e of events) ctrl.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
        ctrl.close();
      },
    }),
    { headers: { "content-type": "text/event-stream", "cache-control": "no-store", ...headers } },
  );
}
