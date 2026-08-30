import path from "node:path";

import { defineConfig } from "vitest/config";

/**
 * 단위 테스트: src 안에 `*.test.ts` 로 colocate.
 * E2E(tests/e2e)는 Playwright 가 담당하므로 vitest 대상에서 제외한다.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules/**", ".next/**", "tests/e2e/**"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
