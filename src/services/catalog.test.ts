import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ImpactSource, ImpactTarget } from "@/domain/catalog";
import type { Actor } from "@/domain/types";

import { createTestDb, type TestDb } from "@/db/test-utils";
import { createCatalogService, type CatalogService } from "./catalog";

const admin: Actor = { userId: "00000000-0000-4000-8000-000000000001", role: "admin" };
const editor: Actor = { userId: "00000000-0000-4000-8000-000000000002", role: "editor" };

function unwrap<T>(r: { ok: true; value: T } | { ok: false; rejection: unknown }): T {
  if (!r.ok) throw new Error(`기대: ok, 실제: ${JSON.stringify(r.rejection)}`);
  return r.value;
}

/** 값 저장소 흉내 — 대상별 값 행 수를 미리 정해 두고, purge 호출을 기록한다. */
function fakeValueStore(counts: Record<string, number>) {
  const purged: ImpactTarget[] = [];
  const key = (t: ImpactTarget) => JSON.stringify(t);
  const source: ImpactSource = {
    countValueRows: async (t) => counts[key(t)] ?? 0,
    findBrokenRefs: async (t) =>
      t.kind === "discriminator" ? [{ document: "coverageMaster", ownerName: "수술비", refPath: t.code }] : [],
    purgeValueRows: async (t) => {
      purged.push(t);
    },
  };
  return { source, purged };
}

