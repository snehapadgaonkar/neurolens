import { expect, test } from "@playwright/test";
import { expectNoLeakedPlaceholders, SCREENS } from "./helpers";

/**
 * J2 — every screen in the left rail renders real data.
 *
 * Each route is a client component that returns `null` until the report fetch
 * resolves, so a broken field reference produces a 200 response with an empty
 * body rather than an error page. The assertions below are what distinguish
 * those two outcomes: the H1 exists, no error callout is showing, and no
 * `undefined`/`NaN` leaked into the text.
 */
test.describe("Navigation", () => {
  for (const screen of SCREENS) {
    test(`renders ${screen.path}`, async ({ page }) => {
      await page.goto(screen.path);

      await expect(
        page.getByRole("heading", { level: 1, name: screen.heading }),
      ).toBeVisible();

      // A failed report fetch replaces the whole main region with an alert.
      await expect(page.getByTestId("load-error")).toHaveCount(0);

      await expectNoLeakedPlaceholders(page);
    });
  }

  test("left rail reaches every screen and marks the active one", async ({ page }) => {
    await page.goto("/");

    const rail = page.getByRole("navigation", { name: "Workspace sections" });
    await expect(rail).toBeVisible();

    // DESIGN.md groups the rail into five sections; assert the grouping survives.
    for (const group of ["Workspace", "Build", "Evaluate", "Inspect", "Release"]) {
      await expect(rail).toContainText(group);
    }

    // Walk a few hops through the rail and confirm aria-current follows.
    await rail.getByRole("link", { name: "Fairness" }).click();
    await expect(page).toHaveURL(/\/fairness$/);
    await expect(rail.getByRole("link", { name: "Fairness" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await rail.getByRole("link", { name: "Cases" }).click();
    await expect(page).toHaveURL(/\/cases$/);
    await expect(rail.getByRole("link", { name: "Cases" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    // Only one link may claim to be current.
    await expect(rail.locator('[aria-current="page"]')).toHaveCount(1);
  });
});
