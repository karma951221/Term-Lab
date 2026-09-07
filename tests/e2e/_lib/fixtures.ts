/**
 * E2E 의 `test` — `@playwright/test` 대신 여기서 가져온다.
 *
 * `ev` fixture 가 테스트마다 증거를 모으고, 실패하면 스크린샷 두 장(실패한 액션 직전 ·
 * 실패 순간)과 타임라인을 attachment 로 남긴다. 리포터가 그걸 읽어 FAILURE.md 를 만든다.
 */
import { test as base, expect } from "@playwright/test";

import { Evidence } from "./evidence";

export const test = base.extend<{ ev: Evidence }>({
  ev: async ({ page }, use, testInfo) => {
    const coordinate = testInfo.annotations.find((a) => a.type === "시나리오")?.description ?? null;
    const ev = new Evidence(page, coordinate);

    await use(ev);

    // `ev` 가 `page` 에 의존하므로 이 teardown 은 page 가 닫히기 전에 돈다.
    await testInfo.attach("evidence", { body: JSON.stringify(ev.dump(), null, 2), contentType: "application/json" });
    if (testInfo.status === testInfo.expectedStatus) return;

    const before = ev.lastScreenshot();
    if (before) await testInfo.attach("before.png", { body: before, contentType: "image/png" });
    try {
      await testInfo.attach("at-failure.png", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    } catch {
      // 페이지가 이미 죽었으면 못 찍는다 — before.png 와 타임라인은 남는다.
    }
  },
});

export { expect };
