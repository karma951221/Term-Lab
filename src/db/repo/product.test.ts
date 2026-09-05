import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "../test-utils";
import * as repo from "./product";

describe("product repo (PGlite) — 스키마 · 채번 · 매핑", () => {
  let t: TestDb;
  const who = "00000000-0000-4000-8000-000000000001";
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.close();
  });

  it("담보속성 코드 순번은 카탈로그와 같은 시퀀스 테이블을 kind attribute / attributeValue 로 공유한다", async () => {
    expect(await repo.nextAttributeSeq(t.db, "attribute", "")).toBe(1);
    expect(await repo.nextAttributeSeq(t.db, "attribute", "")).toBe(2);
    expect(await repo.nextAttributeSeq(t.db, "attributeValue", "A0001")).toBe(1);
    expect(await repo.nextAttributeSeq(t.db, "attributeValue", "A0002")).toBe(1);
  });

  it("담보속성 종류 + 유효값(작명 규칙) 저장 → 도메인 객체로 읽힌다 (order 순)", async () => {
    await repo.insertAttributeKind(t.db, { code: "A0001", label: "갱신유형", order: 0, values: [] }, who);
    await repo.saveAttributeKind(
      t.db,
      {
        code: "A0001",
        label: "갱신유형",
        order: 0,
        values: [
          { code: "V02", label: "갱신형", order: 0, naming: { prefix: "갱신형" } },
          { code: "V01", label: "비갱신형", order: 1, naming: {} },
        ],
      },
      who,
    );
    const kinds = await repo.listAttributeKinds(t.db);
    expect(kinds).toEqual([
      {
        code: "A0001",
        label: "갱신유형",
        order: 0,
        values: [
          { code: "V02", label: "갱신형", order: 0, naming: { prefix: "갱신형" } },
          { code: "V01", label: "비갱신형", order: 1, naming: {} },
        ],
      },
    ]);
    // 값 삭제 반영
    await repo.saveAttributeKind(t.db, { ...kinds[0], values: [kinds[0].values[0]] }, who);
    expect((await repo.loadAttributeKind(t.db, "A0001"))?.values.map((v) => v.code)).toEqual(["V02"]);
  });

  it("상품 · 상품담보(조합 · 스냅샷 노드) 저장과 조회", async () => {
    const product = await repo.insertProduct(t.db, { name: "알파Plus(축약)" }, who);
    expect(product.id).toMatch(/[0-9a-f-]{36}/);
    const cov = "11111111-1111-4111-8111-111111111111";
    const pc = await repo.insertProductCoverage(
      t.db,
      { productId: product.id, coverageId: cov, coverageName: "일반상해사망", name: "일반상해사망 추가", attributes: [{ kindCode: "A0001", valueCode: "V02" }], combinationKey: `${cov}|A0001=V02` },
      who,
    );
    const sub = await repo.insertNode(t.db, { productCoverageId: pc.id, kind: "sub", masterNodeId: "22222222-2222-4222-8222-222222222222", name: "세부보장", order: 0 }, who);
    await repo.insertNode(t.db, { productCoverageId: pc.id, kind: "benefit", masterNodeId: "33333333-3333-4333-8333-333333333333", parentId: sub.id, name: "급부", order: 0 }, who);
    const loaded = await repo.loadProductCoverage(t.db, pc.id);
    expect(loaded).toEqual({ id: pc.id, productId: product.id, coverageId: cov, name: "일반상해사망 추가", attributes: [{ kindCode: "A0001", valueCode: "V02" }] });
    const nodes = await repo.listNodes(t.db, pc.id);
    expect(nodes.map((n) => [n.kind, n.name, n.parentId === sub.id])).toEqual([
      ["sub", "세부보장", false],
      ["benefit", "급부", true],
    ]);
  });
});
