// Setup step 2, add knowledge: pasted text and instructions finish the step.
import { expect, test } from "@playwright/test";
import { APP_ORIGIN, GOOD_KEY, LLM_BASE_URL, WRONG_KEY } from "../../support/constants";
import { createAgent, signIn } from "../../support/fixtures";
import { SetupPage } from "../../pages/setup-page";

test("pasted text and instructions each finish the step", async ({ page }) => {
  await signIn(page);
  await createAgent(page);
  const setup = new SetupPage(page);
  const { knowledge } = setup;
  await setup.completeLlm();

  // Nothing yet: Continue waits for a source or instructions.
  await expect(knowledge.hint).toBeVisible();
  await expect(knowledge.continueButton).toBeDisabled();
  await knowledge.addText("Shipping", "Orders ship within 2 business days.");
  await knowledge.expectIndexed();
  await expect(knowledge.continueButton).toBeEnabled();
  await knowledge.continueButton.click();
  await setup.try.expectState("open");
});

test("instructions alone are enough", async ({ page }) => {
  await signIn(page);
  await createAgent(page);
  const setup = new SetupPage(page);
  await setup.completeLlm();

  await setup.knowledge.saveInstructions("Answer in one short paragraph.");
  await expect(setup.knowledge.continueButton).toBeEnabled();
  await setup.knowledge.continueButton.click();
  await setup.try.expectState("open");
});
