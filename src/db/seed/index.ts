/**
 * 시드 스크립트 — `npm run db:seed`.
 *
 * 1. 마이그레이션 적용 (`drizzle/` 의 SQL 을 `.data/pgdata`, 또는 `PGLITE_DATA_DIR` 로 지정한 파일 DB 에).
 *    PGlite 드라이버가 아니면(향후 프로덕션 pg) 건너뛴다 — drizzle-kit migrate CLI 몫.
 * 2. `ensureSeedAdmin()` 으로 관리자 확보 → 그 actor 로 관통 1 축약 시드(`seedAlphaPlus`) 실행.
 *
 * 몇 번을 돌려도 안전하다 — 마이그레이션은 drizzle 자체가 적용 이력으로 건너뛰고,
 * 시드는 상품명으로 이미 있음을 판단해 건너뛴다.
 */
import path from "node:path";

import { migrate } from "drizzle-orm/pglite/migrator";

import type { Actor } from "@/domain/types";

import { getDb, PGLITE_DATA_DIR, resolveDriver } from "@/db/client";
import { createServices } from "@/services/container";

import { seedAlphaPlus } from "./alphaPlus";

async function seed() {
  const driver = resolveDriver();
  console.log(`[seed] driver=${driver}`);

  if (driver === "pglite") {
    console.log(`[seed] dataDir=${PGLITE_DATA_DIR}`);
    console.log("[seed] 마이그레이션 적용 중...");
    await migrate(getDb(), { migrationsFolder: path.join(process.cwd(), "drizzle") });
    console.log("[seed] 마이그레이션 적용 완료");
  }

  const db = getDb();
  const services = createServices(db);

  const admin = await services.auth.ensureSeedAdmin();
  const actor: Actor = { userId: admin.id, role: admin.role };
  console.log(`[seed] 관리자 확보: ${admin.name} (${admin.id})`);

  const result = await seedAlphaPlus(services, actor);
  console.log(`[seed] 관통 1 축약 시드 ${result.created ? "생성" : "이미 있음(건너뜀)"} — 상품 ${result.productId}`);
}

seed()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[seed] 실패:", error);
    process.exit(1);
  });
