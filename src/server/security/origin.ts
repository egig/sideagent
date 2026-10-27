/** CORS headers are only ever sent to origins on the allowlist. */
export function checkOrigin(request: Request, allowedOrigins: string[]): { ok: boolean; cors: Record<string, string> } {
  const origin = request.headers.get("origin");
  const ok = !!origin && allowedOrigins.some((o) => new URL(o).origin === origin);
  return {
    ok,
    cors: ok
      ? { "access-control-allow-origin": origin!, "access-control-allow-credentials": "true", vary: "origin" }
      : {},
  };
}

export function preflight(cors: Record<string, string>): Response {
  return new Response(null, {
    status: 204,
    headers: {
      ...cors,
      "access-control-allow-methods": "POST",
      "access-control-allow-headers": "content-type, authorization",
      "access-control-max-age": "600",
    },
  });
}
