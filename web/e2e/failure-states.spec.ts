import { expect, test } from "@playwright/test";
import { CASE_MISSING, gotoScreen } from "./helpers";

/**
 * J8 — the states a researcher actually hits when something is wrong.
 *
 * These are driven by intercepting the API rather than by killing the server,
 * so the suite can exercise a 500, a 404 and a dropped connection from one
 * machine. The copy asserted here is the copy in lib/store.tsx; if it changes,
 * the tests should fail, because that wording is what tells a researcher
 * whether to re-run the pipeline or restart the server.
 */
test.describe("Failure states", () => {
  test("an unreachable API says so and offers a retry that recovers", async ({ page }) => {
    await page.route("**/api/report*", (route) => route.abort());

    await page.goto("/");

    const alert = page.getByTestId("load-error");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("The audit package could not be loaded");
    await expect(alert).toContainText(
      "The evidence API could not be reached. Is `neurolens serve` running?",
    );

    // Nothing else renders in place of the evidence.
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(0);

    // Restore the API and confirm the retry button actually re-fetches.
    await page.unroute("**/api/report*");
    await page.getByTestId("load-error-retry").click();

    await expect(alert).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("no completed run is distinguished from a server that is down", async ({ page }) => {
    await page.route("**/api/report*", (route) =>
      route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ detail: "no completed run" }),
      }),
    );

    await page.goto("/");

    const alert = page.getByTestId("load-error");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("No completed run was found.");
    await expect(alert).toContainText("neurolens run");
  });

  test("a server error reports its status rather than a generic failure", async ({ page }) => {
    await page.route("**/api/report*", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ detail: "run directory is locked" }),
      }),
    );

    await page.goto("/");

    const alert = page.getByTestId("load-error");
    await expect(alert).toContainText("503");
    await expect(alert).toContainText("run directory is locked");
  });

  test("a failing case query shows an inline error without blanking the screen", async ({
    page,
  }) => {
    await gotoScreen(page, "/cases");
    await expect(page.getByTestId("case-count")).toContainText("held-out cases");

    await page.route("**/api/cases**", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ detail: "index unavailable" }),
      }),
    );

    await page.getByTestId("case-search").fill("sub-1");

    const callout = page.getByTestId("cases-error");
    await expect(callout).toBeVisible();
    await expect(callout).toContainText("Cases could not be loaded");

    // The rest of the screen stays usable — the report is a separate fetch.
    await expect(page.getByRole("heading", { level: 1, name: "Cases" })).toBeVisible();
  });

  test("an unknown patient id is a not-found state, not a crash", async ({ page }) => {
    await page.goto(`/cases/${CASE_MISSING}`);
    await expect(page.getByText("Case not found")).toBeVisible();
  });
});
