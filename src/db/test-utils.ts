/**
 * 테스트용 DB — 인메모리 PGlite + drizzle + `pushSchema` (drizzle-kit/api).
 *
 * 사용법 (테스트 파일마다 새 DB — 2차구현_계획 §1.4):
 *
 * ```ts
 * let db: TestDb;
 * beforeAll(async () => { db = await createTestDb(); });
 * afterAll(async () => { await db.close(); });
 * ```
 *
 * 마이그레이션 파일(drizzle/)에 의존하지 않는다 — 스키마 코드에서 바로 DDL 을 만든다.
 * 프로덕션 코드에서 import 하지 말 것.
 */
import { PGlite } from "@electric-sql/pglite";
import { pushSchema } from "drizzle-kit/api";
import { drizzle } from "drizzle-orm/pglite";

import * as schema from "./schema";

export type Database = ReturnType<typeof drizzle<typeof schema>>;

export interface TestDb {
  db: Database;
  client: PGlite;
  /** PGlite 인스턴스를 닫는다. afterAll 에서 호출. */
  close(): Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  // pushSchema 의 시그니처는 스키마 없는 PgDatabase<any> 로 선언돼 있어 캐스트가 필요하다.
  // 런타임은 같은 drizzle 인스턴스다.
  const { apply } = await pushSchema(schema, db as unknown as Parameters<typeof pushSchema>[1]);
  await apply();
  return {
    db,
    client,
    close: () => client.close(),
  };
}