describe("catalog 서비스 (PGlite)", () => {
  let t: TestDb;
  let svc: CatalogService;
  const store = fakeValueStore({
    [JSON.stringify({ kind: "field", code: "D0003", fieldCode: "F01" })]: 5,
    [JSON.stringify({ kind: "discriminator", code: "D0001" })]: 12,
    [JSON.stringify({ kind: "enumValue", enumCode: "E0001", valueCode: "V02" })]: 3,
  });

  beforeAll(async () => {
    t = await createTestDb();
    svc = createCatalogService(t.db, { impact: store.source });
  });
  afterAll(async () => {
    await t.close();
  });

  describe("구분자정의 S1 — 채번 · 조회 · 표시명 변경", () => {
    it("편집자가 담보 레벨 boolean 「갱신여부」를 채번하면 D0001 을 받는다", async () => {
      const def = unwrap(
        await svc.create(editor, {
          kind: "scalar",
          label: "갱신여부",
          level: "coverage",
          type: { kind: "boolean" },
          alwaysExposed: true,
        }),
      );
      expect(def.code).toBe("D0001");
      expect(await svc.get("D0001")).toEqual(def);
    });

    it("같은 레벨 표시명 중복은 DB 상태 기준으로 거부된다 (D-P1-1)", async () => {
      const r = await svc.create(editor, { kind: "scalar", label: "갱신여부", level: "coverage", type: { kind: "boolean" } });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.rejection.reason).toBe("duplicate");
    });

    it("표시명 변경은 편집자도 자유 — 코드 불변, 저장된다", async () => {
      const r = unwrap(await svc.rename(editor, "D0001", "갱신형 여부"));
      expect(r.code).toBe("D0001");
      expect((await svc.get("D0001"))?.label).toBe("갱신형 여부");
    });

    it("없는 코드는 notFound", async () => {
      expect(await svc.rename(editor, "D9999", "x")).toEqual({ ok: false, rejection: { reason: "notFound", what: "구분자 D9999" } });
      expect(await svc.get("D9999")).toBeUndefined();
    });

    it("만든 사람·고친 사람이 기록된다 (created_by · updated_by)", async () => {
      const audit = await svc.audit("D0001");
      expect(audit?.createdBy).toBe(editor.userId);
      expect(audit?.updatedBy).toBe(editor.userId);
    });
  });

  describe("구분자정의 S2 — enum 정의와 값 추가 · 값 삭제(파괴적)", () => {
    it("enum 「고지유형」 E0001 + 값 V01·V02 등록, 상품 레벨 enum 구분자가 참조한다", async () => {
      const e = unwrap(await svc.createEnum(editor, { label: "고지유형", values: [{ label: "일반심사" }, { label: "간편심사" }] }));
      expect(e.code).toBe("E0001");
      expect(e.values.map((v) => v.code)).toEqual(["V01", "V02"]);
      const d = unwrap(
        await svc.create(editor, { kind: "scalar", label: "고지유형", level: "product", type: { kind: "enum", enumCode: "E0001" } }),
      );
      expect(d.code).toBe("D0002");
      expect(await svc.getEnum("E0001")).toEqual(e);
    });

    it("없는 enum 을 참조하는 구분자는 invalid", async () => {
      const r = await svc.create(editor, { kind: "scalar", label: "x", level: "product", type: { kind: "enum", enumCode: "E0009" } });
      expect(r.ok).toBe(false);
    });

    it("값 추가 · 값 표시명 변경은 편집자 자유", async () => {
      const e = unwrap(await svc.addEnumValue(editor, "E0001", { label: "건강고지" }));
      expect(e.values[2]).toMatchObject({ code: "V03", label: "건강고지" });
      const e2 = unwrap(await svc.renameEnumValue(editor, "E0001", "V02", "간편고지심사"));
      expect(e2.values[1].label).toBe("간편고지심사");
      expect((await svc.getEnum("E0001"))?.values[1].label).toBe("간편고지심사");
    });

    it("enum 값 삭제 — 편집자는 forbidden, 관리자는 영향(값 행 3) 확인 후 삭제 + 값 행 purge", async () => {
      const denied = await svc.removeEnumValue(editor, "E0001", "V02");
      expect(denied).toEqual({ ok: false, rejection: { reason: "forbidden", role: "editor", action: "enum.deleteValue" } });

      const first = await svc.removeEnumValue(admin, "E0001", "V02");
      expect(first.ok).toBe(false);
      if (!first.ok && first.rejection.reason === "needsConfirmation") {
        expect(first.rejection.impact.valueRowsLost).toBe(3);
      } else throw new Error("needsConfirmation 기대");
      expect((await svc.getEnum("E0001"))?.values).toHaveLength(3);

      const done = unwrap(await svc.removeEnumValue(admin, "E0001", "V02", { confirm: true }));
      expect(done.values.map((v) => v.code)).toEqual(["V01", "V03"]);
      expect(store.purged).toContainEqual({ kind: "enumValue", enumCode: "E0001", valueCode: "V02" });
    });

    it("삭제된 값의 순번은 재사용하지 않는다 — 다음 값은 V04", async () => {
      const e = unwrap(await svc.addEnumValue(editor, "E0001", { label: "재추가" }));
      expect(e.values.at(-1)?.code).toBe("V04");
    });
  });

  describe("구분자정의 S3 — 구조체 · 필드 추가(비파괴) · 필드 삭제(파괴적)", () => {
    it("급부 레벨 구조체 「보험금지급」 D0003 = 필드 F01·F02", async () => {
      const def = unwrap(
        await svc.create(editor, {
          kind: "struct",
          label: "보험금지급",
          level: "benefit",
          alwaysExposed: true,
          fields: [
            { label: "면책여부", type: { kind: "boolean" } },
            { label: "지급률", type: { kind: "number" }, defaultValue: 100 },
          ],
        }),
      );
      expect(def.code).toBe("D0003");
      if (def.kind !== "struct") throw new Error("struct 기대");
      expect(def.fields.map((f) => f.code)).toEqual(["F01", "F02"]);
      expect(await svc.get("D0003")).toEqual(def);
    });

    it("필드 추가는 편집자 가능 — F03, 기존 필드 그대로", async () => {
      const def = unwrap(await svc.addField(editor, "D0003", { label: "감액기간", type: { kind: "number" } }));
      expect(def.fields.map((f) => [f.code, f.order])).toEqual([
        ["F01", 0],
        ["F02", 1],
        ["F03", 2],
      ]);
      expect(await svc.get("D0003")).toEqual(def);
    });

    it("필드 표시명 변경 · 기본값 해제 · 순서 변경은 편집자 가능", async () => {
      unwrap(await svc.renameField(editor, "D0003", "F03", "감액 기간"));
      unwrap(await svc.setFieldDefaultValue(editor, "D0003", "F02", undefined));
      const def = unwrap(await svc.reorderFields(editor, "D0003", ["F03", "F01", "F02"]));
      expect(def.fields.map((f) => [f.code, f.label, f.order])).toEqual([
        ["F03", "감액 기간", 0],
        ["F01", "면책여부", 1],
        ["F02", "지급률", 2],
      ]);
      expect(def.fields[2].defaultValue).toBeUndefined();
      expect(await svc.get("D0003")).toEqual(def);
    });

    it("구조체가 아닌 구분자에 필드 추가 → invalid", async () => {
      const r = await svc.addField(editor, "D0001", { label: "x", type: { kind: "string" } });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.rejection.reason).toBe("invalid");
    });

    it("필드 삭제 — 편집자 forbidden · 관리자 1차 needsConfirmation(값 행 5) · confirm 후 삭제 + purge", async () => {
      expect((await svc.removeField(editor, "D0003", "F01")).ok).toBe(false);
      const first = await svc.removeField(admin, "D0003", "F01");
      if (first.ok || first.rejection.reason !== "needsConfirmation") throw new Error("needsConfirmation 기대");
      expect(first.rejection.impact.valueRowsLost).toBe(5);
      const def = unwrap(await svc.removeField(admin, "D0003", "F01", { confirm: true }));
      expect(def.fields.map((f) => f.code)).toEqual(["F03", "F02"]);
      expect(store.purged).toContainEqual({ kind: "field", code: "D0003", fieldCode: "F01" });
      expect(await svc.get("D0003")).toEqual(def);
    });

    it("필드 타입 변경도 파괴적 — confirm 후 타입이 바뀌고 그 필드의 값 행이 purge 된다", async () => {
      const first = await svc.changeFieldType(admin, "D0003", "F02", { kind: "string" });
      expect(first.ok).toBe(false);
      const def = unwrap(await svc.changeFieldType(admin, "D0003", "F02", { kind: "string" }, { confirm: true }));
      expect(def.fields.find((f) => f.code === "F02")?.type).toEqual({ kind: "string" });
      expect(store.purged).toContainEqual({ kind: "field", code: "D0003", fieldCode: "F02" });
    });
  });

  describe("구분자정의 S4 — const", () => {
    it("const 채번 · 값 변경은 편집자 가능 (D-P1-14)", async () => {
      const def = unwrap(await svc.create(editor, { kind: "const", label: "평균공시이율", value: "2.5%" }));
      expect(def).toMatchObject({ kind: "const", code: "D0004", value: "2.5%" });
      const changed = unwrap(await svc.setConstValue(editor, "D0004", "2.65%"));
      expect(changed.value).toBe("2.65%");
      expect(await svc.get("D0004")).toEqual(changed);
    });

    it("const 가 아닌 구분자의 값 변경 → invalid", async () => {
      expect((await svc.setConstValue(editor, "D0001", "x")).ok).toBe(false);
    });
  });

  describe("구분자정의 S5 — 파생", () => {
    it("파생식은 데이터로 저장되고 수정은 편집자 가능 (D-P1-12) · 별칭은 거부", async () => {
      const def = unwrap(await svc.create(editor, { kind: "derived", label: "면책여부합", level: "coverage", expression: "any(D0003.F01)" }));
      expect(def.code).toBe("D0005");
      const upd = unwrap(await svc.setExpression(editor, "D0005", "all(D0003.F01)"));
      expect(upd.expression).toBe("all(D0003.F01)");
      expect(await svc.get("D0005")).toEqual(upd);
      expect((await svc.setExpression(editor, "D0005", "D0001")).ok).toBe(false);
      expect((await svc.create(editor, { kind: "derived", label: "별칭", level: "coverage", expression: "D0001" })).ok).toBe(false);
    });

    it("별칭 판정은 서비스 생성 시 주입할 수 있다", async () => {
      const other = createCatalogService(t.db, { isAlias: () => true });
      const r = await other.create(editor, { kind: "derived", label: "z", level: "coverage", expression: "any(D0003.F01)" });
      expect(r.ok).toBe(false);
    });
  });

  describe("구분자정의 S6 — 삭제 · 타입 변경 (관리자 · 2단)", () => {
    it("scalar 타입 변경 — 편집자 forbidden · 관리자 confirm 후 타입 변경 + 구분자 값 행 전부 purge", async () => {
      expect((await svc.changeScalarType(editor, "D0001", { kind: "string" })).ok).toBe(false);
      const first = await svc.changeScalarType(admin, "D0001", { kind: "enum", enumCode: "E0001" });
      if (first.ok || first.rejection.reason !== "needsConfirmation") throw new Error("needsConfirmation 기대");
      expect(first.rejection.impact.valueRowsLost).toBe(12);
      const def = unwrap(await svc.changeScalarType(admin, "D0001", { kind: "enum", enumCode: "E0001" }, { confirm: true }));
      expect(def.type).toEqual({ kind: "enum", enumCode: "E0001" });
      expect(store.purged).toContainEqual({ kind: "discriminator", code: "D0001" });
    });

    it("구분자 삭제 — 영향에 값 행 수·참조 목록·cascade(필드) 가 실리고 confirm 후 사라진다", async () => {
      expect((await svc.remove(editor, "D0003")).ok).toBe(false);
      const first = await svc.remove(admin, "D0003");
      if (first.ok || first.rejection.reason !== "needsConfirmation") throw new Error("needsConfirmation 기대");
      expect(first.rejection.impact.cascade).toEqual(["필드 감액 기간(F03)", "필드 지급률(F02)"]);
      expect(first.rejection.impact.brokenRefs[0]).toMatchObject({ refPath: "D0003" });
      unwrap(await svc.remove(admin, "D0003", { confirm: true }));
      expect(await svc.get("D0003")).toBeUndefined();
      expect(store.purged).toContainEqual({ kind: "discriminator", code: "D0003" });
    });

    it("삭제된 구분자 코드는 재사용되지 않는다 — 다음 채번은 D0006", async () => {
      const def = unwrap(await svc.create(editor, { kind: "scalar", label: "새것", level: "plan", type: { kind: "date" } }));
      expect(def.code).toBe("D0006");
    });

    it("없는 구분자 삭제는 관리자에게도 notFound (영향 계산 전)", async () => {
      expect(await svc.remove(admin, "D9999")).toEqual({ ok: false, rejection: { reason: "notFound", what: "구분자 D9999" } });
    });

    it("enum 삭제 — 참조 중인 구분자(D0001·D0002)가 깨질 참조로, 값들이 cascade 로 보인다", async () => {
      const first = await svc.removeEnum(admin, "E0001");
      if (first.ok || first.rejection.reason !== "needsConfirmation") throw new Error("needsConfirmation 기대");
      expect(first.rejection.impact.brokenRefs.map((r) => r.refPath).sort()).toEqual(["D0001", "D0002"]);
      expect(first.rejection.impact.cascade).toHaveLength(3);
      unwrap(await svc.removeEnum(admin, "E0001", { confirm: true }));
      expect(await svc.getEnum("E0001")).toBeUndefined();
      expect(await svc.listEnums()).toEqual([]);
    });

    it("목록 조회는 코드 순", async () => {
      const codes = (await svc.list()).map((d) => d.code);
      expect(codes).toEqual(["D0001", "D0002", "D0004", "D0005", "D0006"]);
    });
  });

  describe("기타 비파괴 변경", () => {
    it("설명 · 노출여부 · scalar 기본값 · enum 표시명 · enum 값 순서", async () => {
      unwrap(await svc.setDescription(editor, "D0006", "설명"));
      unwrap(await svc.setAlwaysExposed(editor, "D0006", true));
      const def = unwrap(await svc.setDefaultValue(editor, "D0006", "2026-01-01"));
      expect(def).toMatchObject({ description: "설명", alwaysExposed: true, defaultValue: "2026-01-01" });
      expect(await svc.get("D0006")).toEqual(def);

      const e = unwrap(await svc.createEnum(editor, { label: "갱신유형", values: [{ label: "비갱신형" }, { label: "갱신형" }] }));
      expect(e.code).toBe("E0002");
      unwrap(await svc.renameEnum(editor, e.code, "갱신 유형"));
      const re = unwrap(await svc.reorderEnumValues(editor, e.code, ["V02", "V01"]));
      expect(re.label).toBe("갱신 유형");
      expect(re.values.map((v) => v.code)).toEqual(["V02", "V01"]);
      expect(await svc.getEnum(e.code)).toEqual(re);
      expect((await svc.createEnum(editor, { label: "갱신 유형" })).ok).toBe(false); // D-P1-7
    });
  });
});
