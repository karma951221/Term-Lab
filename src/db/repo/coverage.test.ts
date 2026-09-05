import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addBenefit, addSubCoverage, createCoverageTree, removeSubCoverage, reorderSubCoverages } from "@/domain/coverage";
import type { Coverage } from "@/domain/coverage";

import { createTestDb, type TestDb } from "../test-utils";
import {
  coverageAudit,
  coverageIdOfNode,
  deleteCoverage,
  insertCoverage,
  listCoverageNames,
  listCoverages,
  loadCoverage,
  saveCoverage,
} from "./coverage";

const who = "00000000-0000-4000-8000-000000000001";
const newId = () => crypto.randomUUID();

function unwrap<T>(r: { ok: true; value: T } | { ok: false; rejection: unknown }): T {
  if (!r.ok) throw new Error(`기대: ok, 실제: ${JSON.stringify(r.rejection)}`);
  return r.value;
}

describe("coverage repo — 담보 · 세부보장 · 급부 (PGlite)", () => {
  let t: TestDb;
  let surgery: Coverage;

  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.close();
  });

  it("담보 트리를 통째로 저장하고 같은 모양으로 읽는다 (형제 순서 유지)", async () => {
    surgery = unwrap(createCoverageTree({ name: "수술비", subCoverageName: "1종수술", benefitName: "수술보험금", description: "수술 담보" }, newId, []));
    surgery = unwrap(addSubCoverage(surgery, { name: "2종수술", benefitName: "수술보험금" }, newId));
    surgery = unwrap(addBenefit(surgery, surgery.subCoverages[1].id, "입원보험금", newId));
    await insertCoverage(t.db, surgery, who);
    expect(await loadCoverage(t.db, surgery.id)).toEqual(surgery);
  });

  it("없는 id 는 undefined · 목록은 이름순 (D-P2-5) · 담보명 목록", async () => {
    expect(await loadCoverage(t.db, newId())).toBeUndefined();
    const accident = unwrap(createCoverageTree({ name: "일반상해사망" }, newId, []));
    await insertCoverage(t.db, accident, who);
    expect((await listCoverages(t.db)).map((c) => c.name)).toEqual(["수술비", "일반상해사망"]);
    expect(await listCoverageNames(t.db)).toEqual(["수술비", "일반상해사망"]);
  });

  it("저장은 upsert — 순서 변경·이름 변경·문서 연결이 반영되고, 트리에서 빠진 노드는 삭제된다 (급부는 FK cascade)", async () => {
    const [one, two] = surgery.subCoverages.map((s) => s.id);
    let next = unwrap(reorderSubCoverages(surgery, [two, one]));
    next = { ...next, name: "수술비특약", documentId: newId() };
    await saveCoverage(t.db, next, who);
    expect(await loadCoverage(t.db, surgery.id)).toEqual(next);

    const removed = unwrap(removeSubCoverage(next, one));
    await saveCoverage(t.db, removed, who);
    const loaded = await loadCoverage(t.db, surgery.id);
    expect(loaded).toEqual(removed);
    expect(loaded?.subCoverages.map((s) => s.name)).toEqual(["2종수술"]);
    surgery = removed;
  });

  it("노드가 속한 담보 id 를 찾는다 — 세부보장·급부 → 담보", async () => {
    const sub = surgery.subCoverages[0];
    expect(await coverageIdOfNode(t.db, { level: "coverage", id: surgery.id })).toBe(surgery.id);
    expect(await coverageIdOfNode(t.db, { level: "subCoverage", id: sub.id })).toBe(surgery.id);
    expect(await coverageIdOfNode(t.db, { level: "benefit", id: sub.benefits[1].id })).toBe(surgery.id);
    expect(await coverageIdOfNode(t.db, { level: "benefit", id: newId() })).toBeUndefined();
  });

  it("형제 이름 중복은 DB 제약으로도 막힌다 (도메인 검사의 뒷받침)", async () => {
    const dup = { ...surgery, subCoverages: [...surgery.subCoverages, { ...surgery.subCoverages[0], id: newId(), order: 9 }] };
    await expect(saveCoverage(t.db, dup, who)).rejects.toThrow();
  });

  it("감사 컬럼 — 만든 사람·고친 사람", async () => {
    const audit = await coverageAudit(t.db, surgery.id);
    expect(audit?.createdBy).toBe(who);
    expect(audit?.updatedBy).toBe(who);
  });

  it("담보 삭제는 하위 트리를 cascade 로 지운다", async () => {
    await deleteCoverage(t.db, surgery.id);
    expect(await loadCoverage(t.db, surgery.id)).toBeUndefined();
    expect(await coverageIdOfNode(t.db, { level: "subCoverage", id: surgery.subCoverages[0].id })).toBeUndefined();
  });
});
