import { expect, test } from "@playwright/test";
import { expectNoLeakedPlaceholders, fmt, fmtCi, gotoScreen, readRunInfo } from "./helpers";

/**
 * J1 — Overview loads with a live run.
 *
 * This is the screen a researcher lands on, so it carries the two invariants
 * the PRD treats as non-negotiable: the research-use disclaimer is present and
 * never dismissible, and the headline metric is shown alongside its interval
 * rather than as a bare number.
 */
test.describe("Overview", () => {
  test("renders the headline result from the live run", async ({ page }) => {
    const info = await readRunInfo(page);
    await gotoScreen(page, "/");

    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "What this run shows, and how far to trust it",
      }),
    ).toBeVisible();

    // The headline MAE and its CI must both reach the DOM, formatted the way
    // lib/format.ts formats them.
    const main = page.locator("main");
    await expect(main).toContainText(fmt(info.mae));
    await expect(main).toContainText(fmtCi(info.maeCi));

    await expectNoLeakedPlaceholders(page);
  });

  test("shows the research-use notice before anything else, and it cannot be dismissed", async ({
    page,
  }) => {
    await gotoScreen(page, "/");

    const notice = page.getByTestId("research-notice");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(/research prototype/i);

    // DESIGN.md requires the warning to precede every other content block at
    // every width. Compare on-screen geometry rather than trusting DOM order,
    // because a fixed/absolute wrapper would break the visual order while
    // leaving the markup looking correct.
    const noticeBox = await notice.boundingBox();
    const mainBox = await page.locator("main").boundingBox();
    expect(noticeBox, "research notice must have layout").not.toBeNull();
    expect(mainBox, "main must have layout").not.toBeNull();
    expect(noticeBox!.y).toBeLessThan(mainBox!.y);

    // No dismiss control anywhere in the notice.
    await expect(notice.locator("button")).toHaveCount(0);
  });

  test("surfaces the release verdict and provenance for this run", async ({ page }) => {
    const info = await readRunInfo(page);
    await gotoScreen(page, "/");

    const provenance = page.locator("header").first();
    await expect(provenance).toContainText("Run");
    await expect(provenance).toContainText("Seed");
    await expect(provenance).toContainText("Config");

    // The run the UI is showing must be the run the API is serving.
    await expect(page.getByTestId("run-switcher")).toHaveValue(info.runId);
  });
});
