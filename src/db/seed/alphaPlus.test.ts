import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Actor } from "@/domain/types";

import { createTestDb, type TestDb } from "@/db/test-utils";
import { createServices, type Services } from "@/services/container";

import { seedAlphaPlus } from "./alphaPlus";

const admin: Actor = { userId: "00000000-0000-4000-8000-000000000001", role: "admin" };

/**
 * 시드가 관통 1 축약 픽스처(2차구현_계획 §5)를 실제 서비스로 끝까지 만들고, 재실행에 안전한지.
 */
describe("seedAlphaPlus — 관통 1 축약 시드 (PGlite)", () => {
  let t: TestDb;
  let services: Services;

  beforeAll(async () => {
    t = await createTestDb();
    services = createServices(t.db);
  });
  afterAll(async () => {
    await t.close();
  });

  it("첫 호출 — 생성하고, 조립 미리보기가 complete=true", async () => {
    const r = await seedAlphaPlus(services, admin);
    expect(r.created).toBe(true);

    const preview = await services.assembly.preview(r.productId);
    if (!preview.ok) throw new Error(JSON.stringify(preview.rejection));
    expect(preview.value.issues).toEqual([]);
    expect(preview.value.complete).toBe(true);
    expect(preview.value.specials[0].docs.map((d) => d.title)).toEqual(["일반상해사망 특별약관", "일반상해사망 추가 특별약관"]);
    expect(preview.value.appendices.map((a) => a.code)).toEqual(["APX_DISABILITY"]);

    const planTypes = (await services.catalog.list()).filter((d) => d.kind === "struct" && d.level === "plan");
    expect(planTypes.map((d) => d.label)).toEqual(["납입면제", "무저해지", "계약전환", "영위업종적용"]);
    expect(planTypes).toMatchObject([
      { fields: [{ label: "적용여부", type: { kind: "boolean" } }, { label: "납입면제사유", type: { kind: "list<enum>", enumCode: "E0002" } }] },
      { fields: [{ label: "유형", type: { kind: "enum", enumCode: "E0003" } }] },
      { fields: [{ label: "전환여부", type: { kind: "boolean" } }] },
      { fields: [{ label: "적용여부", type: { kind: "boolean" } }] },
    ]);
    expect((await services.catalog.getEnum("E0002"))?.values.map((v) => v.label)).toEqual(["질병", "상해"]);
    expect((await services.catalog.getEnum("E0003"))?.values.map((v) => v.label)).toEqual([
      "해약환급금지급형",
      "해약환급금미지급형",
      "해약환급금미지급형(납입후50%)",
    ]);
  });

  it("두 번째 호출 — no-op (상품명으로 이미 있음을 판단), 상품 id 동일 · 여전히 complete=true", async () => {
    const first = await seedAlphaPlus(services, admin);
    const second = await seedAlphaPlus(services, admin);
    expect(second.created).toBe(false);
    expect(second.productId).toBe(first.productId);

    const preview = await services.assembly.preview(second.productId);
    if (!preview.ok) throw new Error(JSON.stringify(preview.rejection));
    expect(preview.value.complete).toBe(true);

    // 상품이 하나만 있어야 한다 — no-op 이 중복 생성하지 않았음을 확인
    const products = await services.product.listProducts();
    expect(products.filter((p) => p.name === "알파Plus(축약)")).toHaveLength(1);
  });
});
