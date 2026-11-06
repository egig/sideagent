// Page objects for the agent Overview and Knowledge pages.
import { expect, type Locator, type Page } from "@playwright/test";

export class OverviewPage {
  constructor(private readonly page: Page) {}

  stat(id: "turns" | "success" | "refused"): Locator {
    return this.page.locator(`[data-stat="${id}"]`);
  }

  statValue(id: "turns" | "success" | "refused") {
    return this.stat(id).locator("dd").first();
  }

  async selectRange(name: "24 hours") {
    await this.page.getByRole("button", { name }).click();
  }

  get continueSetupLink() {
    return this.page.getByRole("link", { name: "Continue setup" });
  }

  get menuSetupLink() {
    return this.page.getByRole("navigation", { name: "Agent" }).getByRole("link", { name: "Setup" });
  }

  async expectUrl(agentId: string) {
    await expect(this.page).toHaveURL(new RegExp(`/agents/${agentId}$`));
  }
}

export class KnowledgePage {
  readonly noModelNotice: Locator;

  constructor(private readonly page: Page) {
    this.noModelNotice = page.getByText("Indexing needs a model, and none is connected yet.");
  }

  async goto(agentId: string) {
    await this.page.goto(`/agents/${agentId}/knowledge`);
  }

  async connectModelFirst() {
    await this.page.getByRole("link", { name: "Connect a model first" }).click();
  }
}
