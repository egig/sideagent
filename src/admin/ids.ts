// 16 chars from a 32-letter alphabet: 80 bits. Not a secret (publishable keys
// carry it), only unguessable enough to avoid enumeration. No "|": user IDs are
// built as agentId|issuer|sub.
const ID_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
export function newAgentId(prefix = "agt"): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `${prefix}_${Array.from(bytes, (b) => ID_ALPHABET[b & 31]).join("")}`;
}
