import { expect, test } from "@playwright/test";

test.describe("live parking-radar dashboard", () => {
  test("paints current data, remembers selection, and exposes internal backup controls", async ({ page, context }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveTitle(/parking-radar/i);
    await expect(page.getByRole("combobox", { name: "공항 선택" })).toBeVisible();
    await expect(page.locator('[data-testid="desktop-lot-table"], [data-testid="mobile-lot-grid"]').first()).toBeVisible({
      timeout: 20_000,
    });

    const airportSelect = page.getByRole("combobox", { name: "공항 선택" });
    await expect.poll(() => airportSelect.locator("option").count(), { timeout: 20_000 }).toBeGreaterThan(0);
    const airportOptions = await airportSelect.locator("option").allTextContents();
    expect(airportOptions.length).toBeGreaterThan(0);
    if (airportOptions.length > 1) {
      await airportSelect.selectOption({ index: 1 });
      await expect.poll(async () => (await context.cookies()).some((cookie) => cookie.name === "parking-radar-selection")).toBe(true);
    }

    await page.getByRole("button", { name: /백업 \/ 복원/ }).click();
    await expect(page.getByText(/별도 인증 없이 제공되는 운영 도구/)).toBeVisible();
    await expect(page.getByRole("button", { name: "새 백업 만들기" })).toBeVisible();
  });

  for (const width of [320, 375, 414, 768]) {
    test(`does not create page overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("combobox", { name: "공항 선택" })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    });
  }
});
