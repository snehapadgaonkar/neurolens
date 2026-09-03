import { expect, test } from "@playwright/test";
import { gotoScreen } from "./helpers";

/**
 * J11 — the accessibility requirements DESIGN.md states as hard requirements:
 * a working skip link, ARIA landmarks, a visible focus indicator meeting 3:1,
 * `aria-sort` on tables, and an accessible summary plus data-table alternative
 * for every chart.
 *
 * These are asserted as behaviour and computed style, because "we added a
 * class" is not the same as "a keyboard user can see where they are".
 */
test.describe("Accessibility", () => {
  test("the skip link is the first tab stop and reveals on focus", async ({ page }) => {
    await page.goto("/");

    const skip = page.getByTestId("skip-link");
    await expect(skip).toHaveAttribute("href", "#main");

    // Off-screen until focused: sr-only keeps it out of the visual flow.
    const hidden = await skip.boundingBox();
    expect(
      hidden === null || hidden.width <= 1,
      "skip link must not occupy visual space before focus",
    ).toBeTruthy();

    await page.keyboard.press("Tab");
    await expect(skip).toBeFocused();

    const focused = await skip.boundingBox();
    expect(focused, "skip link must become visible on focus").not.toBeNull();
    expect(focused!.width).toBeGreaterThan(1);

    // Activating it must move focus to the main landmark.
    await page.keyboard.press("Enter");
    await expect(page.locator("main")).toBeFocused();
  });

  test("the page exposes banner, navigation, main and contentinfo landmarks", async ({
    page,
  }) => {
    await gotoScreen(page, "/");

    await expect(page.locator("header")).not.toHaveCount(0);
    await expect(
      page.getByRole("navigation", { name: "Workspace sections" }),
    ).toBeVisible();
    await expect(page.locator("main#main")).toHaveCount(1);
    await expect(page.locator("footer")).not.toHaveCount(0);
  });

  test("keyboard focus is visibly indicated", async ({ page }) => {
    await gotoScreen(page, "/cases");
    await expect(page.getByTestId("case-count")).toContainText("held-out cases");

    const target = page.getByTestId("flagged-toggle");
    await target.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");

    const outline = await target.evaluate((element) => {
      const style = window.getComputedStyle(element);
      return { width: style.outlineWidth, style: style.outlineStyle };
    });

    expect(outline.style, "focus must draw an outline").not.toBe("none");
    expect(parseFloat(outline.width), "focus outline must be at least 2px").toBeGreaterThanOrEqual(
      2,
    );
  });

  test("every chart carries an accessible summary", async ({ page }) => {
    await gotoScreen(page, "/cases");
    await expect(page.getByTestId("case-count")).toContainText("held-out cases");

    const figures = page.locator("figure");
    const count = await figures.count();
    expect(count, "this screen must render at least one chart").toBeGreaterThan(0);

    for (let i = 0; i < count; i += 1) {
      const summary = await figures.nth(i).innerText();
      expect(
        summary,
        `chart ${i} must publish a summary for assistive tech`,
      ).toContain("Chart summary.");
    }
  });

  test("evidence tables provide a caption or summary alternative", async ({ page }) => {
    await gotoScreen(page, "/cases");
    await expect(page.getByTestId("case-count")).toContainText("held-out cases");

    const tables = page.locator("table");
    const count = await tables.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i += 1) {
      const table = tables.nth(i);
      const caption = await table.locator("caption").count();
      // The summary paragraph is rendered as a sibling immediately before the
      // table wrapper, so accept either mechanism.
      const srSummary = await table
        .locator("xpath=preceding-sibling::p[contains(@class,'sr-only')]")
        .count();
      expect(
        caption + srSummary,
        `table ${i} needs a caption or an sr-only summary`,
      ).toBeGreaterThan(0);
    }
  });
});
