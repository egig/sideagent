// The guided setup, end to end in a browser: model → knowledge → preview → deploy → a real request.
import { expect, test, type Page } from "@playwright/test";
import { APP_ORIGIN, DOCS_PAGE, GOOD_KEY, LLM_BASE_URL, WRONG_KEY } from "./constants";
import { createAgent, signIn, step } from "./fixtures";

async function fillModel(page: Page, apiKey: string) {
  const card = step(page, "llm");
  await card.locator("#llm-base").fill(LLM_BASE_URL);
  await card.locator("#llm-model").fill("gpt-4o-mini");
  await card.locator("#llm-key").fill(apiKey);
  await card.getByRole("button", { name: "Save changes" }).click();
  await expect(card.getByRole("button", { name: "Save changes" })).toBeDisabled();
}

test("a new agent goes from the model to a live request, one step at a time", async ({ page, request }) => {
  await signIn(page);
  const agentId = await createAgent(page);

  // Step 1 is open; the later steps wait for it.
  await expect(step(page, "llm")).toHaveAttribute("data-state", "open");
  await expect(step(page, "knowledge")).toHaveAttribute("data-state", "locked");
  await expect(page.getByText("0 of 5 done")).toBeVisible();
  await expect(step(page, "llm").getByRole("button", { name: "Test and continue" })).toBeDisabled();

  await fillModel(page, GOOD_KEY);
  await step(page, "llm").getByRole("button", { name: "Test and continue" }).click();
  await expect(step(page, "llm")).toHaveAttribute("data-state", "done");
  await expect(step(page, "knowledge")).toHaveAttribute("data-state", "open");

  // Step 2: a docs page is fetched and indexed in the background.
  const knowledge = step(page, "knowledge");
  await expect(knowledge.getByRole("button", { name: "Continue" })).toBeDisabled();
  await knowledge.getByLabel("Page URL").fill(DOCS_PAGE);
  await knowledge.getByRole("button", { name: "Add source" }).click();
  await expect(knowledge.getByText("Indexed", { exact: true })).toBeVisible();
  await knowledge.getByRole("button", { name: "Continue" }).click();
  await expect(step(page, "try")).toHaveAttribute("data-state", "open");

  // Step 3: the owner asks in the preview; the step notices the answered turn.
  const tryIt = step(page, "try");
  await expect(tryIt.getByRole("button", { name: "Continue" })).toBeDisabled();
  await tryIt.getByRole("button", { name: "Open preview" }).click();
  const composer = page.getByPlaceholder("Ask your agent anything");
  await composer.fill("How are refunds paid?");
  await composer.press("Enter");
  // The scripted model searches the knowledge and answers from the passage it found.
  const chat = page.getByRole("region", { name: "Docs helper" });
  await expect(chat.getByRole("link", { name: "Refund policy" }).first()).toBeVisible();
  await expect(chat.locator("p", { hasText: "Refunds are paid within 5 business days" })).toBeVisible();
  await expect(tryIt.getByText("The agent answered in the preview.")).toBeVisible();
  await page.getByRole("button", { name: "Close preview" }).click();
  await tryIt.getByRole("button", { name: "Continue" }).click();
  await expect(step(page, "deploy")).toHaveAttribute("data-state", "open");

  // Step 4: an origin typed but not added with "Add" is saved too; then anonymous sign-in.
  const deploy = step(page, "deploy");
  await deploy.getByLabel("Allowed origins").fill(APP_ORIGIN);
  const originsForm = deploy.locator("form", { has: page.locator("#origin") });
  await originsForm.getByRole("button", { name: "Save changes" }).click();
  await expect(originsForm.getByText(APP_ORIGIN, { exact: true })).toBeVisible();
  await deploy.getByText("Nothing, or there is no API").click();
  const authForm = deploy.locator("form", { hasText: "What does your login give a signed-in browser?" });
  await authForm.getByRole("button", { name: /save/i }).click();
  await expect(deploy.getByRole("button", { name: "Continue" })).toBeEnabled();
  await expect(deploy.getByText(/publishableKey="pk_/)).toBeVisible();
  await deploy.getByRole("button", { name: "Continue" }).click();

  // Step 5: activate, then wait for a real request from the app.
  const live = step(page, "live");
  await expect(live).toHaveAttribute("data-state", "open");
  await live.getByRole("button", { name: "Activate agent" }).click();
  await expect(live.getByText("Waiting for the first request")).toBeVisible();

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
  await expect(live.getByText("Origin is not in the allowed list")).toBeVisible();

  const ok = await ask(APP_ORIGIN);
  expect(ok.status()).toBe(200);
  await ok.text(); // the turn is logged when its stream ends
  await expect(live.getByText("Your agent is live.")).toBeVisible();
  await expect(page.getByText("5 of 5 done")).toBeVisible();

  // Once active, the Overview no longer sends the owner to setup, and the menu drops it.
  await live.getByRole("link", { name: "Go to overview" }).click();
  await expect(page).toHaveURL(new RegExp(`/agents/${agentId}$`));
  await expect(page.getByRole("link", { name: "Continue setup" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Agent" }).getByRole("link", { name: "Setup" })).toHaveCount(0);

  // The Overview counts the public endpoint only: one turn and one refusal, not the preview turn.
  const stat = (id: string) => page.locator(`[data-stat="${id}"] dd`).first();
  await expect(stat("turns")).toHaveText("1");
  await expect(stat("success")).toHaveText("100%");
  await expect(stat("refused")).toHaveText("1");
  await expect(page.locator('[data-stat="turns"]')).toContainText("No earlier data to compare");
  await expect(page.getByText("1 request was refused in the last 7 days.")).toBeVisible();
  await page.getByRole("button", { name: "24 hours" }).click();
  await expect(page.locator('[data-stat="turns"]')).toContainText("Chat turns");
  await expect(stat("turns")).toHaveText("1");
});

test("a wrong API key is caught by the connection test, before any knowledge fails", async ({ page }) => {
  await signIn(page);
  await createAgent(page);
  const llm = step(page, "llm");

  await fillModel(page, WRONG_KEY);
  await llm.getByRole("button", { name: "Test and continue" }).click();
  await expect(llm.getByText("Model: the provider refused the API key.", { exact: true })).toBeVisible();
  await expect(llm.getByText("Embedding model: the provider refused the API key.")).toBeVisible();
  await expect(page.getByText(WRONG_KEY)).toHaveCount(0);
  // Saved settings count as "done", but the step stays open until the test passes.
  await expect(llm).toHaveAttribute("data-state", "open");

  await llm.getByRole("button", { name: "Replace key" }).click();
  await llm.locator("#llm-key").fill(GOOD_KEY);
  await llm.getByRole("button", { name: "Save changes" }).click();
  await llm.getByRole("button", { name: "Test and continue" }).click();
  await expect(step(page, "knowledge")).toHaveAttribute("data-state", "open");
});

test("progress is read from the server, so a reload resumes at the next step", async ({ page }) => {
  await signIn(page);
  const agentId = await createAgent(page);
  await fillModel(page, GOOD_KEY);
  await step(page, "llm").getByRole("button", { name: "Test and continue" }).click();
  await expect(step(page, "knowledge")).toHaveAttribute("data-state", "open");

  await page.reload();
  await expect(step(page, "llm")).toHaveAttribute("data-state", "done");
  await expect(step(page, "knowledge")).toHaveAttribute("data-state", "open");
  await expect(page.getByText("1 of 5 done")).toBeVisible();

  // A done step opens again for changes.
  await step(page, "llm")
    .getByRole("button", { name: /Connect a model/ })
    .click();
  await expect(step(page, "llm")).toHaveAttribute("data-state", "open");

  // The Knowledge page no longer warns about a missing model, and the menu offers Setup while inactive.
  await page.goto(`/agents/${agentId}/knowledge`);
  await expect(page.getByText("Indexing needs a model")).toHaveCount(0);
  await page.getByRole("navigation", { name: "Agent" }).getByRole("link", { name: "Setup" }).click();
  await expect(page).toHaveURL(new RegExp(`/agents/${agentId}/setup$`));
});

test("the Knowledge page points to the model first when none is connected", async ({ page }) => {
  await signIn(page);
  const agentId = await createAgent(page);
  await page.goto(`/agents/${agentId}/knowledge`);
  await expect(page.getByText("Indexing needs a model, and none is connected yet.")).toBeVisible();
  await page.getByRole("link", { name: "Connect a model first" }).click();
  await expect(page).toHaveURL(new RegExp(`/agents/${agentId}/setup$`));
});
