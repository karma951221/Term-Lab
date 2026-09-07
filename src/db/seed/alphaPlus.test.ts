import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Actor } from "@/domain/types";

import { createTestDb, type TestDb } from "@/db/test-utils";
import { createServices, type Services } from "@/services/container";

import { ALPHA_PLUS_PRODUCT_NAME, seedAlphaPlus } from "./alphaPlus";

const admin: Actor = { userId: "00000000-0000-4000-8000-000000000001", role: "admin" };

/**
 * 시드가 실물 알파Plus 재료(카탈로그 · 담보 4 · 상품 · 별표 21 · 탑재 5)를 실제 서비스로 끝까지 만들고, 재실행에 안전한지.
 * 원문과의 대조는 `real.test.ts` 몫.
 */
describe("seedAlphaPlus — 알파Plus 실물 시드 (PGlite)", () => {
  let t: TestDb;
  let services: Services;

  beforeAll(async () => {
    t = await createTestDb();
    services = createServices(t.db);
  });
  afterAll(async () => {
    await t.close();
  });

  it("첫 호출 — 생성하고, 조립 미리보기가 complete=true · 특약 4벌 · 별표 21건", async () => {
    const r = await seedAlphaPlus(services, admin);
    expect(r.created).toBe(true);

    const preview = await services.assembly.preview(r.productId);
    if (!preview.ok) throw new Error(JSON.stringify(preview.rejection));
    expect(preview.value.issues).toEqual([]);
    expect(preview.value.complete).toBe(true);
    expect(preview.value.specials[0].docs.map((d) => d.title)).toEqual([
      "골절(치아파절 제외)진단비Ⅱ보장 특별약관",
      "일반상해80%이상후유장해 생활자금보장 특별약관",
      "일반상해사망보장 특별약관",
      "일반상해사망보장 추가 특별약관",
    ]);
    expect(preview.value.appendices).toHaveLength(21);
    expect(preview.value.appendices[1]).toMatchObject({ code: "APX02_DISABILITY", number: 2, name: "장해분류표" });
    expect(preview.value.baseContracts.map((b) => b.name)).toEqual(["일반상해80%이상후유장해"]);

    const defs = await services.catalog.list();
    expect(defs.find((d) => d.code === "D0001")).toMatchObject({ kind: "scalar", label: "담보명", level: "coverage", type: { kind: "string" } });
    const planTypes = defs.filter((d) => d.kind === "struct" && d.level === "plan");
    expect(planTypes.map((d) => d.label)).toEqual(["납입면제", "무저해지", "계약전환", "영위업종적용"]);
    expect((await services.catalog.getEnum("E0001"))?.values.map((v) => v.label)).toEqual(["질병", "상해"]);
    expect((await services.catalog.getEnum("E0002"))?.values.map((v) => v.label)).toEqual(["해약환급금지급형", "해약환급금미지급형", "해약환급금미지급형(납입후50%)"]);

    const options = await services.product.listPlanOptions(r.productId);
    expect(options.map((option) => [option.axis, option.number, option.name, option.planTypeCode])).toEqual([
      ["type", 1, "보험료 납입면제 미적용형", "D0002"],
      ["type", 2, "보험료 납입면제형", "D0002"],
    ]);
    expect(await services.product.listPlans(r.productId)).toHaveLength(2);
    expect(Object.fromEntries(await services.product.getPlanOptionValues(options[1].id))).toEqual({ "D0002.F01": { entered: true, value: true }, "D0002.F02": { entered: true, value: ["V01", "V02"] } });
  });

  it("두 번째 호출 — no-op (상품명으로 이미 있음을 판단), 상품 id 동일 · 여전히 complete=true", async () => {
    const first = await seedAlphaPlus(services, admin);
    const second = await seedAlphaPlus(services, admin);
    expect(second.created).toBe(false);
    expect(second.productId).toBe(first.productId);

    const preview = await services.assembly.preview(second.productId);
    if (!preview.ok) throw new Error(JSON.stringify(preview.rejection));
    expect(preview.value.complete).toBe(true);

    const products = await services.product.listProducts();
    expect(products.filter((p) => p.name === ALPHA_PLUS_PRODUCT_NAME)).toHaveLength(1);
  });
});
