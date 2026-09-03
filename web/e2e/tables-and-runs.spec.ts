import { expect, test } from "@playwright/test";
import { gotoScreen, readRunInfo } from "./helpers";

/**
 * J6 — sortable evidence tables.
 *
 * DESIGN.md requires `aria-sort` on the sorted column, so the assertion checks
 * the accessible state and not just the visual arrow: a screen reader user has
 * to be told which column is ordered.
 */
test.describe("Sortable tables", () => {
  test("clicking a header sorts the column and publishes aria-sort", async ({ page }) => {
    await gotoScreen(page, "/cases");
    await expect(page.getByTestId("case-count")).toContainText("held-out cases");

    const header = page.getByTestId("sort-header-error").first();
    await expect(header).toBeVisible();

    const cell = header.locator("xpath=ancestor::th[1]");
    await expect(cell).toHaveAttribute("aria-sort", "descending");

    await header.click();
    await expect(cell).toHaveAttribute("aria-sort", "ascending");

    // Exactly one column may claim to be sorted at a time.
    const table = header.locator("xpath=ancestor::table[1]");
    await expect(
      table.locator('th[aria-sort="ascending"], th[aria-sort="descending"]'),
    ).toHaveCount(1);
  });

  test("the rendered row order actually follows the sort direction", async ({ page }) => {
    await gotoScreen(page, "/cases");
    await expect(page.getByTestId("case-count")).toContainText("held-out cases");

    const header = page.getByTestId("sort-header-uncertainty").first();
    const cell = header.locator("xpath=ancestor::th[1]");
    const table = header.locator("xpath=ancestor::table[1]");

    // Read the sorted column's numeric values in DOM order.
    const columnIndex = await header
      .locator("xpath=ancestor::th[1]/preceding-sibling::th")
      .count();

    const readColumn = async (): Promise<number[]> => {
      const rows = table.locator("tbody tr");
      const total = await rows.count();
      const values: number[] = [];
      for (let i = 0; i < total; i += 1) {
        const text = await rows.nth(i).locator("td").nth(columnIndex).innerText();
        const parsed = Number.parseFloat(text.replace(/[^\d.-]/g, ""));
        if (!Number.isNaN(parsed)) values.push(parsed);
      }
      return values;
    };

    await expect(cell).toHaveAttribute("aria-sort", "descending");
    const descending = await readColumn();
    expect(descending.length, "need rows to assert ordering").toBeGreaterThan(1);

    const isDescending = descending.every((value, index) =>
      index === 0 ? true : descending[index - 1] >= value,
    );
    expect(isDescending, `expected descending, got ${descending.slice(0, 5)}`).toBe(true);

    await header.click();
    await expect(cell).toHaveAttribute("aria-sort", "ascending");
    const ascending = await readColumn();
    const isAscending = ascending.every((value, index) =>
      index === 0 ? true : ascending[index - 1] <= value,
    );
    expect(isAscending, `expected ascending, got ${ascending.slice(0, 5)}`).toBe(true);
  });
});

/**
 * J7 — the run switcher.
 *
 * The control is rendered only when there is something to choose between, so
 * this asserts it reflects the served run, and only exercises switching when a
 * second run actually exists. Inventing a second run would mean seeding fake
 * evidence, which the project forbids.
 */
test.describe("Run switcher", () => {
  test("reflects the run the API is serving", async ({ page }) => {
    const info = await readRunInfo(page);
    await gotoScreen(page, "/");

    const switcher = page.getByTestId("run-switcher");
    await expect(switcher).toBeVisible();
    await expect(switcher).toHaveValue(info.runId);

    // The selected option's label is the human-readable run stamp.
    const selected = await switcher
      .locator(`option[value="${info.runId}"]`)
      .innerText();
    expect(selected.trim().length, "the run option must be labelled").toBeGreaterThan(0);
  });

  test("switching runs reloads the evidence for the chosen run", async ({ page }) => {
    const info = await readRunInfo(page);
    await gotoScreen(page, "/");

    const switcher = page.getByTestId("run-switcher");
    const options = await switcher.locator("option").count();

    test.skip(
      options < 2,
      "only one run is present; switching cannot be exercised without seeding a second one",
    );

    const other = await switcher
      .locator("option")
      .nth(1)
      .getAttribute("value");
    expect(other).not.toBe(info.runId);

    await switcher.selectOption(other!);

    // The report refetches for the new run; the switcher must stay put.
    await expect(switcher).toHaveValue(other!);
    await expect(page.getByTestId("load-error")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});
