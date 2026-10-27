import { parsePublishableKey, publishableEndpoint, PUBLISHABLE_KEY_HEADER } from "../keys.js";

/** Where requests go and which headers they carry, from `endpoint` and/or `publishableKey`. */
export function resolveTarget(props: {
  endpoint?: string;
  publishableKey?: string;
  headers?: Record<string, string>;
}): { endpoint: string; headers?: Record<string, string> } {
  if (props.publishableKey === undefined) {
    if (!props.endpoint) throw new Error("sideagent: pass endpoint or publishableKey");
    return { endpoint: props.endpoint, headers: props.headers };
  }
  const parts = parsePublishableKey(props.publishableKey);
  if (!parts) throw new Error("sideagent: invalid publishableKey");
  return {
    // An explicit endpoint wins, e.g. a proxy in front of sideagent Cloud.
    endpoint: props.endpoint || publishableEndpoint(parts),
    headers: { ...props.headers, [PUBLISHABLE_KEY_HEADER]: props.publishableKey },
  };
}
