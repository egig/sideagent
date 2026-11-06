// Setup step 3, try it: skipping the preview.
import { expect, test } from "@playwright/test";
import { APP_ORIGIN, GOOD_KEY, LLM_BASE_URL, WRONG_KEY } from "../../support/constants";
import { createAgent, signIn } from "../../support/fixtures";
import { SetupPage } from "../../pages/setup-page";

test("Skip for now opens the next step and is remembered", async ({ page }) => {
  await signIn(page);
  await createAgent(page);
  const setup = new SetupPage(page);
  await setup.completeKnowledge();

  await expect(setup.try.continueButton).toBeDisabled();
  await setup.try.skip();
  await setup.deploy.expectState("open");
  await setup.try.expectSummary("Skipped");

  await page.reload();
  await setup.try.expectState("done");
  await setup.try.expectSummary("Skipped");
  await setup.expectProgress(3);
});
