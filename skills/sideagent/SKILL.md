---
name: sideagent
description: Add an AI docs assistant, chat agent or help bot to an existing app or SaaS that answers questions from its documentation, using the sideagent library. Use when the user asks to "implement agentic AI", "add an AI assistant", "add a chat agent" or "add a help bot" to their app.
---

# Add a docs agent to an app with sideagent

sideagent has two pieces. A **server** you run (`createServer` from `sideagent/server`, or `npx sideagent`) holds the dashboard where agents, knowledge and the model are set up, and serves each agent's endpoint. A React component, `<AgentChat publishableKey="pk_…" />`, is the chat. The agent answers from the documentation and shows its sources. It cannot call the app's API or change data: there is no tool calling beyond knowledge search. Full docs: https://egig.github.io/sideagent/llms-full.txt

## Steps

Do them in order. Do not skip the review in step 6.

1. **Detect the stack.** Find the frontend (React?), the auth the app already has (where a logged-in user's token or session comes from) and the documentation: a docs folder, markdown files, or public docs URLs. sideagent needs documentation and a React frontend; tell the user if either is missing.
2. **Install.** `npm i sideagent` (use the project's package manager).
3. **Server.** The simplest is `npx sideagent` as its own process. To run it inside the app's Node process instead:
   ```ts
   import { createServer } from "sideagent/server/node";

   const server = createServer({
     database: process.env.DATABASE_URL!,        // Postgres with pgvector
     publicUrl: process.env.SIDEAGENT_URL!,      // where the browser reaches it, e.g. https://agent.example.com
     secret: process.env.SIDEAGENT_SECRET!,      // openssl rand -base64 32
   });
   await server.listen(8788);
   ```
   Other runtimes (Workers, Next, Hono) mount `createServer(...).fetch` from `sideagent/server`. The server must be reachable at `publicUrl` on its own origin (keys name its host).
4. **Mount the chat** once in the app shell, with the key from the dashboard:
   ```tsx
   import { AgentProvider } from "sideagent";
   <AgentProvider publishableKey={import.meta.env.VITE_SIDEAGENT_KEY} getToken={() => auth.getAccessToken()} storageKey={user.id} mode="sidebar">
     <App />
   </AgentProvider>
   ```
   Use `<AgentChat publishableKey=… />` for a floating chat without docking. Omit `getToken` for public docs. The publishable key is public; it can live in client env. If the repo has no React frontend, still show this snippet in your reply and say where it goes once there is one.
5. **Env vars.** Add `DATABASE_URL`, `SIDEAGENT_URL`, `SIDEAGENT_SECRET` and the public key variable to `.env.example`. Never hardcode secrets.
6. **Hand over for review.** The knowledge is added in the dashboard, not in code. Tell the user to: open the dashboard, create an agent, set the model and key, add the docs (pages or markdown), list the app's origin under allowed origins, pick User auth to match the app (a JWT or userinfo mode if the chat sends `getToken`), switch the agent to Active and copy its key. Ask them to confirm no knowledge source is private. Run the project's typecheck and tests.

## Rules

- The agent only answers from knowledge. If the user asks for an agent that creates, edits or deletes data, or calls the app's API, say in one sentence that sideagent does not support that, and build the docs agent.
- There is no `createAgent`, `endpoint` prop, `honoHandler`, `nextRoute`, `expressHandler`, `getAuth`, `getHeaders`, `spec`, `allow`, `baseUrl` or `approvalSecret`. Do not invent them.
- Never put the model's API key in code or in the browser: it is entered in the dashboard and stored encrypted.
- Keep private material out of knowledge: the agent may quote any passage it finds.
- Production needs `SIDEAGENT_SECRET`, a persistent `DATABASE_URL`, HTTPS, and sign-up closed once the team has accounts. See the Deployments docs.
