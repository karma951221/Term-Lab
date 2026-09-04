/**
 * 저장소 공통 타입.
 *
 * `Db` 는 드라이버(PGlite · node-postgres)에 얽매이지 않는 drizzle Postgres 핸들이다.
 * `db.transaction(async (tx) => …)` 의 tx 도 같은 타입이라 repo 함수는 둘 다 받는다.
 */
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import type * as schema from "../schema";

export type Schema = typeof schema;

export type Db = PgDatabase<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;
