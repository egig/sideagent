// The Knowledge page, outside setup.
import { expect, test } from "@playwright/test";
import { createAgent, signIn } from "../../support/fixtures";
import { KnowledgePage } from "../../pages/overview-page";

test("the Knowledge page points to the model first when none is connected", async ({ page }) => {
  await signIn(page);
  const agentId = await createAgent(page);
  const knowledge = new KnowledgePage(page);
  await knowledge.goto(agentId);
  await expect(knowledge.noModelNotice).toBeVisible();
  await knowledge.connectModelFirst();
  await expect(page).toHaveURL(new RegExp(`/agents/${agentId}/setup$`));
});
