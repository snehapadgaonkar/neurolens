import { expect, test } from "@playwright/test";
import { gotoScreen, readRunInfo } from "./helpers";

/**
 * J9 — the release screen's artifacts must actually download.
 *
 * A link that renders but 404s is the exact failure a reviewer hits when they
 * try to quote the run, so each artifact is fetched and its content type
 * checked rather than merely being present in the DOM.
 */
test.describe("Release artifacts", () => {
  test("model card and full report links resolve with the right content type", async ({
    page,
  }) => {
    const info = await readRunInfo(page);
    await gotoScreen(page, "/release");

    const expected: Array<[string, RegExp, string]> = [
      ["model_card.md", /text\/markdown/, "Model card"],
      ["audit_report.html", /text\/html/, "Full report"],
    ];

    for (const [name, contentType, label] of expected) {
      const button = page.getByRole("link", { name: label });
      await expect(button, `${label} link must be present`).toBeVisible();

      const href = await button.getAttribute("href");
      expect(href, `${label} must have an href`).toBeTruthy();
      expect(href, `${label} must point at the artifact route`).toContain(
        `/api/artifact/${name}`,
      );
      expect(href, `${label} must be scoped to the active run`).toContain(
        `run=${encodeURIComponent(info.runId)}`,
      );

      const response = await page.request.get(href!);
      expect(response.status(), `${name} must download`).toBe(200);
      expect(response.headers()["content-type"], `${name} content type`).toMatch(
        contentType,
      );
      // Served as a download, not rendered inline — it is an evidence artifact.
      expect(response.headers()["content-disposition"]).toContain("attachment");
      expect((await response.body()).length, `${name} must not be empty`).toBeGreaterThan(
        0,
      );
    }
  });

  test("the audit report JSON is downloadable and parses", async ({ page }) => {
    const info = await readRunInfo(page);
    await gotoScreen(page, "/release");

    const response = await page.request.get(
      `/api/artifact/audit_report.json?run=${encodeURIComponent(info.runId)}`,
    );
    expect(response.status()).toBe(200);

    const report = await response.json();
    expect(report.manifest.run_id).toBe(info.runId);
  });

  test("release readiness is stated, with blockers when it is not ready", async ({ page }) => {
    await gotoScreen(page, "/release");

    const main = page.locator("main");
    // Exactly one of the two verdicts is shown.
    const ready = await main.getByText("RELEASE READY").count();
    const blocked = await main.getByText("BLOCKED").count();
    expect(ready + blocked, "one readiness verdict must be shown").toBe(1);
  });
});
