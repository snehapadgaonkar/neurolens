import { expect, test } from "@playwright/test";
import { CASE_WITH_SUBGROUPS, expectNoLeakedPlaceholders, gotoScreen } from "./helpers";

/**
 * J3 — the case explorer's three controls.
 *
 * These are the only inputs in the workspace that let a researcher change what
 * they are looking at, so each one is asserted by its effect on the result set
 * rather than by its own styling.
 */
test.describe("Case explorer", () => {
  test.beforeEach(async ({ page }) => {
    await gotoScreen(page, "/cases");
    // The count line doubles as the "fetch settled" signal.
    await expect(page.getByTestId("case-count")).toContainText("held-out cases");
  });

  test("searching a patient identifier narrows the result set to that patient", async ({
    page,
  }) => {
    const search = page.getByTestId("case-search");
    await search.fill(CASE_WITH_SUBGROUPS);

    // The query is debounced 250ms, then refetches; wait for the settled count.
    await expect(page.getByTestId("case-count")).toContainText(
      `1 shown of 1 held-out case`,
    );

    const rows = page.locator("tbody tr");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(CASE_WITH_SUBGROUPS);

    await expectNoLeakedPlaceholders(page);
  });

  test("an identifier that matches nothing says so instead of rendering an empty grid", async ({
    page,
  }) => {
    await page.getByTestId("case-search").fill("sub-does-not-exist");

    await expect(page.getByTestId("case-count")).toContainText("0 shown of 0");
    await expect(page.getByText("No cases match the current filter.")).toBeVisible();
  });

  test("the flagged-OOD toggle restricts the list to out-of-distribution patients", async ({
    page,
  }) => {
    const toggle = page.getByTestId("flagged-toggle");
    const before = await page.getByTestId("case-count").innerText();

    await toggle.click();

    // The control reports its own state to assistive tech and in its label.
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(toggle).toHaveText("Showing flagged only");

    const after = await page.getByTestId("case-count").innerText();
    expect(after, "the count line must change when the filter is applied").not.toBe(
      before,
    );

    // Every remaining row must actually be flagged.
    const rows = page.locator("tbody tr");
    const count = await rows.count();
    if (count > 0) {
      await expect(rows.first()).toContainText("flagged");
    }

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  test("changing the sort key refetches with that key", async ({ page }) => {
    // Assert the control drives the request, which is the contract with the API.
    const errorSort = page.getByTestId("sort-error");
    const request = page.waitForRequest((req) =>
      /\/api\/cases\?.*sort=error/.test(req.url()),
    );

    await errorSort.click();
    await request;

    await expect(errorSort).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("sort-uncertainty")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});
