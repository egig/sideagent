// Page objects for the guided setup (/agents/:id/setup): the page, and one class per step card.
import { expect, type Locator, type Page } from "@playwright/test";
import { DOCS_PAGE, GOOD_KEY, LLM_BASE_URL } from "../support/constants";

export type StepId = "llm" | "knowledge" | "try" | "deploy" | "live";
type StepState = "open" | "done" | "todo" | "locked";

class Step {
  readonly card: Locator;
  constructor(
    protected readonly page: Page,
    readonly id: StepId,
  ) {
    this.card = page.locator(`li[data-step="${id}"]`);
  }

  async expectState(state: StepState) {
    await expect(this.card).toHaveAttribute("data-state", state);
  }

  /** The line under the step title. */
  async expectSummary(text: string | RegExp) {
    await expect(this.card.getByRole("heading", { level: 2 })).toContainText(text);
  }

  /** A done step opens again for changes. */
  async reopen(title: RegExp) {
    await this.card.getByRole("button", { name: title }).click();
  }

  get continueButton() {
    return this.card.getByRole("button", { name: "Continue" });
  }
}

export class LlmStep extends Step {
  readonly testButton = this.card.getByRole("button", { name: "Test connection" });
  readonly saveContinueButton = this.card.getByRole("button", { name: "Save & Continue" });

  async fill(apiKey: string, { baseUrl, model }: { baseUrl: string; model: string }) {
    await this.card.locator("#llm-base").fill(baseUrl);
    await this.card.locator("#llm-model").fill(model);
    await this.card.locator("#llm-key").fill(apiKey);
  }

  async replaceKey(apiKey: string) {
    await this.card.getByRole("button", { name: "Replace key" }).click();
    await this.card.locator("#llm-key").fill(apiKey);
  }

  async testConnection() {
    await this.testButton.click();
  }

  async expectConnected() {
    await expect(this.card.getByText("Connected. The chat model and the embedding model both answered.")).toBeVisible();
  }

  /** The text under a field after the server refused it. */
  fieldError(text: string) {
    return this.card.getByText(text, { exact: true });
  }

  async chooseProvider(provider: "Built-in" | "Your own key") {
    await this.card.getByRole("radio", { name: new RegExp(`^${provider}`) }).click();
  }

  get usage() {
    return this.card.getByRole("img", { name: /built-in messages used/ });
  }

  get reindexWarning() {
    return this.card.getByText(/Saving re-indexes all/);
  }

  async setEmbeddingModel(model: string) {
    await this.card.locator("#llm-embedding").fill(model);
  }

  async clearModel() {
    await this.card.locator("#llm-model").fill("");
  }

  async setBaseUrl(url: string) {
    await this.card.locator("#llm-base").fill(url);
  }

  /** True when the browser's own validation would block the form. */
  async isFieldInvalid(id: "llm-base" | "llm-model" | "llm-embedding" | "llm-key") {
    return this.card.locator(`#${id}`).evaluate((el) => !(el as HTMLInputElement).validity.valid);
  }

  async saveAndContinue() {
    await this.saveContinueButton.click();
  }
}

export class KnowledgeStep extends Step {
  async addPage(url: string) {
    await this.card.getByLabel("Page URL").fill(url);
    await this.card.getByRole("button", { name: "Add source" }).click();
  }

  async addText(title: string, content: string) {
    await this.card.getByRole("button", { name: "Paste text" }).click();
    await this.card.getByLabel("Title").fill(title);
    await this.card.getByLabel("Text", { exact: true }).fill(content);
    await this.card.getByRole("button", { name: "Add source" }).click();
  }

  async saveInstructions(text: string) {
    await this.card.getByLabel("Instructions").fill(text);
    await this.card.getByRole("button", { name: "Save changes" }).click();
  }

  get hint() {
    return this.card.getByText("Add a source that finishes indexing, or save instructions.");
  }

  async expectIndexed() {
    await expect(this.card.getByText("Indexed", { exact: true })).toBeVisible();
  }
}

export class TryStep extends Step {
  async openPreview() {
    await this.card.getByRole("button", { name: "Open preview" }).click();
  }

