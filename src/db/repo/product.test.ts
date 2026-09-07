import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { productCoverages, productPlans } from "../schema";
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
          { code: "V02", label: "갱신형", order: 0, fragment: "갱신형" },
          { code: "V01", label: "비갱신형", order: 1, fragment: "" },
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
          { code: "V02", label: "갱신형", order: 0, fragment: "갱신형" },
          { code: "V01", label: "비갱신형", order: 1, fragment: "" },
        ],
      },
    ]);
    // 값 삭제 반영
    await repo.saveAttributeKind(t.db, { ...kinds[0], values: [kinds[0].values[0]] }, who);
    expect((await repo.loadAttributeKind(t.db, "A0001"))?.values.map((v) => v.code)).toEqual(["V02"]);
  });

  it("전역 명명 템플릿은 행이 없으면 [담보명]이고 수정값을 왕복한다", async () => {
    expect(await repo.loadNamingTemplate(t.db)).toBe("[담보명]");
    await repo.saveNamingTemplate(t.db, "[A0001] [담보명]", who);
    expect(await repo.loadNamingTemplate(t.db)).toBe("[A0001] [담보명]");
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

  it("세목 목록은 createdAt 이 같아도 조합 키 순으로 안정 정렬된다", async () => {
    const product = await repo.insertProduct(t.db, { name: "정렬 안정성 — 세목" }, who);
    const keys = ["K8", "K3", "K6", "K1", "K9", "K4", "K7", "K2"];
    const idOf = new Map<string, string>();
    for (const [i, key] of keys.entries()) {
      // 세목 하나는 축마다 선택지 하나 — 조합이 비면 insertPlan 이 빈 values() 로 실패한다.
      const option = await repo.insertPlanOption(t.db, product.id, { axis: "type", number: i + 1, name: `제${i + 1}종`, planTypeCode: "D0002" }, who);
      idOf.set(key, (await repo.insertPlan(t.db, product.id, key, [option.id], who)).id);
    }
    // createdAt 을 강제로 동률로 만든다 — PGlite 에서 실제로 82% 확률로 일어나는 상황이다.
    await t.db.update(productPlans).set({ createdAt: new Date("2026-09-08T00:00:00.000Z") }).where(eq(productPlans.productId, product.id));
    expect((await repo.listPlans(t.db, product.id)).map((p) => p.id)).toEqual([...keys].sort().map((k) => idOf.get(k)));
  });

  it("탑재 목록은 createdAt 이 같아도 조합 키 순으로 안정 정렬된다", async () => {
    const product = await repo.insertProduct(t.db, { name: "정렬 안정성 — 탑재" }, who);
    const order = [8, 3, 6, 1, 9, 4, 7, 2];
    for (const n of order) {
      await repo.insertProductCoverage(
        t.db,
        { productId: product.id, coverageId: "44444444-4444-4444-8444-444444444444", coverageName: `담보${n}`, name: `담보${n}`, combinationKey: `K${n}`, attributes: [] },
        who,
      );
    }
    await t.db.update(productCoverages).set({ createdAt: new Date("2026-09-08T00:00:00.000Z") }).where(eq(productCoverages.productId, product.id));
    expect((await repo.listProductCoverages(t.db, product.id)).map((c) => c.name)).toEqual([...order].sort().map((n) => `담보${n}`));
  });

});
