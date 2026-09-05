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
