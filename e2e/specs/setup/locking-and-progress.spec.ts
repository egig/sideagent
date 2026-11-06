// How the steps lock and how progress is read: from the server, so a reload resumes.
import { expect, test } from "@playwright/test";
import { APP_ORIGIN, GOOD_KEY, LLM_BASE_URL, WRONG_KEY } from "../../support/constants";
import { OverviewPage, KnowledgePage } from "../../pages/overview-page";
import { createAgent, signIn } from "../../support/fixtures";
import { SetupPage } from "../../pages/setup-page";

const MODEL = { baseUrl: LLM_BASE_URL, model: "gpt-4o-mini" };

test("a step stays shut until the ones before it are done", async ({ page }) => {
  await signIn(page);
  await createAgent(page);
  const setup = new SetupPage(page);

  for (const step of [setup.knowledge, setup.try, setup.deploy, setup.live]) {
    await step.expectState("locked");
    await expect(step.card.getByRole("button")).toHaveCount(0);
  }
  await setup.knowledge.expectSummary("Unlocks after step 1");
});

test("progress is read from the server, so a reload resumes at the next step", async ({ page }) => {
  await signIn(page);
  const agentId = await createAgent(page);
  const setup = new SetupPage(page);
  const overview = new OverviewPage(page);
  await setup.llm.fill(GOOD_KEY, MODEL);
  await setup.llm.saveAndContinue();
  await setup.knowledge.expectState("open");

  await page.reload();
  await setup.llm.expectState("done");
  await setup.knowledge.expectState("open");
  await setup.expectProgress(1);

  // A done step opens again for changes.
  await setup.llm.reopen(/Connect a model/);
  await setup.llm.expectState("open");

  // The Knowledge page no longer warns about a missing model, and the menu offers Setup while inactive.
  await new KnowledgePage(page).goto(agentId);
  await expect(page.getByText("Indexing needs a model")).toHaveCount(0);
  await overview.menuSetupLink.click();
  await expect(page).toHaveURL(new RegExp(`/agents/${agentId}/setup$`));
});
