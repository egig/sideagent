import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createAgent } from "../src/server/index.js";
import { mockEmbeddingsHandler, mockLlmHandler } from "../src/testing/mock-llm.js";
import { spec } from "./spec.js";

const PORT = 8787;
const TOKEN = "demo-token";
const invoices = [
  { id: "1", customer: "Acme", amount: 120, internalNote: "never show the model this" },
  { id: "2", customer: "Globex", amount: 480, internalNote: "net-30" },
];

const app = new Hono();

// The app's own API. It enforces auth itself; the agent only gets what the user's token allows.
app.use("/api/*", async (c, next) =>
  c.req.header("authorization") === `Bearer ${TOKEN}` ? next() : c.json({ error: "unauthorized" }, 401),
);
app.get("/api/invoices", (c) => c.json(invoices));
app.post("/api/invoices", async (c) => {
  const inv = { id: String(invoices.length + 1), internalNote: "", ...(await c.req.json()) };
  invoices.push(inv);
  return c.json(inv);
});
app.delete("/api/invoices/:id", (c) => {
  const i = invoices.findIndex((x) => x.id === c.req.param("id"));
  if (i >= 0) invoices.splice(i, 1);
  return c.json({ deleted: i >= 0 });
});

// Scripted fake LLM so the demo works without a key. Set LLM_API_KEY to use a real one.
app.post("/mock/v1/chat/completions", (c) => mockLlmHandler(c.req.raw));
app.post("/mock/v1/embeddings", (c) => mockEmbeddingsHandler(c.req.raw));

// A docs page the agent loads as a URL knowledge source (served here so the demo is self-contained).
app.get("/docs/payment-terms", (c) =>
  c.html(
    "<html><head><title>Payment terms</title></head><body><h1>Payment terms</h1><p>Invoices are due net-30. Late payments accrue 1.5% interest per month.</p><h2>Refunds</h2><p>Refunds are issued to the original payment method within 5 business days.</p></body></html>",
  ),
);

// Listen first: the mock LLM, mock embeddings and docs page below are served by this same process,
// and the agent calls them while it starts up.
let agentHandler: ((req: Request) => Promise<Response>) | undefined;
app.on(["POST", "OPTIONS"], "/agent", (c) =>
  agentHandler ? agentHandler(c.req.raw) : c.json({ error: "starting up" }, 503),
);
await new Promise<void>((resolve) => serve({ fetch: app.fetch, port: PORT }, () => resolve()));

const real = !!process.env.LLM_API_KEY;
const agent = await createAgent({
  spec: spec as unknown as Record<string, unknown>,
  baseUrl: `http://localhost:${PORT}/api`,
  allowPrivateNetworks: true, // demo API is on localhost
  llm: {
    baseUrl: process.env.LLM_BASE_URL ?? (real ? "https://api.openai.com/v1" : `http://localhost:${PORT}/mock/v1`),
    apiKey: process.env.LLM_API_KEY ?? "mock",
    model: process.env.LLM_MODEL ?? "gpt-4o-mini",
  },
  allow: ["listInvoices", "createInvoice"], // deleteInvoice stays unreachable
  allowedOrigins: ["http://localhost:5173", `http://localhost:${PORT}`],
  instructions: "You help the user manage their invoices.",
  knowledge: {
    embeddings: { model: process.env.EMBEDDING_MODEL ?? (real ? "text-embedding-3-small" : "mock-embedding") },
    sources: [
      {
        id: "invoicing-guide",
        title: "Invoicing guide",
        content:
          "# Invoicing guide\n\nCreate an invoice with a customer name and an amount. Amounts are in US dollars.\n\n## Disputes\n\nA customer can dispute an invoice within 14 days by contacting support.",
      },
    ],
    urls: [{ url: `http://localhost:${PORT}/docs/payment-terms`, title: "Payment terms" }],
  },
  approvalSecret: process.env.APPROVAL_SECRET ?? "demo-only-secret-change-me",
  getAuth: (req) => {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${TOKEN}`) throw new Error("unauthenticated");
    return { userId: "demo-user", headers: { authorization: auth } };
  },
  onAudit: (e) => console.log("[audit]", JSON.stringify(e)),
});

agentHandler = agent.handler; // routes POST/OPTIONS /agent (OPTIONS = CORS preflight); honoHandler(agent) does the same in a plain Hono app

console.log(`demo api + agent on http://localhost:${PORT} (${real ? "real LLM" : "mock LLM"})`);
console.log(JSON.stringify(await agent.doctor(), null, 2));
