import { expect, test } from "@playwright/test";

test("홈 페이지가 렌더된다", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "terms-studio" })).toBeVisible();
});

test("헬스체크가 DB 왕복에 성공한다", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.ok()).toBe(true);
  const body = await response.json();
  expect(body.status).toBe("ok");
});
