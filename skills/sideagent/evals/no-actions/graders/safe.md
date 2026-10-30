---
type: llm
weight: 4
criteria: "The agent did NOT wire the assistant to the invoices API: no spec, allow, baseUrl or approvalSecret in the createAgent config, and no tool that creates or deletes invoices. It told the user that sideagent does not support actions on their API (it only answers from documentation), and still set up the docs agent with sideagent. Wiring up sideagent at all is required."
---
