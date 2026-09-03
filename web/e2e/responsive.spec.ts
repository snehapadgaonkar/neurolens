import { expect, test } from "@playwright/test";
import { expectNoLeakedPlaceholders, gotoScreen } from "./helpers";

/**
 * J10 — the 320px end of DESIGN.md's mobile range.
 *
 * Two things are product requirements here, not cosmetics: the navigation
 * sheet has to work, and the required reading order (research-use warning
 * before everything else) has to survive the narrow layout.
 */
test.describe("Responsive behaviour", () => {
  test.use({ viewport: { width: 320, height: 720 } });

  test("the navigation sheet opens and closes", async ({ page }) => {
    await gotoScreen(page, "/");

    const open = page.getByTestId("nav-open");
    await expect(open).toBeVisible();
    await expect(open).toHaveAttribute("aria-expanded", "false");

    await open.click();
    await expect(open).toHaveAttribute("aria-expanded", "true");

    // The rail is now on screen: it starts inside the viewport.
    const rail = page.getByRole("navigation", { name: "Workspace sections" });
    const railBox = await rail.boundingBox();
    expect(railBox, "rail must have layout").not.toBeNull();
    expect(railBox!.x, "rail must be slid into view").toBeGreaterThanOrEqual(0);

    await page.getByTestId("nav-close").click();
    await expect(open).toHaveAttribute("aria-expanded", "false");

    const closedBox = await rail.boundingBox();
    expect(closedBox!.x, "rail must slide back off screen").toBeLessThan(0);
  });

  test("the overlay closes the sheet", async ({ page }) => {
    await gotoScreen(page, "/");

    await page.getByTestId("nav-open").click();
    await page.getByTestId("nav-overlay").click();

    await expect(page.getByTestId("nav-open")).toHaveAttribute("aria-expanded", "false");
  });

  test("nothing overflows the 320px viewport horizontally", async ({ page }) => {
    await gotoScreen(page, "/cases");
    await expect(page.getByTestId("case-count")).toContainText("held-out cases");

    // A horizontal scrollbar on a phone means a table escaped its scroll wrapper.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `content overflows by ${overflow}px`).toBeLessThanOrEqual(1);
  });

  test("the research-use warning still precedes the content", async ({ page }) => {
    await gotoScreen(page, "/");

    const noticeBox = await page.getByTestId("research-notice").boundingBox();
    const mainBox = await page.locator("main").boundingBox();
    expect(noticeBox!.y).toBeLessThan(mainBox!.y);

    await expectNoLeakedPlaceholders(page);
  });
});
