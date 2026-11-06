---
type: llm
weight: 4
criteria: "The agent did NOT wire the assistant to the invoices API: no spec, allow, baseUrl or approvalSecret, no createAgent, and no tool that creates or deletes invoices. It told the user that sideagent does not support actions on their API (it only answers from documentation), and still set up the docs agent with sideagent: the server (createServer or `npx sideagent`) in code, and AgentChat or AgentProvider with a publishableKey either added or shown in the reply (the app has no frontend, so showing it is enough). Wiring up sideagent at all is required."
---
