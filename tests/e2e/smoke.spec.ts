import { expect, test } from "@playwright/test";

/**
 * 스모크 — 화면이 깨졌나만 본다 (ADR-0009 소수 정예). 조립이 맞나는 Vitest 스냅샷 몫.
 * 전제: `npm run db:seed` 로 관통 1 축약 시드가 들어간 개발 DB.
 */

test("헬스체크가 DB 왕복에 성공한다", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.ok()).toBe(true);
  const body = await response.json();
  expect(body.status).toBe("ok");
});

test("로그인 없이 앱에 들어가면 /login 으로 보낸다", async ({ page }) => {
  await page.goto("/catalog");
  await expect(page).toHaveURL(/\/login/);
});

test("관통 1: 로그인 → 상품 → 조립 미리보기가 완성본으로 렌더된다", async ({ page }) => {
  await page.goto("/login");
  // 시드 admin 으로 로그인 (이름 선택 최소형)
  const submit = page.getByRole("button", { name: /admin/ });
  await expect(submit).toBeVisible();
  await submit.click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));

  await page.goto("/products");
  const product = page.getByRole("link", { name: /알파Plus\(축약\)/ });
  await expect(product).toBeVisible();
  await product.click();

  await page.getByRole("link", { name: /조립 미리보기/ }).first().click();
  await expect(page).toHaveURL(/\/products\/.+\/preview/);
  // 보통약관 + 특약 2벌(기본·추가) + 별표 1건, 오류 없음
  await expect(page.getByRole("heading", { name: /알파Plus 보통약관/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^일반상해사망 특별약관/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /일반상해사망 추가 특별약관/ })).toBeVisible();
  await expect(page.getByText(/완성본 아님/)).toHaveCount(0);
});
