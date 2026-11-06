// Steps the e2e tests share: signing in through the emailed link, which the e2e server keeps in memory.
import { expect, type Page } from "@playwright/test";

/** Signs in a new account through the real sign-in page and the emailed link's confirmation page. */
export async function signIn(page: Page, email = `owner-${crypto.randomUUID().slice(0, 8)}@example.com`) {
  await page.goto("/sign-in");
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(page).toHaveURL(/\/check-email$/);
  const res = await page.request.get(`/__e2e/magic-link?email=${encodeURIComponent(email)}`);
  const { link } = (await res.json()) as { link: string };
  await page.goto(link);
  await page.getByRole("link", { name: "Continue" }).click();
  await expect(page).not.toHaveURL(/\/(sign-in|verify)/);
  return email;
}

/** Creates an agent from the "New agent" page and returns its id; the dashboard opens its setup. */
export async function createAgent(page: Page, name = "Docs helper") {
  await page.goto("/new");
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Create agent" }).click();
  await expect(page).toHaveURL(/\/agents\/agt_[a-z0-9]+\/setup$/);
  return /\/agents\/(agt_[a-z0-9]+)\//.exec(page.url())![1]!;
}

/** The card of one setup step. */
export const step = (page: Page, id: "llm" | "knowledge" | "try" | "deploy" | "live") =>
  page.locator(`li[data-step="${id}"]`);
