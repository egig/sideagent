// Knowledge: chunking, HTML to text, vector stores and the `KnowledgeBase` that searches them.
export * from "./knowledge-base.js";
export { chunkText } from "./chunk.js";
export { htmlToText } from "./html.js";
export { uniqueSources, wrapKnowledge } from "./format.js";
export { MemoryVectorStore } from "./vector-store.js";
export type { ChunkMeta, Hit, VectorStore } from "./vector-store.js";
export type { SemanticCacheOptions } from "./cache.js";
