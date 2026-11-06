// Setup on a host that offers its own model (e2e/server.ts with E2E_BUILTIN=1, the "builtin" project).
import { expect, test } from "@playwright/test";
import { BUILTIN_LIMIT, GOOD_KEY, LLM_BASE_URL } from "../../support/constants";
import { createAgent, signIn } from "../../support/fixtures";
import { SetupPage } from "../../pages/setup-page";

test("a new agent starts on the built-in model, so the model step is already done", async ({ page }) => {
  await signIn(page);
  await createAgent(page);
  const setup = new SetupPage(page);

  await setup.llm.expectState("done");
  await setup.knowledge.expectState("open");
  await setup.expectProgress(1);
});

test("Save & Continue on the built-in model needs no key and advances", async ({ page }) => {
  await signIn(page);
  await createAgent(page);
  const { llm, knowledge } = new SetupPage(page);

  await llm.reopen(/Connect a model/);
  await expect(llm.usage).toHaveAccessibleName(new RegExp(`3 of ${BUILTIN_LIMIT} built-in messages used`));
  await expect(llm.card.locator("#llm-key")).toHaveCount(0);
  await llm.saveAndContinue();
  await knowledge.expectState("open");
});

test("switching to your own key and back", async ({ page }) => {
  await signIn(page);
  await createAgent(page);
  const { llm, knowledge } = new SetupPage(page);

  await llm.reopen(/Connect a model/);
  await llm.chooseProvider("Your own key");
  await llm.fill(GOOD_KEY, { baseUrl: LLM_BASE_URL, model: "gpt-4o-mini" });
  await llm.testConnection();
  await llm.expectConnected();

  await llm.chooseProvider("Built-in");
  await expect(llm.card.locator("#llm-key")).toHaveCount(0);
  await llm.saveAndContinue();
  await knowledge.expectState("open");
});
