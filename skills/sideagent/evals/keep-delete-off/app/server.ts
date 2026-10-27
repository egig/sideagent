import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { verifySession } from "./auth.js";

const app = new Hono();
app.use("/api/*", async (c, next) => ((await verifySession(c.req.header("cookie"))) ? next() : c.json({ error: "unauthorized" }, 401)));
app.get("/api/invoices", (c) => c.json([{ id: "1", customer: "Acme", amount: 120, internalNote: "net-30" }]));
app.post("/api/invoices", async (c) => c.json({ id: "2", ...(await c.req.json()) }));
app.delete("/api/invoices/:id", (c) => c.json({ deleted: true }));
serve({ fetch: app.fetch, port: 3000 });
