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

The model gets a `search_knowledge` tool. It is the agent's only tool. Answers show a "Sources" card, with links only for your configured URLs.

## Hybrid retrieval

Search fuses two rankings with reciprocal rank fusion: the vector search, and a BM25 keyword search over the same chunks. A passage that uses the user's exact words is found even when the embedding ranks it just outside the vector cut. Turn it off with `knowledge.hybrid: false`.

The in-memory store supports this out of the box. A custom `vectorStore` opts in by implementing `keywordSearch(query, k): Promise<[Document, number][]>` over the same ids `addVectors` uses; without it, search is vector-only. Keyword scores may use any scale. The `score` reported for a passage is the stronger of its cosine similarity and its keyword score, clamped to `[0, 1]`, which is what `scope.minScore` compares against.

## Reranking

For an optional second-stage ranker, pass `reranker: true` to use the built-in ranker, which asks the configured chat model to score the wider set of vector or hybrid candidates. This adds a model call and sends those candidate passages to the same model provider. Higher scores rank first; sideagent applies `topK` after reranking. If the call fails or returns invalid scores, the original retrieval order is used. The hit `score` stays the retrieval score, so reranker scores do not change the `scope.minScore` gate.

```ts
createAgent({ …, reranker: true });
```

On Cloudflare Workers, you can use the dedicated cross-encoder through the Workers AI binding:

```ts
import { workersAiReranker } from "sideagent/workers-ai";

createAgent({ …, reranker: workersAiReranker(env.AI) });
```

It defaults to `@cf/baai/bge-reranker-base` and returns relevance scores for the candidate passages.

To use another provider, pass a callback instead. It receives the query and candidates, and must return one finite score per candidate in candidate order:

```ts
createAgent({
  …,
  reranker: async (query, candidates) => myRerankEndpoint(query, candidates.map((candidate) => candidate.text)),
});
```

The candidate set can contain up to 50 passages, subject to how many retrieval returns, and is wider than `topK` when enough candidates exist. The built-in ranker adds latency and model usage to uncached searches; reranking is opt-in.

## Semantic cache

Repeated or slightly reworded questions reuse the previous result set instead of searching again. Query embeddings are compared per agent: at `minScore` cosine similarity (default 0.97), the cached hits are returned. Entries expire after `ttlMs` (default 5 minutes, bounded to `maxEntries`) and are cleared whenever a source is ingested or refreshed, so knowledge updates are visible at once.

```ts
knowledge: {
  cache: { enabled: true, minScore: 0.97, maxEntries: 100, ttlMs: 300_000 },
}
```

The cache is per `KnowledgeBase` instance and only stores hits, never model answers or anything specific to a user.

## Showing passages to the host's own user

By default the browser gets source titles only, never passage text. To let a trusted user (for example an owner previewing their agent) see what was retrieved, pass `exposeKnowledge`:

```ts
createAgent({
  …,
  exposeKnowledge: ({ request, userId }) => isOwner(userId), // decided on the server, per request
});
```

When it returns `true`, each knowledge search is followed by a `knowledge.hits` event with `{ callId, query, hits: [{ title, url?, score, text }] }`, and the Sources card gets a "Passages" section. Nothing in the request body can turn it on. A callback that throws or returns anything but `true` means no. The passages are not stored, so they do not appear when a thread is reloaded from history. Keep it off for end users: passage text can contain anything you put in your knowledge base.

## Keeping the agent on topic

Prompt rules alone do not stop a model from answering "what is 2+2". Set `scope` and the agent gets fixed scope rules in its system prompt, plus a relevance gate that runs in code:

```ts
createAgent({
  …,
  scope: { minScore: 0.45, offTopic: "I can only answer questions about the documentation." },
});
```

A turn is backed when a `search_knowledge` call in it found a passage scoring at least `minScore`, or the user's message itself matches such a passage. A turn that is not backed gets `offTopic` as its answer, and the model is not called. With `exposeKnowledge` on, the gate's search is sent like a model search: `tool.start`, `tool.complete` and `knowledge.hits`, all with `callId: "gate"`.

Set `naturalReply: true` to have the model write the off-topic answer, in the user's language, instead of sending `offTopic`. The model sees only the last user message, with no tools, passages or history, and is told not to answer it. This costs one model call per off-topic turn, and the model's text reaches the user. `offTopic` is the fallback when that call fails or returns nothing.

## Limits

- URLs come only from config, never from the user or the model.
- URLs must be public http(s). Private ranges are blocked unless `allowPrivateNetworks` is set. Metadata addresses are always blocked.
- Redirects are followed only within the same host.
- Responses larger than `maxSourceBytes` are rejected.
- URL sources refresh in the background after `ttlMs` (default 1h), or on `agent.knowledge.refresh()`.
- A source that fails to load is skipped with a warning, and shown in `doctor()`.
- The default in-memory store re-embeds every source on each start, which costs embedding calls. Use a persistent `vectorStore` for large knowledge.
- Pass markdown as strings. There is no filesystem access on edge runtimes.
