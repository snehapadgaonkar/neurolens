import { expect, test } from "@playwright/test";
import {
  CASE_MISSING,
  CASE_WITH_SUBGROUPS,
  expectNoLeakedPlaceholders,
  gotoScreen,
} from "./helpers";

/**
 * J4 — drilling from the case list into one patient.
 *
 * This is the deepest screen in the workspace and the one most likely to break
 * silently, because it reads several optional report sections (explanation,
 * subgroup context) that are absent for some patients.
 */
test.describe("Case detail", () => {
  test("opens a patient from the table and shows their full evidence", async ({ page }) => {
    await gotoScreen(page, "/cases");
    await expect(page.getByTestId("case-count")).toContainText("held-out cases");

    const link = page.getByRole("link", { name: CASE_WITH_SUBGROUPS }).first();
    await link.click();

    await expect(page).toHaveURL(new RegExp(`/cases/${CASE_WITH_SUBGROUPS}$`));

    // The patient identifier is rendered in the page, not just the URL.
    await expect(page.locator("main")).toContainText(CASE_WITH_SUBGROUPS);

    const main = page.locator("main");
    // The four things DESIGN.md says must survive on every screen: the
    // prediction, its interval, the uncertainty, and the attribution.
    await expect(main.getByText("Why the model predicted this")).toBeVisible();
    await expect(main).toContainText(/interval/i);
    await expect(main).toContainText(/uncertainty/i);

    await expectNoLeakedPlaceholders(page);
  });

  test("shows the subgroup context for a patient that has it", async ({ page }) => {
    await page.goto(`/cases/${CASE_WITH_SUBGROUPS}`);
    await expect(page.locator("main")).toContainText(CASE_WITH_SUBGROUPS);

    // sub-274 carries fairness rows; assert at least one axis label surfaces.
    const main = page.locator("main");
    await expect(main).toContainText(/sex/i);
  });

  test("an unknown patient id renders an explicit not-found state", async ({ page }) => {
    await page.goto(`/cases/${CASE_MISSING}`);

    await expect(page.getByText("Case not found")).toBeVisible();

    // The recovery path must be present and must work.
    const back = page.getByRole("link", { name: "Back to cases" }).first();
    await back.click();
    await expect(page).toHaveURL(/\/cases$/);
  });
});
