---
type: llm
weight: 3
criteria: "The agent integrated sideagent into the Hono app as a docs agent. All of: (1) sideagent is added to package.json or the user is told to install it; (2) an agent route uses createAgent from sideagent/server with honoHandler on POST and OPTIONS at /agent; (3) the knowledge option is given the markdown in the docs folder (read as strings) or URLs, with an embeddings model; (4) getAuth uses the existing verifySession and returns a userId; (5) allowedOrigins is set; (6) the LLM key is read from an environment variable; (7) the agent tells the user how to mount AgentProvider or AgentChat in their React frontend (the app has no frontend, so explaining is enough)."
---
