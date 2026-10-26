---
sidebar_position: 8
title: Knowledge
---

Give the agent markdown and URL sources to answer from.

```ts
createAgent({
  …,
  knowledge: {
    embeddings: { model: "text-embedding-3-small" }, // OpenAI-compatible /embeddings; baseUrl/apiKey default to llm's
    sources: [{ id: "guide", title: "Invoicing guide", content: markdownString }], // pass strings: no filesystem on the edge
    urls: ["https://docs.example.com/payment-terms", { url: "https://…", title: "Shipping" }], // fetched by the server only
  },
  vectorStore, // optional: your own VectorStore (pgvector, Vectorize…). Default is in-memory.
});
```

The agent gets a `search_knowledge` tool. Answers show a "Sources" card, with links only for your configured URLs.

## Limits

- URLs come only from config, never from the user or the model.
- URLs must be public http(s). Private ranges are blocked unless `allowPrivateNetworks` is set. Metadata addresses are always blocked.
- Redirects are followed only within the same host.
- Responses larger than `maxSourceBytes` are rejected.
- URL sources refresh in the background after `ttlMs` (default 1h), or on `agent.knowledge.refresh()`.
- A source that fails to load is skipped with a warning, and shown in `doctor()`.
- The default in-memory store re-embeds every source on each start, which costs embedding calls. Use a persistent `vectorStore` for large knowledge.
- Pass markdown as strings. There is no filesystem access on edge runtimes.
