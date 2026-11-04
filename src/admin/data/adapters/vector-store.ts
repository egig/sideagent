import { Document } from "@langchain/core/documents";
import { VectorStore } from "@langchain/core/vectorstores";
import type { Hit } from "../../store/types.js";

/** The agent's own store as a LangChain vector store the library can search. Writes are no-ops: the control plane indexes. */
export class StoreVectorStore extends VectorStore {
  constructor(private find: (vector: number[], k: number) => Promise<Hit[]>) {
    super({} as never, {});
  }
  _vectorstoreType() {
    return "sideagent-admin";
  }
  async addVectors() {}
  async addDocuments() {}
  async delete() {}
  async similaritySearchVectorWithScore(query: number[], k: number): Promise<[Document, number][]> {
    return (await this.find(query, k)).map((h) => [new Document({ pageContent: h.text, metadata: h.meta }), h.score]);
  }
}