  /** Asks in the preview panel and returns the panel for assertions. */
  async ask(question: string) {
    const composer = this.page.getByPlaceholder("Ask your agent anything");
    await composer.fill(question);
    await composer.press("Enter");
    return this.page.getByRole("region", { name: "Docs helper" });
  }

  async skip() {
    await this.card.getByRole("button", { name: "Skip for now" }).click();
  }

  async closePreview() {
    await this.page.getByRole("button", { name: "Close preview" }).click();
  }

  async expectAnswered() {
    await expect(this.card.getByText("The agent answered in the preview.")).toBeVisible();
  }
}

export class DeployStep extends Step {
  readonly originsForm = this.card.locator("form", { has: this.page.locator("#origin") });
  readonly authForm = this.card.locator("form", { hasText: "What does your login give a signed-in browser?" });

  /** Types an origin without pressing "Add": saving takes it too. */
  async saveOrigin(origin: string) {
    await this.card.getByLabel("Allowed origins").fill(origin);
    await this.originsForm.getByRole("button", { name: "Save changes" }).click();
    await expect(this.originsForm.getByText(origin, { exact: true })).toBeVisible();
  }

  /** Picks a token mode and fills its fields: "jwt" (JWKS) or "opaque" (userinfo). */
  async chooseTokenAuth(kind: "jwt" | "opaque") {
    if (kind === "jwt") {
      await this.card.getByText("A bearer JWT").click();
      await this.card.locator("#jwks-url").fill("https://auth.example.com/.well-known/jwks.json");
      await this.card.locator("#issuer").fill("https://auth.example.com/");
      await this.card.locator("#audience").fill("sideagent-e2e");
    } else {
      await this.card.getByText("An opaque bearer token").click();
      await this.card.locator("#userinfo-url").fill("https://auth.example.com/userinfo");
    }
    await this.authForm.getByRole("button", { name: /save/i }).click();
  }

  get hint() {
    return this.card.getByText("Save an allowed origin and how users sign in.");
  }

  async chooseAnonymousAuth() {
    await this.card.getByText("Nothing, or there is no API").click();
    await this.authForm.getByRole("button", { name: /save/i }).click();
  }

  async expectEmbedCode() {
    await expect(this.card.getByText(/publishableKey="pk_/)).toBeVisible();
  }
}

export class LiveStep extends Step {
  async activate() {
    await this.card.getByRole("button", { name: "Activate agent" }).click();
    await expect(this.card.getByText("Waiting for the first request")).toBeVisible();
  }

  async expectRefusal(reason: string) {
    await expect(this.card.getByText(reason)).toBeVisible();
  }

  async expectLive() {
    await expect(this.card.getByText("Your agent is live.")).toBeVisible();
  }

  async goToOverview() {
    await this.card.getByRole("link", { name: "Go to overview" }).click();
  }
}

export class SetupPage {
  readonly llm: LlmStep;
  readonly knowledge: KnowledgeStep;
  readonly try: TryStep;
  readonly deploy: DeployStep;
  readonly live: LiveStep;

  constructor(readonly page: Page) {
    this.llm = new LlmStep(page, "llm");
    this.knowledge = new KnowledgeStep(page, "knowledge");
    this.try = new TryStep(page, "try");
    this.deploy = new DeployStep(page, "deploy");
    this.live = new LiveStep(page, "live");
  }

  /** Step 1 through the UI with the working fake provider. */
  async completeLlm() {
    await this.llm.fill(GOOD_KEY, { baseUrl: LLM_BASE_URL, model: "gpt-4o-mini" });
    await this.llm.saveAndContinue();
    await this.knowledge.expectState("open");
  }

  /** Steps 1 and 2: a model and one indexed docs page. */
  async completeKnowledge() {
    await this.completeLlm();
    await this.knowledge.addPage(DOCS_PAGE);
    await this.knowledge.expectIndexed();
    await this.knowledge.continueButton.click();
    await this.try.expectState("open");
  }

  async goto(agentId: string) {
    await this.page.goto(`/agents/${agentId}/setup`);
  }

  async expectProgress(done: number) {
    await expect(this.page.getByText(`${done} of 5 done`)).toBeVisible();
  }

  async openFromMenu() {
    await this.page.getByRole("navigation", { name: "Agent" }).getByRole("link", { name: "Setup" }).click();
  }
}
