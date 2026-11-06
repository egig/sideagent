// Setup step 4, deploy: origins and the three ways users sign in.
import { expect, test } from "@playwright/test";
import { APP_ORIGIN, GOOD_KEY, LLM_BASE_URL, WRONG_KEY } from "../../support/constants";
import { createAgent, signIn } from "../../support/fixtures";
import { SetupPage } from "../../pages/setup-page";

test("Continue waits for both an origin and a sign-in choice", async ({ page }) => {
  await signIn(page);
  await createAgent(page);
  const setup = new SetupPage(page);
  await setup.completeKnowledge();
  await setup.try.skip();
  const { deploy } = setup;

  await expect(deploy.hint).toBeVisible();
  await expect(deploy.continueButton).toBeDisabled();
  await deploy.saveOrigin(APP_ORIGIN);
  await expect(deploy.continueButton).toBeDisabled();
  await deploy.chooseAnonymousAuth();
  await expect(deploy.continueButton).toBeEnabled();
});

for (const [kind, label] of [
  ["jwt", "JWKS"],
  ["opaque", "userinfo"],
] as const) {
  test(`a ${label} sign-in shows the token note in the embed code`, async ({ page }) => {
    await signIn(page);
    await createAgent(page);
    const setup = new SetupPage(page);
    await setup.completeKnowledge();
    await setup.try.skip();

    await setup.deploy.saveOrigin(APP_ORIGIN);
    await setup.deploy.chooseTokenAuth(kind);
    await expect(setup.deploy.continueButton).toBeEnabled();
    await setup.deploy.expectEmbedCode();
    await expect(setup.deploy.card.getByText("getToken").first()).toBeVisible();
    await setup.deploy.continueButton.click();
    await setup.live.expectState("open");
  });
}

test("an origin that is not HTTPS-shaped is refused", async ({ page }) => {
  await signIn(page);
  await createAgent(page);
  const setup = new SetupPage(page);
  await setup.completeKnowledge();
  await setup.try.skip();

  await setup.deploy.card.getByLabel("Allowed origins").fill("not an origin");
  await setup.deploy.originsForm.getByRole("button", { name: "Save changes" }).click();
  await expect(setup.deploy.originsForm.locator("p.text-danger")).toBeVisible();
  await expect(setup.deploy.continueButton).toBeDisabled();
});
