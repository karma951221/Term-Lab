/**
 * 시드 스크립트 — `npm run db:seed`.
 *
 * 아직 시드할 테이블이 없다. P1 에서 카탈로그(구분자·enum·구조체) 기본값부터 채운다.
 */
import { getDb, PGLITE_DATA_DIR, resolveDriver } from "../client";

async function seed() {
  const driver = resolveDriver();
  console.log(`[seed] driver=${driver}`);
  if (driver === "pglite") {
    console.log(`[seed] dataDir=${PGLITE_DATA_DIR}`);
  }

  getDb();

  // TODO(P1): 카탈로그 기본 데이터 삽입.
  console.log("[seed] 시드할 데이터가 아직 없습니다. (no-op)");
}

seed()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[seed] 실패:", error);
    process.exit(1);
  });
