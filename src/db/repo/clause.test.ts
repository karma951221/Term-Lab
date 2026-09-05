import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Clause } from "@/domain/clause";

import { createTestDb, type TestDb } from "../test-utils";
import { clauseAudit, clauseSeqSource, deleteClause, insertClause, listClauses, loadClause, nextClauseSeq, saveClause } from "./clause";

const who = "00000000-0000-4000-8000-000000000001";

const 소멸: Clause = {
  code: "C0001",
  label: "특별약관의 소멸",
  mode: "block",
  description: "",
  body: [{ id: "p1", kind: "paragraph", children: [{ id: "t1", kind: "text", text: "소멸합니다." }] }],
  options: [
    { code: "O01", label: "사유", order: 0, values: [
      { code: "V01", label: "사망형", order: 0, body: [] },
      { code: "V02", label: "일반형", order: 1, body: [{ id: "v2", kind: "slot", ref: "D0002" }] },
    ] },
  ],
  required: { discriminators: ["D0002"], attributes: [] },
};

describe("clauses repo (PGlite)", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.close();
  });

  it("채번 순번은 카탈로그와 같은 code_sequences 를 쓰되 kind 가 다르다 — 1 부터, scope 별", async () => {
    expect(await nextClauseSeq(t.db, "clause", "")).toBe(1);
    expect(await nextClauseSeq(t.db, "clause", "")).toBe(2);
    expect(await nextClauseSeq(t.db, "option", "C0001")).toBe(1);
    expect(await nextClauseSeq(t.db, "optionValue", "C0001/O01")).toBe(1);
    expect(await nextClauseSeq(t.db, "option", "C0002")).toBe(1);
    const seq = clauseSeqSource(t.db);
    expect(await seq("clause", "")).toBe(3);
  });

  it("insert → load 가 도메인 객체를 그대로 돌려준다 (본문·옵션·요구 구분자 포함)", async () => {
    await insertClause(t.db, 소멸, who);
    expect(await loadClause(t.db, "C0001")).toEqual(소멸);
    expect(await loadClause(t.db, "C9999")).toBeUndefined();
    const audit = await clauseAudit(t.db, "C0001");
    expect(audit?.createdBy).toBe(who);
  });

  it("save 는 코드 그대로 덮어쓴다 — 표시명·본문·옵션·요구 구분자", async () => {
    const changed: Clause = { ...소멸, label: "소멸", mode: "inline", body: [{ id: "t", kind: "text", text: "x" }], options: [], required: { discriminators: [], attributes: ["A0001"] } };
    await saveClause(t.db, changed, "00000000-0000-4000-8000-000000000002");
    expect(await loadClause(t.db, "C0001")).toEqual(changed);
    expect((await clauseAudit(t.db, "C0001"))?.updatedBy).toBe("00000000-0000-4000-8000-000000000002");
    await expect(saveClause(t.db, { ...changed, code: "C9999" }, who)).rejects.toThrow();
  });

  it("list 는 코드 순", async () => {
    await insertClause(t.db, { ...소멸, code: "C0003", label: "c" }, who);
    await insertClause(t.db, { ...소멸, code: "C0002", label: "b" }, who);
    expect((await listClauses(t.db)).map((c) => c.code)).toEqual(["C0001", "C0002", "C0003"]);
  });

  it("delete", async () => {
    await deleteClause(t.db, "C0003");
    expect(await loadClause(t.db, "C0003")).toBeUndefined();
  });
});
