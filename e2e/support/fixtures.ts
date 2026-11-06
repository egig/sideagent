// Steps the e2e tests share: signing in through the emailed link, which the e2e server keeps in memory.
import { expect, test, type Cookie, type Page } from "@playwright/test";

// The sign-in endpoint allows a few requests every ten seconds, so one account signs in through the page once per
// worker and later tests take over its session. Each test still creates its own agent.
// Kept per project: each project has its own server and database.
const shared = new Map<string, { email: string; cookies: Cookie[] }>();

/**
 * Signs in an account through the real sign-in page and the emailed link's confirmation page. Without an `email`,
 * the first call creates the account and later calls reuse its session.
 */
export async function signIn(page: Page, email?: string) {
  const project = test.info().project.name;
  const known = shared.get(project);
  if (!email && known) {
    await page.context().addCookies(known.cookies);
    return known.email;
  }
  const own = email ?? `owner-${crypto.randomUUID().slice(0, 8)}@example.com`;
  await signInThroughPage(page, own);
  if (!email) shared.set(project, { email: own, cookies: await page.context().cookies() });
  return own;
}

async function signInThroughPage(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(page).toHaveURL(/\/check-email$/);
  const res = await page.request.get(`/__e2e/magic-link?email=${encodeURIComponent(email)}`);
  const { link } = (await res.json()) as { link: string };
  await page.goto(link);
  await page.getByRole("link", { name: "Continue" }).click();
  await expect(page).not.toHaveURL(/\/(sign-in|verify)/);
}

/** Creates an agent from the "New agent" page and returns its id; the dashboard opens its setup. */
export async function createAgent(page: Page, name = "Docs helper") {
  await page.goto("/new");
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Create agent" }).click();
  await expect(page).toHaveURL(/\/agents\/agt_[a-z0-9]+\/setup$/);
  return /\/agents\/(agt_[a-z0-9]+)\//.exec(page.url())![1]!;
}
