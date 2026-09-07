import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 3000);
// Next dev 서버의 기본 오리진과 맞춰야 cross-origin 경고가 뜨지 않는다 (127.0.0.1 아님).
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

/**
 * E2E: tests/e2e/**.
 *
 * 매 실행이 golden 스냅샷을 복사한 새 DB 에서 시작한다 (`scripts/e2e/prepare-db.ts`).
 * PGlite 인스턴스는 dev 서버 프로세스에 캐시되므로 DB 를 갈아끼우려면 서버를 새로 띄워야 하고,
 * 그래서 `reuseExistingServer` 를 끈다. 복사 → 기동 순서는 `&&` 로 못박는다
 * (globalSetup 과 webServer 의 순서는 보장되지 않는다).
 * 근거: docs/superpowers/specs/2026-09-08-e2e-관측복구-design.md
 */
export default defineConfig({
  testDir: "./tests/e2e",
  // 한 DB 를 공유하므로 병렬로 돌리면 결정론이 깨진다.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["./tests/e2e/_lib/reporter.ts"]],
  use: {
    baseURL: BASE_URL,
    // 기존 "on-first-retry" 는 로컬 retries:0 이라 영원히 안 찍혔다.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // 사전 설치된 브라우저를 그대로 쓰는 환경(원격 실행 등)을 위해 경로를 넘길 수 있게 한다.
    ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `npx tsx scripts/e2e/prepare-db.ts && npx tsx scripts/e2e/dev-with-log.ts --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 180_000,
    env: { PGLITE_DATA_DIR: path.join(process.cwd(), ".data", "e2e-run") },
  },
});
