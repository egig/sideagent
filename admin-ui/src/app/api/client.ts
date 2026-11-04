import { config } from "~/config";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: { error?: string; message?: string; fields?: Record<string, string> } | null,
  ) {
    super(`api ${status}`);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${config.apiBase}${path}`, {
    ...init,
    headers: init.body ? { "content-type": "application/json", ...init.headers } : init.headers,
  });
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
  return (res.status === 204 ? null : await res.json()) as T;
}

/** Field messages from a 400, else null. */
export function fieldErrors(error: unknown): Record<string, string> | null {
  return error instanceof ApiError && error.status === 400 ? (error.body?.fields ?? {}) : null;
}

/** One line for an Alert: the first field message, the server's message, or the fallback. */
export function errorMessage(error: unknown, fallback: string): string {
  const fields = fieldErrors(error);
  if (fields) return Object.values(fields)[0] ?? fallback;
  if (error instanceof ApiError && error.body?.message) return error.body.message;
  return fallback;
}
