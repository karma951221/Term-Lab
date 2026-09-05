import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Coverage, CoverageNodeRef, UsageQuery } from "@/domain/coverage";
import { masterCatalog, masterEvalContext } from "@/domain/coverage";
import { evaluate, parse } from "@/domain/expression";
import type { Actor, Coordinate } from "@/domain/types";

import { readSlots, listAttached, type ValueOwner } from "@/db/repo/values";
import { createTestDb, type TestDb } from "@/db/test-utils";
import { createCatalogService } from "./catalog";
import { createCoverageService, type CoverageService } from "./coverage";

const admin: Actor = { userId: "00000000-0000-4000-8000-000000000001", role: "admin" };
const editor: Actor = { userId: "00000000-0000-4000-8000-000000000002", role: "editor" };

function unwrap<T>(r: { ok: true; value: T } | { ok: false; rejection: unknown }): T {
  if (!r.ok) throw new Error(`기대: ok, 실제: ${JSON.stringify(r.rejection)}`);
  return r.value;
}
function rejection(r: { ok: boolean; rejection?: unknown }) {
  if (r.ok) throw new Error("기대: 거부, 실제: ok");
  return r.rejection as { reason: string; what?: string; impact?: { valueRowsLost: number; cascade: string[]; brokenRefs: Coordinate[] }; issues?: { kind: string }[] };
}

