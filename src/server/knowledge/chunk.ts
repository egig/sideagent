/** Splits markdown/plain text into chunks of roughly `size` chars, keeping the nearest heading as context. */
export function chunkText(content: string, size: number): string[] {
  const out: string[] = [];
  let heading = "";
  let cur = "";
  const flush = () => {
    if (cur.trim()) out.push(cur.trim());
    cur = "";
  };
  const withHeading = (t: string) => (heading && !t.startsWith("#") ? `${heading}\n\n${t}` : t);

  for (const raw of content.replace(/\r\n/g, "\n").split(/\n{2,}/)) {
    const block = raw.trim();
    if (!block) continue;
    if (/^#{1,6}\s/.test(block)) {
      flush();
      heading = block.split("\n")[0]!;
    }
    // hard-split blocks that are bigger than a chunk
    const pieces = block.length > size ? (block.match(new RegExp(`[\\s\\S]{1,${size}}(?:\\s|$)`, "g")) ?? [block]) : [block];
    for (const piece of pieces) {
      if (cur && cur.length + piece.length + 2 > size) flush();
      if (!cur) cur = withHeading(piece.trim());
      else cur += `\n\n${piece.trim()}`;
    }
  }
  flush();
  return out;
}
