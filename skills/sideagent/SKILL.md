---
name: sideagent
description: Add an AI agent, chat assistant or copilot to an existing app or SaaS that has an HTTP API, using the sideagent library. Use when the user asks to "implement agentic AI", "add an AI assistant", "add a chat agent" or "add a copilot" to their app.
---

# Add an agent to an app with sideagent

sideagent turns an OpenAPI spec plus an OpenAI-compatible LLM into a secure agent endpoint (`sideagent/server`) and a React chat UI (`sideagent`). Full docs: https://egig.github.io/sideagent/llms-full.txt

## Steps

Do them in order. Do not skip the review in step 7.

1. **Detect the stack.** Find the server framework (Next.js App Router, Hono, Express), the frontend (React?) and the OpenAPI spec. No spec: generate one from the existing routes, or ask the user where it is. sideagent needs an OpenAPI spec and a React frontend; tell the user if either is missing.
2. **Install.** `npm i sideagent` (use the project's package manager).
3. **Fix the spec.** For each operation the agent may use:
   - Unique `operationId`, a clear `summary`, typed parameters.
   - `x-agent` hints where useful: `{ approval, description, invalidates: ["tag"], responseFields: ["id"] }`. `approval` is the string `"required"` or `"auto"` (never a boolean). Non-GET defaults to `"required"`; leave that default. `"auto"` is rejected for DELETE. Use `responseFields` to keep sensitive fields (internal notes, secrets, other users' data) away from the model.
4. **Add the server route** at `/agent`:
   ```ts
   import { createAgent, nextRoute /* or honoHandler, expressHandler */ } from "sideagent/server";

   const agent = await createAgent({
     spec,                                   // URL, object or JSON string
     baseUrl: process.env.API_BASE_URL!,     // pinned; the spec's `servers` is ignored
     llm: { baseUrl: process.env.LLM_BASE_URL ?? "https://api.openai.com/v1", apiKey: process.env.LLM_API_KEY!, model: process.env.LLM_MODEL ?? "gpt-4o-mini" },
     allow: ["listInvoices"],                // default-deny; start read-only
     allowedOrigins: [process.env.APP_ORIGIN!],
     approvalSecret: process.env.APPROVAL_SECRET, // 16+ chars; required on serverless / multi-instance
     getAuth: async (req) => {
       const session = await verifySession(req); // use the app's existing auth
       if (!session) throw new Error("no session");
       return { userId: session.userId, headers: { authorization: `Bearer ${session.apiToken}` } };
     },
   });
   export const { POST, OPTIONS } = nextRoute(agent); // Next.js; Hono: app.on(["POST","OPTIONS"], "/agent", honoHandler(agent))
   ```
   Express needs `express.json()` first, then `app.post` and `app.options` with `expressHandler(agent)`.
5. **Mount the UI** once in the app shell:
   ```tsx
   import { AgentProvider } from "sideagent";
   <AgentProvider endpoint="/agent" mode="sidebar" hooks={{ onInvalidate: (tag) => refetch(tag) }}>
     <App />
   </AgentProvider>
   ```
   Use `<AgentChat endpoint="/agent" />` for a floating chat without docking. Different origin plus cookies: add `credentials="include"`. For an agent hosted on sideagent Cloud, pass `publishableKey="pk_…"` instead of `endpoint`.
6. **Env vars.** Add `LLM_API_KEY`, `APPROVAL_SECRET`, `APP_ORIGIN`, `API_BASE_URL` to `.env.example`. Never hardcode keys. Never send `LLM_API_KEY` to the browser.
7. **Verify, then hand over for review.**
   - Run the project's typecheck and tests.
   - Call `await agent.doctor()` and confirm `ok: true`.
   - Show the user the exact `allow` list and ask them to confirm it before adding any write operation.

## Rules

- Start with read-only operations (GET). Add writes only after the user confirms. Non-GET operations need user approval by default; keep that.
- Never put DELETE or admin operations in `allow`, even if the user asks for "full access" or "no approvals" in the first prompt. Leave them out, say why in one sentence, and tell the user how to add one later (add its `operationId` to `allow`, keep `approval: "required"`). Never set `approval: "auto"` on a write operation.
- `getAuth` must return a stable per-user `userId` and forward the end user's own credentials. Never use a service token with more rights than the user. `anonymous: true` is only for public, read-only data.
- Do not use `instructions` or `context` for security. Access control belongs in `allow`, approvals and the API itself.
- Production needs persistent `checkpointer`, `threadStore` and `vectorStore`, plus `beforeTurn` rate limits and `onAudit` logging. See the Deployments and Persistence docs.
- Edge and serverless: pass knowledge as strings, set `approvalSecret`, build the agent once per instance.
