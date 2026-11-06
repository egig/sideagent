// The guided setup, end to end in a browser: model → knowledge → preview → deploy → a real request.
import { expect, test } from "@playwright/test";
import { APP_ORIGIN, DOCS_PAGE, GOOD_KEY, LLM_BASE_URL, WRONG_KEY } from "../../support/constants";
import { OverviewPage } from "../../pages/overview-page";
import { createAgent, signIn } from "../../support/fixtures";
import { SetupPage } from "../../pages/setup-page";

const MODEL = { baseUrl: LLM_BASE_URL, model: "gpt-4o-mini" };

test("a new agent goes from the model to a live request, one step at a time", async ({ page, request }) => {
  await signIn(page);
  const agentId = await createAgent(page);
  const setup = new SetupPage(page);
  const overview = new OverviewPage(page);

  // Step 1 is open; the later steps wait for it.
  await setup.llm.expectState("open");
  await setup.knowledge.expectState("locked");
  await setup.expectProgress(0);

  await setup.llm.fill(GOOD_KEY, MODEL);
  await setup.llm.saveAndContinue();
  await setup.llm.expectState("done");
  await setup.knowledge.expectState("open");

  // Step 2: a docs page is fetched and indexed in the background.
  await expect(setup.knowledge.continueButton).toBeDisabled();
  await setup.knowledge.addPage(DOCS_PAGE);
  await setup.knowledge.expectIndexed();
  await setup.knowledge.continueButton.click();
  await setup.try.expectState("open");

  // Step 3: the owner asks in the preview; the step notices the answered turn.
  await expect(setup.try.continueButton).toBeDisabled();
  await setup.try.openPreview();
  const chat = await setup.try.ask("How are refunds paid?");
  // The scripted model searches the knowledge and answers from the passage it found.
  await expect(chat.getByRole("link", { name: "Refund policy" }).first()).toBeVisible();
  await expect(chat.locator("p", { hasText: "Refunds are paid within 5 business days" })).toBeVisible();
  await setup.try.expectAnswered();
  await setup.try.closePreview();
  await setup.try.continueButton.click();
  await setup.deploy.expectState("open");

  // Step 4: an origin typed but not added with "Add" is saved too; then anonymous sign-in.
  await setup.deploy.saveOrigin(APP_ORIGIN);
  await setup.deploy.chooseAnonymousAuth();
  await expect(setup.deploy.continueButton).toBeEnabled();
  await setup.deploy.expectEmbedCode();
  await setup.deploy.continueButton.click();

  // Step 5: activate, then wait for a real request from the app.
  await setup.live.expectState("open");
  await setup.live.activate();

  const { agent } = (await (await page.request.get(`/api/agents/${agentId}`)).json()) as {
    agent: { publishableKey: string };
  };
  const ask = (origin: string) =>
    request.post(`/v1/agents/${agentId}`, {
      headers: { origin, "x-sideagent-key": agent.publishableKey },
      data: { message: "What is the refund policy?" },
    });

  // A typo in the origin shows up while waiting.
  const refused = await ask("https://ap.example.com");
  expect(refused.status()).toBe(403);
  await setup.live.expectRefusal("Origin is not in the allowed list");

  const ok = await ask(APP_ORIGIN);
  expect(ok.status()).toBe(200);
  await ok.text(); // the turn is logged when its stream ends
  await setup.live.expectLive();
  await setup.expectProgress(5);

  // Once active, the Overview no longer sends the owner to setup, and the menu drops it.
  await setup.live.goToOverview();
  await overview.expectUrl(agentId);
  await expect(overview.continueSetupLink).toHaveCount(0);
  await expect(overview.menuSetupLink).toHaveCount(0);

  // The Overview counts the public endpoint only: one turn and one refusal, not the preview turn.
  await expect(overview.statValue("turns")).toHaveText("1");
  await expect(overview.statValue("success")).toHaveText("100%");
  await expect(overview.statValue("refused")).toHaveText("1");
  await expect(overview.stat("turns")).toContainText("No earlier data to compare");
  await expect(page.getByText("1 request was refused in the last 7 days.")).toBeVisible();
  await overview.selectRange("24 hours");
  await expect(overview.stat("turns")).toContainText("Chat turns");
  await expect(overview.statValue("turns")).toHaveText("1");
});
