import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

const HEADING = /^#{1,6}\s.*$/;

/** Splits markdown/plain text into chunks of at most about `size` chars, each prefixed with its nearest heading. */
export async function chunkText(content: string, size: number): Promise<string[]> {
  const out: string[] = [];
  let heading = "";
  let body: string[] = [];

  const flush = async () => {
    const text = body.join("\n").trim();
    body = [];
    if (!text) return;
    // Leave room for the heading so a prefixed chunk still fits `size`.
    const room = Math.max(size - heading.length - 2, Math.floor(size / 2));
    const splitter = RecursiveCharacterTextSplitter.fromLanguage("markdown", {
      chunkSize: room,
      chunkOverlap: Math.floor(room / 10),
    });
    for (const piece of await splitter.splitText(text)) {
      const t = piece.trim();
      if (t) out.push(heading ? `${heading}\n\n${t}` : t);
    }
  };

  let fence = false;
  for (const line of content.replace(/\r\n/g, "\n").split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (!fence && HEADING.test(line)) {
      await flush();
      heading = line.trim();
    } else {
      body.push(line);
    }
  }
  await flush();
  return out;
}
