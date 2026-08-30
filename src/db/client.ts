/**
 * DB 클라이언트 — 개발(PGlite) ↔ 프로덕션(node-postgres) 스위치.
 *
 * 개발: `@electric-sql/pglite` 임베디드 Postgres. 데이터는 `.data/pgdata` 에 파일로 저장.
 * 프로덕션: `pg` + Postgres (Vercel 배포 시점에 배선 예정 — 지금은 미구현).
 *
 * 어느 쪽을 쓸지는 `DB_DRIVER` 환경변수로 명시할 수 있고,
 * 없으면 `NODE_ENV` 로 결정한다 (production → pg, 그 외 → pglite).
 */
import fs from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";

import * as schema from "./schema";

export type DbDriver = "pglite" | "pg";

export function resolveDriver(): DbDriver {
  const explicit = process.env.DB_DRIVER;
  if (explicit === "pglite" || explicit === "pg") return explicit;
  return process.env.NODE_ENV === "production" ? "pg" : "pglite";
}

/** PGlite 데이터 디렉토리. 리포에 커밋하지 않는다(.gitignore). */
export const PGLITE_DATA_DIR =
  process.env.PGLITE_DATA_DIR ?? path.join(process.cwd(), ".data", "pgdata");

export type Database = ReturnType<typeof drizzlePglite<typeof schema>>;

/**
 * dev 서버의 HMR 로 모듈이 재평가돼도 PGlite 인스턴스가 중복 생성되지 않도록
 * globalThis 에 캐시한다.
 */
const globalCache = globalThis as typeof globalThis & {
  __termsStudioPglite?: PGlite;
  __termsStudioDb?: Database;
};

function createPgliteDb(): Database {
  // PGlite 의 nodefs 는 mkdir 을 recursive 로 하지 않는다. 부모 디렉토리를 먼저 만들어 준다.
  fs.mkdirSync(path.dirname(PGLITE_DATA_DIR), { recursive: true });

  const client =
    globalCache.__termsStudioPglite ??
    new PGlite({ dataDir: PGLITE_DATA_DIR });
  globalCache.__termsStudioPglite = client;
  return drizzlePglite(client, { schema });
}

function createPgDb(): Database {
  // TODO(P?): 프로덕션 배선. `pg` 설치 후 아래 형태로 교체.
  //   import { Pool } from "pg";
  //   import { drizzle } from "drizzle-orm/node-postgres";
  //   return drizzle(new Pool({ connectionString: process.env.DATABASE_URL }), { schema });
  throw new Error(
    "프로덕션 DB(pg) 드라이버는 아직 구현되지 않았습니다. 개발 중에는 DB_DRIVER=pglite 를 사용하세요.",
  );
}

/** 프로세스당 하나의 Drizzle 인스턴스를 돌려준다. */
export function getDb(): Database {
  if (globalCache.__termsStudioDb) return globalCache.__termsStudioDb;

  const db = resolveDriver() === "pg" ? createPgDb() : createPgliteDb();
  globalCache.__termsStudioDb = db;
  return db;
}

/** 원시 PGlite 핸들 (마이그레이션·시드 등 저수준 작업용). 개발 전용. */
export function getPgliteClient(): PGlite {
  if (resolveDriver() !== "pglite") {
    throw new Error("getPgliteClient() 는 PGlite 드라이버에서만 사용할 수 있습니다.");
  }
  getDb();
  return globalCache.__termsStudioPglite!;
}
