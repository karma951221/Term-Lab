import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { codeSequences, users } from "./schema";
import { createTestDb, type TestDb } from "./test-utils";

describe("createTestDb — 인메모리 PGlite + pushSchema", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.close();
  });

  it("스키마가 적용된 빈 DB 를 돌려준다 — users 에 넣고 읽을 수 있다", async () => {
    await t.db.insert(users).values({ name: "admin", role: "admin" });
    const rows = await t.db.select().from(users);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("admin");
    expect(rows[0].id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("복합 PK 테이블(code_sequences)도 만들어진다", async () => {
    await t.db.insert(codeSequences).values({ kind: "discriminator", scope: "" });
    const rows = await t.db.select().from(codeSequences);
    expect(rows[0].next).toBe(1);
  });

  it("호출할 때마다 서로 독립인 DB 다", async () => {
    const other = await createTestDb();
    try {
      expect(await other.db.select().from(users)).toHaveLength(0);
    } finally {
      await other.close();
    }
  });
});
