/** Records what an object's async methods (promises or async generators) throw, then rethrows it. */
export function watch<T extends object>(target: T, methods: string[], onError: (e: unknown) => void): T {
  for (const name of methods) {
    const original = (target as Record<string, unknown>)[name];
    if (typeof original !== "function") continue;
    (target as Record<string, unknown>)[name] = function (this: unknown, ...args: unknown[]) {
      try {
        const out = original.apply(this, args);
        if (out && typeof (out as AsyncGenerator).next === "function" && Symbol.asyncIterator in (out as object)) {
          return (async function* () {
            try {
              yield* out as AsyncGenerator;
            } catch (e) {
              onError(e);
              throw e;
            }
          })();
        }
        return out instanceof Promise ? out.catch((e: unknown) => (onError(e), Promise.reject(e))) : out;
      } catch (e) {
        onError(e);
        throw e;
      }
    };
  }
  return target;
}
