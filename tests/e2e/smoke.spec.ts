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
  // 대치된 보통약관 + 특약 2벌(기본·추가) + 별표 1건, 오류 없음
  await expect(page.getByRole("heading", { name: /알파Plus 보통약관/ })).toBeVisible();
  await expect(page.getByText("피보험자가 보험기간 중 상해로 사망한 경우 보험금을 지급합니다.")).toBeVisible();
  await expect(page.getByRole("heading", { name: /^일반상해사망 특별약관/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /일반상해사망 추가 특별약관/ })).toBeVisible();
  // 오류 패널 제목은 분모를 함께 갖는다 — 「오류 0 / 조 N」 (디자인원칙 §9.6)
  await expect(page.getByRole("heading", { name: /^오류 0 \/ 조 \d+$/ })).toBeVisible();
  await expect(page.getByText("오류 없음.")).toBeVisible();
  await expect(page.getByText(/완성본 아님/)).toHaveCount(0);
});

test("관계정보: 공용조항 이웃을 그리고 노드 링크로 조회 대상을 바꾼다", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: /admin/ }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));

  await page.goto("/relations?kind=clause&code=C0001");
  const graph = page.getByRole("img", { name: "조회 대상의 이웃 그래프" });
  await expect(graph).toBeVisible();

  const neighbor = graph.locator('a[data-graph-node^="article:"]').first();
  await expect(neighbor).toBeVisible();
  const neighborId = await neighbor.getAttribute("data-graph-node");
  await neighbor.click();

  await expect(page).toHaveURL((url) => url.searchParams.get("kind") === "article");
  await expect(page.locator(`[data-graph-node="${neighborId}"]`).first()).toBeVisible();
});
