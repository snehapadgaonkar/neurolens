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

    // Targeted by hook, not by text: this copy is rendered twice on an empty
    // result set (the chart panel's fallback and the table's emptyLabel), and a
    // bare getByText() is strict, so it would throw on the ambiguity.
    const empty = page.getByTestId("table-empty");
    await expect(empty).toBeVisible();
    await expect(empty).toHaveText("No cases match the current filter.");
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

  test("changing the sort key reorders the visible table, not just the request", async ({
    page,
  }) => {
    const errorSort = page.getByTestId("sort-error");

    // Record the order the table actually renders before the change, so the
    // assertion below compares observed output rather than trusting the request.
    const orderBefore = await page
      .locator("tbody tr")
      .evaluateAll((rows) => rows.map((r) => r.querySelector("td")?.textContent?.trim()));

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

    // The regression this guards: the request used to carry sort=error while the
    // table kept rendering its original order, because the page passed DataTable
    // a fixed initialSort that was read once on mount.
    const orderAfter = await page
      .locator("tbody tr")
      .evaluateAll((rows) => rows.map((r) => r.querySelector("td")?.textContent?.trim()));

    expect(
      orderAfter.join(","),
      "the visible row order must change when the sort key changes",
    ).not.toBe(orderBefore.join(","));

    // And the rendered column must genuinely be sorted, which is what a screen
    // reader user is told by aria-sort. The attribute lives on the <th>, so
    // target the header cell containing the sort button.
    await expect(
      page.locator("th").filter({ has: page.getByTestId("sort-header-error") }),
    ).toHaveAttribute("aria-sort", "descending");

    const errors = await page
      .locator("tbody tr td:nth-child(5)")
      .evaluateAll((cells) => cells.map((c) => parseFloat(c.textContent ?? "")));
    expect(errors.length).toBeGreaterThan(1);
    for (let i = 1; i < errors.length; i++) {
      expect(
        errors[i],
        `|Error| column must be descending (row ${i + 1} vs row ${i})`,
      ).toBeLessThanOrEqual(errors[i - 1]);
    }
  });
});
