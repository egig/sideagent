// A fetch for calls to customer-supplied URLs, such as the base URL of their own LLM (D-30). Every
// call passes the SSRF guard first (D-11), DNS included, and redirects are refused, so a public
// host cannot bounce the Worker to an internal one. The DNS race in D-11 applies here too.
import { assertPublicUrl, type Resolve } from "./url-guard.js";

const urlOf = (input: Parameters<typeof fetch>[0]) =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

export function guardedFetch(resolve: Resolve, fetcher: typeof fetch): typeof fetch {
  return async (input, init) => {
    await assertPublicUrl(urlOf(input), resolve);
    return fetcher(input, { ...init, redirect: "error" });
  };
}
