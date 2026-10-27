---
type: llm
weight: 3
criteria: "The agent integrated sideagent into the Hono app. All of: (1) sideagent is added to package.json or the user is told to install it; (2) an agent route uses createAgent from sideagent/server with honoHandler on POST and OPTIONS at /agent; (3) getAuth uses the existing verifySession and forwards the user's own credentials, not a service token; (4) allowedOrigins is set; (5) the LLM key is read from an environment variable; (6) the agent tells the user how to mount AgentProvider or AgentChat in their React frontend (the app has no frontend, so explaining is enough)."
---
