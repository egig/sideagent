// The dashboard's own chat (preview, assistant): it talks to its own origin, so it may set `endpoint`, `credentials`
// and `headers`, which the published `AgentChat` does not offer. Not exported from the package.
export { AgentChat } from "./AgentChat.js";
export { AgentProvider } from "./AgentProvider.js";
export { useAgent } from "./context.js";
