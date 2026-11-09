// The demo, as one recorded run: set up an agent in the dashboard, then use it inside the Ledgerly app.
import { expect, test, type Page } from "@playwright/test";
import { SetupPage } from "../../../e2e/pages/setup-page";
import { createAgent } from "../../../e2e/support/fixtures";
import { APP, SERVER } from "./playwright.config";

const EMAIL = "dana@northwind.example";
const DOCS = [
  "getting-started",
  "creating-invoices",
  "taxes",
  "payment-methods",
  "plans-and-billing",
  "teammates-and-roles",
];

/** Types like a person, so the recording shows the question being asked. */
async function ask(page: Page, question: string) {
  const composer = page.getByPlaceholder(/Message|Ask your agent anything/);
  await composer.click();
  await composer.pressSequentially(question, { delay: 40 });
  await page.waitForTimeout(400);
  await composer.press("Enter");
}

test("Ledgerly demo", async ({ page }) => {
  // 1. Sign in to the dashboard through the emailed link.
  await page.goto("/sign-in");
  await page.getByLabel("Work email").fill(EMAIL);
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(page).toHaveURL(/\/check-email$/);
  const { link } = (await (await page.request.get(`/__demo/magic-link?email=${EMAIL}`)).json()) as { link: string };
  await page.goto(link);
  await page.getByRole("link", { name: "Continue" }).click();
  await expect(page).not.toHaveURL(/\/(sign-in|verify)/);

  // 2. A new agent starts on the host's model, so setup begins at knowledge.
  const agentId = await createAgent(page, "Ledgerly assistant");
  const setup = new SetupPage(page);
  await setup.knowledge.expectState("open");

  // 3. Knowledge: the docs pages, indexed in the background.
  for (const slug of DOCS) await setup.knowledge.addPage(`https://docs.ledgerly.test/${slug}`);
  await expect(setup.knowledge.card.getByText("Indexed", { exact: true })).toHaveCount(DOCS.length);
  await setup.knowledge.continueButton.click();

  // 4. Try it in the preview.
  await setup.try.openPreview();
  await page
    .getByPlaceholder(/Ask your agent anything/)
    .pressSequentially("How do I add VAT to an invoice?", { delay: 40 });
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("region", { name: "Ledgerly assistant" }).locator("p", { hasText: "Settings → Taxes" }).first(),
  ).toBeVisible();
  await setup.try.expectAnswered();
  await page.waitForTimeout(1500);
  await setup.try.closePreview();
  await setup.try.continueButton.click();

  // 5. Deploy: which origin may embed the chat, and who the visitors are.
  await setup.deploy.saveOrigin(APP);
  await setup.deploy.chooseAnonymousAuth();
  await setup.deploy.expectEmbedCode();
  const embed =
    (await setup.deploy.card
      .getByText(/publishableKey="pk_/)
      .first()
      .textContent()) ?? "";
  const key = /pk_[^"\s]+/.exec(embed)?.[0];
  expect(key, "the embed code shows the publishable key").toBeTruthy();
  await page.waitForTimeout(1500);
  await setup.deploy.continueButton.click();
  await setup.live.activate();

  // 6. The Ledgerly app with the chat docked beside it. The chat knows the signed-in user's account.
  await page.goto(`${APP}/?key=${key}`);
  const chat = page.getByRole("region", { name: "Ledgerly assistant" });
  await expect(chat).toBeVisible();
  await page.getByRole("button", { name: "Billing", exact: true }).click();
  await ask(page, "Why did my last payment fail?");
  await expect(chat.locator("p", { hasText: "card_declined" }).first()).toBeVisible();
  await page.waitForTimeout(3000);

  await page.getByRole("button", { name: "Team", exact: true }).click();
  await ask(page, "Can I invite another teammate?");
  await expect(chat.locator("p", { hasText: "4 are in use" }).first()).toBeVisible();
  await page.waitForTimeout(3000);

  // A question outside the product is declined, not answered. A fresh chat, so the earlier questions add no context.
  await page.getByRole("button", { name: "New chat" }).click();
  await ask(page, "Write me a poem about the sea");
  await expect(chat.getByText("I can only help with Ledgerly")).toBeVisible();
  await expect(chat.getByText("Sources")).toHaveCount(0);
  await page.waitForTimeout(3000);
  await page.waitForTimeout(3000);

  // 7. Back in the dashboard, the first request made the agent live.
  await page.goto(`${SERVER}/agents/${agentId}/setup`);
  // The turn is logged when its stream ends, which can land just after the page loads: reload until it shows.
  await expect(async () => {
    await expect(setup.live.card.getByText("Your agent is live.")).toBeVisible({ timeout: 3000 });
  })
    .toPass({
      intervals: [500],
      timeout: 30_000,
    })
    .catch(async () => {
      await page.reload();
      await setup.live.expectLive();
    });
  await page.waitForTimeout(2000);
});
