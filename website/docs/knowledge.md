---
sidebar_position: 8
title: Knowledge
---

The agent answers from the knowledge you add to it in the dashboard (agent, **Knowledge** tab):

- **Web pages.** Public HTTPS URLs. The server fetches them, never the browser. Private and metadata addresses are refused on purpose, redirects are not followed, and the response size is capped.
- **Markdown.** Paste text.

Each source shows *Queued*, *Indexed* or *Failed*. A *Failed* source usually means the page is not public, or the embedding model or key is wrong. Change the embedding model and the knowledge is re-indexed.

The model gets one tool, `search_knowledge`. It is the agent's only tool: it cannot call your API or change data. Answers show a "Sources" card, with links only for web pages you added.

Keep private material out of knowledge: the agent may quote any passage it can find. Passages reach the model as labelled, untrusted data, and the text of a passage reaches the browser only in the owner's dashboard preview, never for end users.

## How search works

Search fuses the vector ranking with a BM25 keyword ranking, so a passage that uses the user's exact words is found even when the embedding ranks it just outside the cut. A passage scoring below the agent's relevance threshold is dropped, and when nothing is relevant the agent says it has no answer instead of guessing. Repeated or slightly reworded questions reuse the previous result set; it is cleared whenever a source is indexed.
