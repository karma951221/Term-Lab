import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Db } from "@/db/repo/types";
import { createTestDb, type TestDb } from "@/db/test-utils";
import { contextualDb } from "./txContext";

/** 프록시로 센다 — tx 안이면 tx, 밖이면 root 로 간다. */
async function count(db: Db): Promise<number> {
  const r = (await db.execute(sql`select count(*)::int as n from probe`)) as unknown as { rows: { n: number }[] };
  return r.rows[0].n;
}

describe("contextualDb — 트랜잭션 안에서 주입 소스가 같은 tx 를 타게 한다 (PGlite 단일 연결 교착 회피)", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
    await t.db.execute(sql`create table probe (n int)`);
  });
  afterAll(async () => {
    await t.close();
  });

  it("바깥 핸들 대신 프록시로 쿼리하면 tx 안에서 교착 없이 같은 트랜잭션의 미커밋 데이터가 보인다", async () => {
    const db = contextualDb(t.db);
    const seenInside = await db.transaction(async (tx) => {
      await tx.execute(sql`insert into probe values (1)`);
      // 주입 소스가 하듯 tx 를 모르는 채 프록시로 읽는다
      return await count(db);
    });
    expect(seenInside).toBe(1);
  });

  it("tx 밖에서는 root 로 간다 · 롤백된 tx 의 쓰기는 남지 않는다", async () => {
    const db = contextualDb(t.db);
    await expect(
      db.transaction(async () => {
        await db.execute(sql`insert into probe values (2)`); // 프록시 → 현재 tx
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await count(db)).toBe(1);
  });

  it("tx 안에서 다시 transaction 을 열면 세이브포인트(중첩)로 같은 연결을 쓴다", async () => {
    const db = contextualDb(t.db);
    const n = await db.transaction(async () => {
      await db.transaction(async (inner) => {
        await inner.execute(sql`insert into probe values (3)`);
      });
      return await count(db);
    });
    expect(n).toBe(2);
  });
});
