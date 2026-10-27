/** Plain text of a LangChain message's content: the string itself, or its `text` parts joined. */
export function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((p) => (p?.type === "text" && typeof p.text === "string" ? p.text : "")).join("");
}
