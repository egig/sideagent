import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import type { AgentConfig } from "./config.js";

/** Same shape as LangChain's Embeddings, minimal so any adapter fits. */
export interface EmbeddingsLike {
  embedDocuments(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
}

type LlmConfig = NonNullable<AgentConfig["llm"]>;
type EmbeddingsConfig = NonNullable<NonNullable<AgentConfig["knowledge"]>["embeddings"]>;

export function createChatModel(llm: LlmConfig): BaseChatModel {
  return new ChatOpenAI({ model: llm.model, apiKey: llm.apiKey, temperature: llm.temperature, streaming: true, configuration: { baseURL: llm.baseUrl } });
}

/** baseUrl and apiKey fall back to the llm ones (parseConfig guarantees one of the two is set). */
export function createEmbeddings(cfg: EmbeddingsConfig, llm: LlmConfig | undefined): EmbeddingsLike {
  return new OpenAIEmbeddings({
    model: cfg.model,
    apiKey: cfg.apiKey ?? llm!.apiKey,
    configuration: { baseURL: cfg.baseUrl ?? llm!.baseUrl },
  });
}
