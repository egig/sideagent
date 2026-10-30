import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createAgent } from "../src/server/index.js";
import { mockEmbeddingsHandler, mockLlmHandler } from "../src/testing/mock-llm.js";

const PORT = 8787;

const app = new Hono();

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
  allowPrivateNetworks: true, // the docs page is on localhost
  llm: {
    baseUrl: process.env.LLM_BASE_URL ?? (real ? "https://api.openai.com/v1" : `http://localhost:${PORT}/mock/v1`),
    apiKey: process.env.LLM_API_KEY ?? "mock",
    model: process.env.LLM_MODEL ?? "gpt-4o-mini",
  },
  allowedOrigins: ["http://localhost:5173", `http://localhost:${PORT}`],
  instructions: "You answer questions about the invoicing product from its documentation.",
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
  anonymous: true, // the demo has no sign-in; use getAuth in a real app
});

agentHandler = agent.handler; // routes POST/OPTIONS /agent (OPTIONS = CORS preflight); honoHandler(agent) does the same in a plain Hono app

console.log(`demo api + agent on http://localhost:${PORT} (${real ? "real LLM" : "mock LLM"})`);
console.log(JSON.stringify(await agent.doctor(), null, 2));
