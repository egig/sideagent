export async function verifySession(cookie: string | undefined): Promise<{ userId: string; apiToken: string } | null> {
  return cookie?.includes("session=") ? { userId: "u1", apiToken: "tok" } : null;
}
