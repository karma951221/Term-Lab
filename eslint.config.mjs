import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  // 도메인 경계: src/domain/** 은 순수 도메인 로직만.
  // DB(drizzle/pglite/pg)·React·Next 를 import 하면 에러.
  {
    files: ["src/domain/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "drizzle-orm",
                "drizzle-orm/*",
                "@electric-sql/pglite",
                "@electric-sql/pglite/*",
                "pg",
                "pg/*",
                "react",
                "react/*",
                "react-dom",
                "react-dom/*",
                "next",
                "next/*",
                "@/db",
                "@/db/*",
                "@/components",
                "@/components/*",
                "@/forms",
                "@/forms/*",
                "@/app",
                "@/app/*",
              ],
              message:
                "src/domain 은 순수 도메인 로직입니다. DB·React·Next·UI 계층을 import 할 수 없습니다.",
            },
            {
              group: ["**/db/**", "**/components/**", "**/app/**"],
              message:
                "src/domain 은 순수 도메인 로직입니다. DB·UI 계층을 상대경로로도 import 할 수 없습니다.",
            },
          ],
        },
      ],
    },
  },

  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    ".data/**",
    "drizzle/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