describe("coverage 서비스 (PGlite)", () => {
  let t: TestDb;
  let svc: CoverageService;
  /** 사용처 흉내 — 질의를 기록하고, 「basis 해제」와 「세부보장 삭제」에만 사용처를 돌려준다. */
  const queries: UsageQuery[] = [];
  const usage = {
    findUsages: async (q: UsageQuery): Promise<Coordinate[]> => {
      queries.push(q);
      if (q.kind === "detach" && q.discriminatorCode === "D0002") return [{ document: "coverageMaster", ownerId: q.coverageId, refPath: "D0002" }];
      if (q.kind === "deleteNode" && q.node.level === "subCoverage") return [{ document: "coverageMaster", ownerId: q.coverageId, articleTitle: "보장범위" }];
      return [];
    },
  };

  let accident: Coverage;
  let surgery: Coverage;
  const cov = (c: Coverage): CoverageNodeRef => ({ level: "coverage", id: c.id });
  /** 노드 지시자 → 값 저장소 소유자 (repo/values 직접 검증용). */
  const own = (r: CoverageNodeRef): ValueOwner => ({ kind: r.level, id: r.id });

  beforeAll(async () => {
    t = await createTestDb();
    svc = createCoverageService(t.db, { usage });
    // 카탈로그 픽스처 — 갱신유형(담보·무조건) D0001 · 수술급여기준(담보·선택) D0002 · 보험금지급(급부·무조건 구조체) D0003 · 면책여부합(파생) D0004
    const catalog = createCatalogService(t.db);
    unwrap(await catalog.create(editor, { kind: "scalar", label: "갱신유형", level: "coverage", type: { kind: "boolean" }, alwaysExposed: true }));
    unwrap(await catalog.create(editor, { kind: "scalar", label: "수술급여기준", level: "coverage", type: { kind: "string" }, defaultValue: "약관 별표 기준" }));
    unwrap(
      await catalog.create(editor, {
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
    unwrap(await catalog.create(editor, { kind: "derived", label: "면책여부합", level: "coverage", expression: "any(D0003.F01)" }));
  });
  afterAll(async () => {
    await t.close();
  });

  describe("담보트리 S1·S2·S3 — 생성 · 추가 · 이름 · 순서 (편집자 가능)", () => {
    it("편집자가 담보 「일반상해사망」을 만들면 세부보장 1·급부 1 최소 트리가 저장된다", async () => {
      accident = unwrap(await svc.create(editor, { name: "일반상해사망", benefitName: "일반상해사망보험금" }));
      expect(accident.subCoverages).toHaveLength(1);
      expect(accident.subCoverages[0].benefits[0].name).toBe("일반상해사망보험금");
      expect(await svc.get(accident.id)).toEqual(accident);
    });

    it("담보명 중복은 DB 상태 기준으로 거부 (D-P2-2)", async () => {
      expect(rejection(await svc.create(editor, { name: "일반상해사망" })).reason).toBe("duplicate");
      expect((await svc.rename(editor, accident.id, "일반상해사망")).ok).toBe(true); // 자기 이름은 중복이 아니다

    });

    it("수술비: 세부보장 7개 순서대로 추가 → 각 급부 1개, 형제 순서 유지", async () => {
      surgery = unwrap(await svc.create(editor, { name: "수술비", subCoverageName: "1종수술", benefitName: "수술보험금" }));
      for (const n of ["2종수술", "3종수술", "4종수술", "5종수술", "6종수술", "7종수술"]) {
        surgery = unwrap(await svc.addSubCoverage(editor, surgery.id, { name: n, benefitName: "수술보험금" }));
      }
      expect(surgery.subCoverages.map((s) => s.name)).toEqual(["1종수술", "2종수술", "3종수술", "4종수술", "5종수술", "6종수술", "7종수술"]);
      expect(await svc.get(surgery.id)).toEqual(surgery);
    });

    it("형제 이름 중복 거부 · 다른 담보 아래 동명 허용 · 급부 추가/이름 변경", async () => {
      expect(rejection(await svc.addSubCoverage(editor, surgery.id, { name: "1종수술" })).reason).toBe("duplicate");
      expect(rejection(await svc.renameSubCoverage(editor, surgery.subCoverages[1].id, "1종수술")).reason).toBe("duplicate");
      accident = unwrap(await svc.addSubCoverage(editor, accident.id, { name: "1종수술" }));
      expect(accident.subCoverages).toHaveLength(2);
      const sub = surgery.subCoverages[0];
      surgery = unwrap(await svc.addBenefit(editor, sub.id, "입원보험금"));
      expect(surgery.subCoverages[0].benefits.map((b) => b.name)).toEqual(["수술보험금", "입원보험금"]);
      expect(rejection(await svc.addBenefit(editor, sub.id, "입원보험금")).reason).toBe("duplicate");
      surgery = unwrap(await svc.renameBenefit(editor, surgery.subCoverages[0].benefits[1].id, "통원보험금"));
      expect((await svc.get(surgery.id))?.subCoverages[0].benefits[1].name).toBe("통원보험금");
    });

    it("담보트리 S4 — 7종수술을 맨 앞으로 재배열하면 저장된 순서가 그대로 따른다", async () => {
      const ids = surgery.subCoverages.map((s) => s.id);
      surgery = unwrap(await svc.reorderSubCoverages(editor, surgery.id, [ids[6], ...ids.slice(0, 6)]));
      expect((await svc.get(surgery.id))?.subCoverages.map((s) => s.name)[0]).toBe("7종수술");
      const [b0, b1] = surgery.subCoverages[1].benefits.map((b) => b.id); // 1종수술
      surgery = unwrap(await svc.reorderBenefits(editor, surgery.subCoverages[1].id, [b1, b0]));
      expect(surgery.subCoverages[1].benefits.map((b) => b.name)).toEqual(["통원보험금", "수술보험금"]);
    });

    it("설명·문서 연결 자리 · 없는 id 는 notFound", async () => {
      const desc = unwrap(await svc.setDescription(editor, surgery.id, "수술 담보"));
      expect(desc.description).toBe("수술 담보");
      const doc = "33333333-3333-4333-8333-333333333333";
      expect(unwrap(await svc.setDocument(editor, surgery.id, doc)).documentId).toBe(doc);
      expect(unwrap(await svc.setDocument(editor, surgery.id, undefined)).documentId).toBeUndefined();
      expect(rejection(await svc.rename(editor, "44444444-4444-4444-8444-444444444444", "x")).reason).toBe("notFound");
      expect(rejection(await svc.addBenefit(editor, "44444444-4444-4444-8444-444444444444", "x")).reason).toBe("notFound");
    });
  });

  describe("담보값입력 S1·S2 — 노출여부와 부착", () => {
    it("무조건 노출 갱신유형은 부착 조작 없이 두 담보 모두의 폼에 뜬다 · + 목록에는 없다", async () => {
      for (const c of [accident, surgery]) {
        const forms = unwrap(await svc.forms(cov(c)));
        expect(forms.map((f) => f.def.code)).toEqual(["D0001"]);
        expect(forms[0].slots).toEqual({});
      }
      expect(unwrap(await svc.attachable(cov(surgery))).map((d) => d.code)).toEqual(["D0002"]);
    });

    it("편집자가 수술비에 수술급여기준을 + 로 부착하면 관계가 데이터로 남고 폼에 나타난다 (일반상해사망은 아니다)", async () => {
      unwrap(await svc.attach(editor, cov(surgery), "D0002"));
      expect(await listAttached(t.db, own(cov(surgery)))).toEqual(["D0002"]);
      const forms = unwrap(await svc.forms(cov(surgery)));
      expect(forms.map((f) => f.def.code)).toEqual(["D0001", "D0002"]);
      expect(forms[1].prefill).toEqual({ D0002: "약관 별표 기준" }); // 기본값은 프리필로만
      expect(forms[1].slots).toEqual({});
      expect(unwrap(await svc.forms(cov(accident))).map((f) => f.def.code)).toEqual(["D0001"]);
      expect(unwrap(await svc.attachable(cov(surgery)))).toEqual([]);
    });

    it("무조건 노출 · 레벨 불일치 · 이미 부착 · 없는 구분자 · 없는 실체는 거부", async () => {
      expect(rejection(await svc.attach(editor, cov(surgery), "D0001")).reason).toBe("invalid");
      expect(rejection(await svc.attach(editor, cov(surgery), "D0003")).reason).toBe("invalid");
      expect(rejection(await svc.attach(editor, cov(surgery), "D0002")).reason).toBe("duplicate");
      expect(rejection(await svc.attach(editor, cov(surgery), "D9999")).reason).toBe("notFound");
      expect(rejection(await svc.attach(editor, { level: "benefit", id: "44444444-4444-4444-8444-444444444444" }, "D0002")).reason).toBe("notFound");
    });
  });

  describe("담보값입력 S4 — 값 입력 · 미입력 상태 · 값 비우기", () => {
    it("타입 맞는 값은 저장되고 폼에 명시 값으로 보인다. 타입 위반은 invalid", async () => {
      unwrap(await svc.writeValue(editor, cov(surgery), "D0001", true));
      unwrap(await svc.writeValue(editor, cov(surgery), "D0002", "별표 기준"));
      const forms = unwrap(await svc.forms(cov(surgery)));
      expect(forms[0].slots).toEqual({ D0001: { entered: true, value: true } });
      expect(forms[1].prefill).toEqual({ D0002: "별표 기준" });
      expect(rejection(await svc.writeValue(editor, cov(surgery), "D0001", "yes")).issues?.[0].kind).toBe("typeMismatch");
    });

    it("미부착 구분자 · 파생 · 없는 자리에는 쓸 수 없다", async () => {
      expect(rejection(await svc.writeValue(editor, cov(accident), "D0002", "x")).issues?.[0].kind).toBe("notAttached");
      expect(rejection(await svc.writeValue(editor, cov(accident), "D0004", true)).reason).toBe("invalid");
      expect(rejection(await svc.writeValue(editor, cov(accident), "D0003.F01", true)).issues?.[0].kind).toBe("notAttached");
      expect(rejection(await svc.writeValue(editor, cov(accident), "D9999", 1)).reason).toBe("notFound");
    });

    it("급부 레벨 값 입력은 담보 레벨과 같은 규칙 (D-P2-12) · 값 비우기 → 미입력 (D-P2-10)", async () => {
      const b: CoverageNodeRef = { level: "benefit", id: accident.subCoverages[0].benefits[0].id };
      unwrap(await svc.writeValue(editor, b, "D0003.F01", false));
      unwrap(await svc.writeValue(editor, b, "D0003.F02", 50));
      expect(unwrap(await svc.forms(b))[0].slots).toEqual({ "D0003.F01": { entered: true, value: false }, "D0003.F02": { entered: true, value: 50 } });
      unwrap(await svc.clearValue(editor, b, "D0003.F02"));
      const [form] = unwrap(await svc.forms(b));
      expect(form.slots).toEqual({ "D0003.F01": { entered: true, value: false } });
      expect(form.prefill).toEqual({ "D0003.F01": false, "D0003.F02": 100 });
    });
  });

  describe("담보값입력 S3 — 완결성 조회는 부착된 것만 대상", () => {
    it("일반상해사망: 갱신유형 + 급부 자리 미입력만. 수술급여기준은 나타나지 않는다", async () => {
      const missing = unwrap(await svc.completeness(accident.id));
      expect(missing.map((m) => [m.owner.level, m.path])).toEqual([
        ["coverage", "D0001"],
        ["benefit", "D0003.F02"], // 첫 급부: F01 입력됨
        ["benefit", "D0003.F01"], // 두 번째 세부보장(1종수술)의 급부
        ["benefit", "D0003.F02"],
      ]);
      expect(missing.some((m) => m.discriminatorCode === "D0002")).toBe(false);
    });

    it("수술비: 담보 레벨은 둘 다 입력돼 급부 자리만 남는다 (7 세부보장 · 급부 8개 × 2 자리)", async () => {
      const missing = unwrap(await svc.completeness(surgery.id));
      expect(missing.filter((m) => m.owner.level === "coverage")).toEqual([]);
      expect(missing).toHaveLength(16);
    });

    it("실행 기반 필터를 주입하면 그 결과가 조회 결과다", async () => {
      const filtered = createCoverageService(t.db, { usage, completenessFilter: (items) => items.slice(0, 1) });
      expect(unwrap(await filtered.completeness(surgery.id))).toHaveLength(1);
    });
  });

  describe("담보값입력 S2 경계 — 부착 해제 (파괴적 · coverage.detach)", () => {
    it("편집자의 해제는 역할로 거부된다 — 영향 계산 전", async () => {
      queries.length = 0;
      expect(await svc.detach(editor, cov(surgery), "D0002")).toEqual({
        ok: false,
        rejection: { reason: "forbidden", role: "editor", action: "coverage.detach" },
      });
      expect(queries).toEqual([]);
    });

    it("관리자 1차 호출: 사용처(주입) → brokenRefs, 값 행 1건 → needsConfirmation. 아직 해제되지 않는다", async () => {
      const r = rejection(await svc.detach(admin, cov(surgery), "D0002"));
      expect(r.reason).toBe("needsConfirmation");
      expect(r.impact).toEqual({
        valueRowsLost: 1,
        cascade: [],
        brokenRefs: [{ document: "coverageMaster", ownerId: surgery.id, refPath: "D0002" }],
      });
      expect(queries).toEqual([{ kind: "detach", coverageId: surgery.id, owner: cov(surgery), discriminatorCode: "D0002" }]);
      expect(await listAttached(t.db, own(cov(surgery)))).toEqual(["D0002"]);
    });

    it("confirm 후: 부착 관계 삭제 + 그 값 행 연쇄 삭제. 다른 값은 남는다", async () => {
      unwrap(await svc.detach(admin, cov(surgery), "D0002", { confirm: true }));
      expect(await listAttached(t.db, own(cov(surgery)))).toEqual([]);
      const slots = await readSlots(t.db, own(cov(surgery)));
      expect(slots.has("D0002")).toBe(false);
      expect(slots.get("D0001")).toEqual({ entered: true, value: true });
    });

    it("무조건 노출 해제 · 미부착 해제는 관리자도 거부 (precheck)", async () => {
      expect(rejection(await svc.detach(admin, cov(surgery), "D0001", { confirm: true })).reason).toBe("invalid");
      expect(rejection(await svc.detach(admin, cov(surgery), "D0002", { confirm: true })).reason).toBe("notFound");
    });
  });

  describe("역할권한 S1·S3·S4 — 구조 삭제 (파괴적 · coverage.deleteNode)", () => {
    it("편집자의 세부보장 삭제는 역할로 거부 — 화면 우회해도 동일", async () => {
      expect(await svc.removeSubCoverage(editor, surgery.subCoverages[0].id)).toEqual({
        ok: false,
        rejection: { reason: "forbidden", role: "editor", action: "coverage.deleteNode" },
      });
    });

    it("최소 구조 위반(마지막 세부보장·마지막 급부)은 관리자도 거부", async () => {
      const only = accident.subCoverages[0];
      expect(rejection(await svc.removeBenefit(admin, only.benefits[0].id, { confirm: true })).reason).toBe("minimumStructure");
      const simple = unwrap(await svc.create(editor, { name: "단순담보" }));
      expect(rejection(await svc.removeSubCoverage(admin, simple.subCoverages[0].id, { confirm: true })).reason).toBe("minimumStructure");
    });

    it("관리자 1차: 영향 목록(소실 값 행 수 · cascade 이름 · 사용처) → 확인 요구. confirm 후 노드·값 행 연쇄 삭제", async () => {
      const seven = surgery.subCoverages[0]; // 7종수술 (맨 앞)
      const b: CoverageNodeRef = { level: "benefit", id: seven.benefits[0].id };
      unwrap(await svc.writeValue(editor, b, "D0003.F01", true));
      unwrap(await svc.writeValue(editor, b, "D0003.F02", 10));
      queries.length = 0;

      const first = rejection(await svc.removeSubCoverage(admin, seven.id));
      expect(first.reason).toBe("needsConfirmation");
      expect(first.impact).toEqual({
        valueRowsLost: 2,
        cascade: ["급부 수술보험금"],
        brokenRefs: [{ document: "coverageMaster", ownerId: surgery.id, articleTitle: "보장범위" }],
      });
      expect(queries).toEqual([{ kind: "deleteNode", coverageId: surgery.id, node: { level: "subCoverage", id: seven.id } }]);
      expect((await svc.get(surgery.id))?.subCoverages).toHaveLength(7);

      surgery = unwrap(await svc.removeSubCoverage(admin, seven.id, { confirm: true }));
      expect(surgery.subCoverages.map((s) => s.name)).toEqual(["1종수술", "2종수술", "3종수술", "4종수술", "5종수술", "6종수술"]);
      expect(surgery.subCoverages.map((s) => s.order)).toEqual([0, 1, 2, 3, 4, 5]);
      expect((await readSlots(t.db, own(b))).size).toBe(0);
    });

    it("급부 삭제도 같은 결 — 통원보험금(1종수술) 삭제", async () => {
      const one = surgery.subCoverages[0];
      const target = one.benefits.find((x) => x.name === "통원보험금")!;
      expect(rejection(await svc.removeBenefit(admin, target.id)).reason).toBe("needsConfirmation");
      surgery = unwrap(await svc.removeBenefit(admin, target.id, { confirm: true }));
      expect(surgery.subCoverages[0].benefits.map((x) => x.name)).toEqual(["수술보험금"]);
    });

    it("담보 삭제도 같은 결 — 편집자 forbidden · 관리자 확인 후 트리·부착·값 전부 삭제", async () => {
      const simple = (await svc.list()).find((c) => c.name === "단순담보")!;
      unwrap(await svc.writeValue(editor, cov(simple), "D0001", false));
      expect(rejection(await svc.remove(editor, simple.id)).reason).toBe("forbidden");
      const first = rejection(await svc.remove(admin, simple.id));
      expect(first.impact).toMatchObject({ valueRowsLost: 1, cascade: ["세부보장 단순담보", "급부 단순담보"] });
      unwrap(await svc.remove(admin, simple.id, { confirm: true }));
      expect(await svc.get(simple.id)).toBeUndefined();
      expect((await readSlots(t.db, own(cov(simple)))).size).toBe(0);
      expect(rejection(await svc.remove(admin, simple.id, { confirm: true })).reason).toBe("notFound");
    });
  });

  describe("마스터 값 조회 → 평가 문맥 (B3 사전평가 · C2 조립 재사용)", () => {
    it("masterValues 로 만든 masterEvalContext 가 파생 any(급부.면책여부) 를 평가한다", async () => {
      for (const s of accident.subCoverages) {
        for (const b of s.benefits) {
          unwrap(await svc.writeValue(editor, { level: "benefit", id: b.id }, "D0003.F01", s.name === "1종수술"));
        }
      }
      const { tree, values } = unwrap(await svc.masterValues(accident.id));
      expect(tree.id).toBe(accident.id);
      const catalog = masterCatalog(await createCatalogService(t.db).list());
      const ctx = masterEvalContext(tree, values, catalog);
      expect(evaluate(unwrap(parse("D0004")), ctx)).toEqual({ kind: "value", value: true });
      expect(evaluate(unwrap(parse("D0001")), ctx)).toMatchObject({ kind: "error", issue: { kind: "notEntered" } });
      expect(rejection(await svc.masterValues("44444444-4444-4444-8444-444444444444")).reason).toBe("notFound");
    });
  });
});
