---
name: sideagent
description: Add an AI docs assistant, chat agent or help bot to an existing app or SaaS that answers questions from its documentation, using the sideagent library. Use when the user asks to "implement agentic AI", "add an AI assistant", "add a chat agent" or "add a help bot" to their app.
---

# Add a docs agent to an app with sideagent

sideagent turns your documentation (markdown and URLs) plus an OpenAI-compatible LLM into a secure agent endpoint (`sideagent/server`) and a React chat UI (`sideagent`). The agent answers from the docs and shows its sources. It cannot call the app's API or change data: there is no tool calling beyond knowledge search. Full docs: https://egig.github.io/sideagent/llms-full.txt

## Steps

Do them in order. Do not skip the review in step 7.

1. **Detect the stack.** Find the server framework (Next.js App Router, Hono, Express), the frontend (React?) and the documentation: a docs folder, markdown files, or public docs URLs. No docs: ask the user what the agent should answer from. sideagent needs documentation and a React frontend; tell the user if either is missing.
2. **Install.** `npm i sideagent` (use the project's package manager).
3. **Choose the knowledge.** Pass markdown as strings (`knowledge.sources`: `{ id, title, content }`; read files at startup, because the edge has no filesystem) and public pages as `knowledge.urls`. Start with a few good pages. Leave out anything private: the agent may quote any passage it can search.
4. **Add the server route** at `/agent`:
   ```ts
   import { createAgent, nextRoute /* or honoHandler, expressHandler */ } from "sideagent/server";

   const agent = await createAgent({
     llm: { baseUrl: process.env.LLM_BASE_URL ?? "https://api.openai.com/v1", apiKey: process.env.LLM_API_KEY!, model: process.env.LLM_MODEL ?? "gpt-4o-mini" },
     knowledge: {
       embeddings: { model: "text-embedding-3-small" }, // baseUrl and apiKey default to llm's
       sources,                                          // [{ id, title, content }]
       urls: ["https://docs.example.com/guide"],
     },
     scope: {},                                          // keeps the agent on the docs
     allowedOrigins: [process.env.APP_ORIGIN!],
     getAuth: async (req) => {
       const session = await verifySession(req); // use the app's existing auth
       if (!session) throw new Error("no session");
       return { userId: session.userId };
     },
   });
   export const { POST, OPTIONS } = nextRoute(agent); // Next.js; Hono: app.on(["POST","OPTIONS"], "/agent", honoHandler(agent))
   ```
   Express needs `express.json()` first, then `app.post` and `app.options` with `expressHandler(agent)`.
5. **Mount the UI** once in the app shell:
   ```tsx
   import { AgentProvider } from "sideagent";
   <AgentProvider endpoint="/agent" mode="sidebar">
     <App />
   </AgentProvider>
   ```
   Use `<AgentChat endpoint="/agent" />` for a floating chat without docking. Different origin plus cookies: add `credentials="include"`. For an agent hosted on sideagent Cloud, pass `publishableKey="pk_…"` instead of `endpoint`.
6. **Env vars.** Add `LLM_API_KEY` and `APP_ORIGIN` to `.env.example`. Never hardcode keys. Never send `LLM_API_KEY` to the browser.
7. **Verify, then hand over for review.**
   - Run the project's typecheck and tests.
   - Call `await agent.doctor()` and confirm `ok: true` and that every source has chunks.
   - Show the user the list of sources and ask them to confirm none is private.

## Rules

- The agent only answers from knowledge. If the user asks for an agent that creates, edits or deletes data, or calls the app's API, say in one sentence that sideagent does not support that, and build the docs agent. Never invent `spec`, `allow`, `baseUrl` or `approvalSecret`: they do not exist.
- `getAuth` must return a stable per-user `userId`. `anonymous: true` is only for public docs.
- Do not use `instructions` or `context` for security. Keep private material out of `knowledge`.
- Production needs persistent `checkpointer`, `threadStore` and `vectorStore`, plus `beforeTurn` rate limits. See the Deployments and Persistence docs.
- Edge and serverless: pass knowledge as strings and build the agent once per instance.
