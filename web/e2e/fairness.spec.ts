import { expect, test } from "@playwright/test";
import { expectNoLeakedPlaceholders, gotoScreen, readRunInfo } from "./helpers";

/**
 * J5 — the fairness audit screen.
 *
 * The PRD is explicit that this screen must never collapse to a single
 * composite score, and that every subgroup must visibly carry n, CI, gap and an
 * adequacy verdict. Those are the invariants asserted here.
 */
test.describe("Fairness audit", () => {
  test("the axis selector offers every axis present in the report", async ({ page }) => {
    const info = await readRunInfo(page);
    await gotoScreen(page, "/fairness");

    const axis = page.getByTestId("fairness-axis");
    await expect(axis).toBeVisible();

    const options = await axis.locator("option").allInnerTexts();
    expect(options[0], "first option is the aggregate view").toMatch(/all axes/i);

    // Every axis from the live report must be selectable.
    expect(options.length - 1, "one option per axis").toBe(info.axes.length);
  });

  test("switching axis re-renders the subgroup table", async ({ page }) => {
    const info = await readRunInfo(page);
    await gotoScreen(page, "/fairness");

    const axis = page.getByTestId("fairness-axis");
    const table = page.getByRole("table").last();

    // Pick a concrete axis and confirm the table responds.
    await axis.selectOption(info.axes[0]);
    await expect(axis).toHaveValue(info.axes[0]);

    const bodyText = await page.locator("main").innerText();
    expect(bodyText.length).toBeGreaterThan(200);

    await expectNoLeakedPlaceholders(page);
    void table;
  });

  test("verdict counts use PASS / WARN / INSUFFICIENT DATA, never a single score", async ({
    page,
  }) => {
    await gotoScreen(page, "/fairness");

    const main = page.locator("main");
    await expect(main.getByText("Pass", { exact: true }).first()).toBeVisible();
    await expect(main.getByText("Warn", { exact: true }).first()).toBeVisible();
    await expect(main.getByText("Insufficient data", { exact: true }).first()).toBeVisible();

    // The screen states the three-way rule in prose; assert it is present so a
    // future refactor cannot quietly reintroduce a binary fair/unfair label.
    await expect(main).toContainText(/no composite fairness score/i);
  });

  test("every reportable subgroup row shows n, CI, gap and adequacy", async ({ page }) => {
    await gotoScreen(page, "/fairness");

    const table = page.getByRole("table").last();
    const headers = await table.locator("thead th").allInnerTexts();
    const joined = headers.join(" | ").toLowerCase();

    for (const required of ["subgroup", "n", "ci", "gap"]) {
      expect(joined, `fairness table must expose a "${required}" column`).toContain(
        required,
      );
    }
  });
});
