import { AsyncLocalStorageProviderSingleton } from "@langchain/core/singletons";

let done: Promise<void> | undefined;

/**
 * LangGraph's interrupt() (our approval pause) reads its run config from AsyncLocalStorage. The Node build of
 * LangGraph registers it; the `browser`/web build that Workers bundlers resolve does not. Register it here when
 * the runtime has one (Node, or Workers with `nodejs_compat` / `nodejs_als`).
 * The specifier is computed so bundlers don't try to resolve it when the flag is missing.
 */
export function ensureAsyncLocalStorage(): Promise<void> {
  done ??= (async () => {
    const spec = "node:async_hooks";
    let ALS: (new () => unknown) | undefined = (globalThis as { AsyncLocalStorage?: new () => unknown })
      .AsyncLocalStorage;
    if (!ALS) {
      try {
        ALS = ((await import(/* @vite-ignore */ spec)) as { AsyncLocalStorage: new () => unknown }).AsyncLocalStorage;
      } catch {
        console.warn(
          '[sideagent] AsyncLocalStorage is unavailable, so approval pauses will fail. On Cloudflare Workers add "nodejs_compat" (or "nodejs_als") to compatibility_flags.',
        );
        return;
      }
    }
    AsyncLocalStorageProviderSingleton.initializeGlobalInstance(new ALS() as never);
  })();
  return done;
}
