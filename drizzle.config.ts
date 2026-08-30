import { defineConfig } from "drizzle-kit";

/**
 * 개발 DB 는 PGlite(.data/pgdata). 프로덕션 Postgres 배선은 나중에.
 * `npm run db:generate` → drizzle/ 에 마이그레이션 SQL 생성
 * `npm run db:migrate`  → .data/pgdata 에 적용
 */
export default defineConfig({
  dialect: "postgresql",
  driver: "pglite",
  schema: "./src/db/schema",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.PGLITE_DATA_DIR ?? "./.data/pgdata",
  },
  verbose: true,
  strict: true,
});
