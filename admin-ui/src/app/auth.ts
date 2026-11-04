import { queryOptions } from "@tanstack/react-query";
import { config } from "~/config";
import { createAuthClient } from "better-auth/react";
import { magicLinkClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: typeof window === "undefined" ? undefined : window.location.origin,
  basePath: `${config.apiBase}/auth`,
  plugins: [magicLinkClient()],
});

export type Provider = "github" | "google";

export const sessionQuery = queryOptions({
  queryKey: ["session"],
  queryFn: async () => {
    const { data, error } = await authClient.getSession();
    if (error) throw new Error(`session ${error.status}`);
    return data;
  },
  staleTime: 60_000,
});

export const providersQuery = queryOptions({
  queryKey: ["auth-providers"],
  queryFn: async () => {
    const res = await fetch(`${config.apiBase}/auth-providers`);
    if (!res.ok) throw new Error(`providers ${res.status}`);
    return (await res.json()) as Record<Provider, boolean> & { signup: boolean };
  },
  staleTime: Infinity,
});

// Where the magic link lands. Failed verification comes back with ?error=.
export const SIGN_IN_REDIRECTS = {
  callbackURL: `${config.basePath}/`,
  newUserCallbackURL: `${config.basePath}/`,
  errorCallbackURL: `${config.basePath}/sign-in`,
};

const PENDING_EMAIL_KEY = "sideagent:pending-email";

export function savePendingEmail(email: string) {
  try {
    sessionStorage.setItem(PENDING_EMAIL_KEY, email);
  } catch {
    // Storage blocked: the check-email page falls back to generic copy.
  }
}

export function readPendingEmail(): string | null {
  try {
    return sessionStorage.getItem(PENDING_EMAIL_KEY);
  } catch {
    return null;
  }
}

/** null when sent; else which message to show (`t.auth[...]`). */
export type MagicLinkError = "tooMany" | "invalidEmail" | "sendFailed";

export async function requestMagicLink(email: string): Promise<MagicLinkError | null> {
  const { error } = await authClient.signIn.magicLink({ email, ...SIGN_IN_REDIRECTS });
  if (!error) return null;
  if (error.status === 429) return "tooMany";
  if (error.status === 400) return "invalidEmail";
  return "sendFailed";
}
