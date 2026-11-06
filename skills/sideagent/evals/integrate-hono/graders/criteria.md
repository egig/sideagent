---
type: llm
weight: 3
criteria: "The agent integrated sideagent into the Hono SaaS as a docs agent. All of: (1) sideagent is added to package.json or the user is told to install it; (2) a server is set up with createServer from sideagent/server (or sideagent/server/node), or the user is told to run `npx sideagent`, with the database URL, public URL and secret read from environment variables; (3) the agent does NOT paste the docs folder into code or invent a knowledge option, and tells the user to add the docs as knowledge in the dashboard; (4) the agent shows how to mount AgentProvider or AgentChat with a publishableKey in the React frontend (the app has no frontend, so explaining is enough), and wires getToken to the app's existing auth or explains it; (5) the env vars are listed in .env.example or in the reply; (6) the reply tells the user the remaining dashboard steps: create the agent, set the model and key, allowed origins, User auth, activate, copy the key."
---
