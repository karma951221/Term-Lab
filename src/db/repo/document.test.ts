import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { surgeryFixture } from "@/domain/document/fixture";

import { createTestDb, type TestDb } from "../test-utils";
import {
  deleteAppendix,
  deleteDocument,
  findByOwner,
  insertAppendix,
  insertDocument,
  listAppendices,
  listDocuments,
  loadAppendix,
  loadDocument,
  saveAppendix,
  saveDocument,
} from "./document";

const who = "00000000-0000-4000-8000-000000000001";
const cov = "11111111-1111-4111-8111-111111111111";

describe("documents — 문서 1건 = 트리 jsonb 1건 (ADR-0012)", () => {
  let t: TestDb;
  const { special, general } = surgeryFixture();

  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.close();
  });

  it("보통약관·담보약관 행을 넣고 트리를 그대로 읽는다", async () => {
    const g = await insertDocument(t.db, { kind: "general", title: general.title, tree: general }, who);
    const s = await insertDocument(t.db, { kind: "special", ownerId: cov, title: special.title, tree: special, generalDocumentId: g.id }, who);
    expect((await loadDocument(t.db, s.id))?.tree).toEqual(special);
    const loadedG = (await loadDocument(t.db, g.id))!;
    expect(loadedG.kind).toBe("general");
    expect(loadedG.ownerId).toBeUndefined();
    expect(loadedG.generalDocumentId).toBeUndefined();
    expect((await findByOwner(t.db, cov))?.id).toBe(s.id);
  });

  it("담보 1 : 문서 1 — 같은 담보로 두 번 넣으면 DB 가 막는다", async () => {
    await expect(insertDocument(t.db, { kind: "special", ownerId: cov, title: "x", tree: special }, who)).rejects.toThrow();
  });

  it("목록은 종류별 · 제목순, 메타(종류·소유·제목·updated)만", async () => {
    const all = await listDocuments(t.db);
    expect(all.map((d) => d.kind)).toEqual(["general", "special"]);
    expect(all[0]).not.toHaveProperty("tree");
    expect((await listDocuments(t.db, "special")).map((d) => d.ownerId)).toEqual([cov]);
  });

  it("트리·제목·대응 보통약관을 갱신하고 updated_by 가 남는다 · 삭제", async () => {
    const s = (await findByOwner(t.db, cov))!;
    await saveDocument(t.db, s.id, { title: "수술비(개정)", tree: { ...special, title: "수술비(개정)" }, generalDocumentId: null }, who);
    const after = (await loadDocument(t.db, s.id))!;
    expect(after.title).toBe("수술비(개정)");
    expect(after.tree.title).toBe("수술비(개정)");
    expect(after.generalDocumentId).toBeUndefined();
    expect(after.updatedBy).toBe(who);
    await deleteDocument(t.db, s.id);
    expect(await loadDocument(t.db, s.id)).toBeUndefined();
  });
});

describe("appendices — 별표 마스터", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.close();
  });

  it("코드 유일 · 이름 수정 · 목록(코드순) · 삭제", async () => {
    await insertAppendix(t.db, { code: "APX_BURN", name: "화상 분류표", description: "" }, who);
    await insertAppendix(t.db, { code: "APX_A", name: "a", description: "d" }, who);
    await expect(insertAppendix(t.db, { code: "APX_A", name: "b", description: "" }, who)).rejects.toThrow();
    await saveAppendix(t.db, { code: "APX_A", name: "a2", description: "d2" }, who);
    expect(await loadAppendix(t.db, "APX_A")).toEqual({ code: "APX_A", name: "a2", description: "d2" });
    expect((await listAppendices(t.db)).map((a) => a.code)).toEqual(["APX_A", "APX_BURN"]);
    await deleteAppendix(t.db, "APX_A");
    expect(await loadAppendix(t.db, "APX_A")).toBeUndefined();
  });
});
