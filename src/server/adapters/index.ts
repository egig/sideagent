import type { Agent } from "../create-agent.js";

/** Next.js App Router: `export const { POST } = nextRoute(agent)` */
export function nextRoute(agent: Agent) {
  const h = (req: Request) => agent.handler(req);
  return { POST: h, OPTIONS: h };
}

/** Hono: `app.on(["POST", "OPTIONS"], "/agent", honoHandler(agent))` */
export function honoHandler(agent: Agent) {
  return (c: { req: { raw: Request } }) => agent.handler(c.req.raw);
}

/** Express (use express.json() before it): `app.post("/agent", expressHandler(agent))` and `app.options("/agent", expressHandler(agent))` */
export function expressHandler(agent: Agent) {
  return async (req: any, res: any) => {
    const host = req.get("host");
    const headers = new Headers();
    for (const [k, v] of Object.entries<any>(req.headers)) if (typeof v === "string") headers.set(k, v);
    const r = await agent.handler(
      new Request(`${req.protocol}://${host}${req.originalUrl}`, {
        method: req.method,
        headers,
        body: req.method === "GET" ? undefined : JSON.stringify(req.body ?? {}),
      }),
    );
    res.status(r.status);
    r.headers.forEach((v, k) => res.setHeader(k, v));
    if (!r.body) return res.end();
    const reader = r.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  };
}
