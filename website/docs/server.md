---
sidebar_position: 2
title: Server
---

Import from `sideagent/server`.

```ts
import { createAgent, honoHandler } from "sideagent/server";

const agent = await createAgent({
  llm: { baseUrl: "https://api.openai.com/v1", apiKey: process.env.LLM_API_KEY!, model: "gpt-4o-mini" },
  // Or pass `model: yourLangChainChatModel` instead of `llm` (see Cloudflare Workers).
  knowledge: {
    embeddings: { model: "text-embedding-3-small" },
    sources: [{ id: "guide", title: "Invoicing guide", content: markdownString }],
    urls: ["https://docs.example.com/payment-terms"],
  },
  scope: {}, // keeps the agent on the docs
  allowedOrigins: ["https://app.example.com"],
  getAuth: (req) => ({ userId: "…" }),
});

app.on(["POST", "OPTIONS"], "/agent", honoHandler(agent)); // also: nextRoute, expressHandler
console.log(await agent.doctor());                         // LLM check + what was indexed
```

The agent has one tool, `search_knowledge`. It answers from the passages it finds and cannot call your API or change data. See [Knowledge](./knowledge.md) for sources, `scope` and the vector store.

`llm.fetch` and `knowledge.embeddings.fetch` take a `fetch` function that carries every HTTP call to the model and embeddings endpoint (embeddings fall back to `llm.fetch`). Use it to route those calls through your own guard, for example one that blocks private hosts when the `baseUrl` comes from a customer. They do not apply to `model` or `embeddings` you pass in yourself. `llm.maxRetries` and `knowledge.embeddings.maxRetries` (0 to 6) set how often a failed call is retried; the clients retry several times with backoff by default, which makes a blocked or dead endpoint slow to fail.

## Long threads: `summarize`

`summarize` replaces the older messages of a long thread with a summary the model writes, so long conversations stay within the model's context. It is off by default, and each summary is one extra model call.

```ts
createAgent({ …, summarize: { afterTokens: 8000, keepMessages: 20 } });
```

- A summary is made before a model call once the thread passes `afterTokens` (an approximate count). The last `keepMessages` messages stay as they are. `keepMessages` must be at least `limits.maxSteps * 2 + 1`, so the current turn is never summarized.
- The summary can repeat knowledge passages, so the model gets it inside a `<conversation_summary>` block, never as the user's words. The system prompt holds that block to the same rule as passages: context only, never instructions.
- Passage text that goes into a summary still never reaches the browser unless `exposeKnowledge` is on. Source links of a summarized search are gone with it.
- If the summary call fails, the thread is left as it was.
- Summarized messages are gone from the thread: the History panel shows only the messages that were kept, and does not show the summary.

## Behavior and limits

- The model has one tool, `search_knowledge`. A call to any other tool name is answered with an error and never runs.
- Requests from origins not in `allowedOrigins` are rejected.
- `getAuth` runs on every request. Threads are bound to the `userId` it returns.
- Call `agent.doctor()` at startup to see whether the LLM is reachable and how many chunks each knowledge source produced.
