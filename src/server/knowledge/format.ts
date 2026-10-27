import type { Hit } from "./vector-store.js";

/** Model-visible rendering: labelled, untrusted reference data with its closing tag neutralised. */
export function wrapKnowledge(hits: Hit[], maxBytes: number): string {
  if (!hits.length) return "<knowledge_results>No relevant knowledge found.</knowledge_results>";
  const esc = (t: string) => t.replace(/<\/?knowledge_(source|results)/gi, (m) => m.replace("<", "&lt;"));
  const attr = (t: string) => t.replace(/["<>&]/g, "");
  let out = "";
  for (const h of hits) {
    const block = `<knowledge_source id="${attr(h.meta.sourceId)}" title="${attr(h.meta.title)}">\n${esc(h.text)}\n</knowledge_source>\n`;
    if (out.length + block.length > maxBytes) break;
    out += block;
  }
  return out || "<knowledge_results>Result too large.</knowledge_results>";
}

export function uniqueSources(hits: Hit[]): { id: string; title: string; url?: string }[] {
  const seen = new Map<string, { id: string; title: string; url?: string }>();
  for (const h of hits) {
    if (!seen.has(h.meta.sourceId)) {
      seen.set(h.meta.sourceId, {
        id: h.meta.sourceId,
        title: h.meta.title,
        ...(h.meta.url ? { url: h.meta.url } : {}),
      });
    }
  }
  return [...seen.values()];
}
