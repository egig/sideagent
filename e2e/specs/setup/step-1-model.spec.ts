// Setup step 1, connect a model: validation, refusals, the connection test and the re-index warning.
import { expect, test } from "@playwright/test";
import { APP_ORIGIN, GOOD_KEY, LLM_BASE_URL, WRONG_KEY } from "../../support/constants";
import { createAgent, signIn } from "../../support/fixtures";
import { SetupPage } from "../../pages/setup-page";

const MODEL = { baseUrl: LLM_BASE_URL, model: "gpt-4o-mini" };

test("the browser blocks an empty field, and nothing is saved", async ({ page }) => {
  await signIn(page);
  await createAgent(page);
  const { llm } = new SetupPage(page);

  await llm.fill(GOOD_KEY, MODEL);
  await llm.clearModel();
  await llm.saveAndContinue();
  expect(await llm.isFieldInvalid("llm-model")).toBe(true);
  await llm.testConnection();
  await llm.expectState("open");
  await expect(llm.card.getByText(/Connected\./)).toHaveCount(0);

  // Nothing reached the server: after a reload the step is still not done.
  await page.reload();
  await llm.expectState("open");
  await new SetupPage(page).expectProgress(0);
});

test("the server's refusal of a base URL shows under the field", async ({ page }) => {
  await signIn(page);
  await createAgent(page);
  const { llm } = new SetupPage(page);

  await llm.fill(GOOD_KEY, MODEL);
  await llm.setBaseUrl("http://llm.example.com/v1");
  await llm.saveAndContinue();
  await expect(llm.fieldError("HTTPS only.")).toBeVisible();

  await llm.setBaseUrl("https://llm.private.example/v1");
  await llm.saveAndContinue();
  await expect(llm.fieldError("The host resolves to a private or internal address.")).toBeVisible();
  await llm.expectState("open");
});

test("Test connection alone saves and tests, and stays on the step", async ({ page }) => {
  await signIn(page);
  await createAgent(page);
  const { llm, knowledge } = new SetupPage(page);

  await llm.fill(GOOD_KEY, MODEL);
  await llm.testConnection();
  await llm.expectConnected();
  // The model is saved, so the next step is no longer locked, but this one stays open.
  await llm.expectState("open");
  await knowledge.expectState("todo");

  // The result stays, and Save & Continue now moves on without changes to save.
  await llm.saveAndContinue();
  await knowledge.expectState("open");
});

test("changing the embedding model warns that the knowledge is re-indexed", async ({ page }) => {
  await signIn(page);
  await createAgent(page);
  const setup = new SetupPage(page);
  await setup.completeKnowledge();

  await setup.llm.reopen(/Connect a model/);
  await setup.llm.expectState("open");
  await expect(setup.llm.reindexWarning).toHaveCount(0);
  await setup.llm.setEmbeddingModel("text-embedding-3-large");
  await expect(setup.llm.reindexWarning).toContainText("1 knowledge source");
});

test("a wrong API key is caught by the connection test, before any knowledge fails", async ({ page }) => {
  await signIn(page);
  await createAgent(page);
  const { llm, knowledge } = new SetupPage(page);

  await llm.fill(WRONG_KEY, MODEL);
  await llm.testConnection();
  await expect(llm.card.getByText("Model: the provider refused the API key.", { exact: true })).toBeVisible();
  await expect(llm.card.getByText("Embedding model: the provider refused the API key.")).toBeVisible();
  await expect(page.getByText(WRONG_KEY)).toHaveCount(0);
  // Saved settings count as "done", but the step stays open until the test passes.
  await llm.expectState("open");

  await llm.replaceKey(GOOD_KEY);
  await llm.saveAndContinue();
  await knowledge.expectState("open");
});
