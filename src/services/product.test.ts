import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CoverageMasterSource, CoverageTree, ProductPlan, RequiredCoverageRef } from "@/domain/product";
import type { Actor, Issue } from "@/domain/types";

import { attach as attachMaster, readSlots, writeSlot } from "@/db/repo/values";
import { createTestDb, type TestDb } from "@/db/test-utils";
import { createCatalogService } from "./catalog";
import { createProductService, type ProductService } from "./product";

const admin: Actor = { userId: "00000000-0000-4000-8000-000000000001", role: "admin" };
const editor: Actor = { userId: "00000000-0000-4000-8000-000000000002", role: "editor" };

function unwrap<T>(r: { ok: true; value: T } | { ok: false; rejection: unknown }): T {
  if (!r.ok) throw new Error(`기대: ok, 실제: ${JSON.stringify(r.rejection)}`);
  return r.value;
}
function reason(r: { ok: boolean; rejection?: { reason: string } }): string | undefined {
  return r.ok ? undefined : r.rejection?.reason;
}

// ───────── 담보 마스터 스텁 (B1) ─────────
const DEATH = "aaaaaaaa-0000-4000-8000-000000000001";
const DEATH_SUB = "aaaaaaaa-0000-4000-8000-000000000011";
const DEATH_BEN = "aaaaaaaa-0000-4000-8000-000000000111";
const SURGERY = "aaaaaaaa-0000-4000-8000-000000000002";
const SURGERY_SUB1 = "aaaaaaaa-0000-4000-8000-000000000021";
const SURGERY_BEN1 = "aaaaaaaa-0000-4000-8000-000000000211";
const SURGERY_SUB2 = "aaaaaaaa-0000-4000-8000-000000000022";
const SURGERY_BEN2 = "aaaaaaaa-0000-4000-8000-000000000221";
const GENERAL_DOC = "dddddddd-0000-4000-8000-000000000001";
const OTHER_DOC = "dddddddd-0000-4000-8000-000000000002";
const NODE = "eeeeeeee-0000-4000-8000-000000000001";

const trees = new Map<string, CoverageTree>([
  [DEATH, { id: DEATH, name: "일반상해사망", subCoverages: [{ id: DEATH_SUB, name: "일반상해사망", order: 0, benefits: [{ id: DEATH_BEN, name: "사망보험금", order: 0 }] }] }],
  [SURGERY, { id: SURGERY, name: "수술비", subCoverages: [{ id: SURGERY_SUB1, name: "1종수술", order: 0, benefits: [{ id: SURGERY_BEN1, name: "1종수술급부", order: 0 }] }] }],
]);
const master: CoverageMasterSource = { tree: async (id) => trees.get(id) };

let required: RequiredCoverageRef[] = [];
let optionIssues: Issue[] = [];

describe("product 서비스 (PGlite)", () => {
  let t: TestDb;
  let svc: ProductService;
  let productId: string;
  let pcBasic: string; // 일반상해사망 (속성 없음)
  let pcAddon: string; // 일반상해사망 추가
  let pcSurgery: string; // 갱신형 수술비

  beforeAll(async () => {
    t = await createTestDb();
    const catalog = createCatalogService(t.db);
    // 구분자: 갱신여부(담보 boolean 무조건 노출) · 보험금지급(급부 구조체) · 고지유형(상품 enum) · 감액기간(담보 선택 노출) · 납입면제유형(plan 구조체)
    unwrap(await catalog.create(editor, { kind: "scalar", label: "갱신여부", level: "coverage", type: { kind: "boolean" }, alwaysExposed: true })); // D0001
    unwrap(await catalog.createEnum(editor, { label: "고지유형", values: [{ label: "일반심사" }, { label: "간편심사" }] })); // E0001
    unwrap(await catalog.create(editor, { kind: "scalar", label: "고지유형", level: "product", type: { kind: "enum", enumCode: "E0001" }, alwaysExposed: true })); // D0002
    unwrap(
      await catalog.create(editor, {
        kind: "struct",
        label: "보험금지급",
        level: "benefit",
        alwaysExposed: true,
        fields: [
          { label: "면책여부", type: { kind: "boolean" } },
          { label: "지급률", type: { kind: "number" } },
        ],
      }),
    ); // D0003 F01 F02
    unwrap(await catalog.create(editor, { kind: "scalar", label: "감액기간", level: "coverage", type: { kind: "number" } })); // D0004 선택 노출
    unwrap(await catalog.create(editor, { kind: "struct", label: "납입면제유형", level: "plan", fields: [{ label: "면제사유", type: { kind: "string" } }] })); // D0005 F01
    unwrap(await catalog.create(editor, { kind: "struct", label: "무저해지유형", level: "plan", fields: [] })); // D0006
    unwrap(await catalog.create(editor, { kind: "scalar", label: "상품 선택값", level: "product", type: { kind: "string" } })); // D0007 선택 노출

    // 담보 마스터 값 (B1 이 공용 저장소에 넣는 것과 같은 자리)
    await writeSlot(t.db, { kind: "coverage", id: SURGERY }, "D0001", undefined, false);
    await writeSlot(t.db, { kind: "benefit", id: SURGERY_BEN1 }, "D0003", "F02", 50);
    await attachMaster(t.db, { kind: "coverage", id: SURGERY }, "D0004");
    await writeSlot(t.db, { kind: "coverage", id: DEATH }, "D0001", undefined, false);
    await writeSlot(t.db, { kind: "benefit", id: DEATH_BEN }, "D0003", "F01", false);
    await writeSlot(t.db, { kind: "benefit", id: DEATH_BEN }, "D0003", "F02", 100);

    svc = createProductService(t.db, {
      coverageMaster: master,
      generalDocuments: { exists: async (id) => id === GENERAL_DOC || id === OTHER_DOC },
      generalAttachment: { requiredRefs: async () => required },
      optionValidator: { validate: async () => optionIssues },
    });
  });
  afterAll(async () => {
    await t.close();
  });

  describe("담보속성탑재 S1 — 담보속성 카탈로그", () => {
    it("종류 「갱신유형」 A0001 · 「부가유형」 A0002 채번, 유효값·작명 규칙·순서 저장", async () => {
      const renewal = unwrap(await svc.createAttributeKind(editor, { label: "갱신유형" }));
      expect(renewal.code).toBe("A0001");
      const r2 = unwrap(await svc.addAttributeValue(editor, "A0001", { label: "갱신형", naming: { prefix: "갱신형 " } }));
      expect(r2.values[0]).toMatchObject({ code: "V01", naming: { prefix: "갱신형" } });
      const addon = unwrap(await svc.createAttributeKind(editor, { label: "부가유형" }));
      expect(addon).toMatchObject({ code: "A0002", order: 1 });
      unwrap(await svc.addAttributeValue(editor, "A0002", { label: "기본" }));
      unwrap(await svc.addAttributeValue(editor, "A0002", { label: "추가" }));
      unwrap(await svc.setNamingRule(editor, "A0002", "V02", { suffix: " 추가" }));
      expect((await svc.getAttributeKind("A0002"))?.values[1].naming).toEqual({ suffix: "추가" });
      // 적용 순서: 부가유형 먼저, 갱신유형 다음 → 작명은 order 순이라 prefix/suffix 라 무관
      unwrap(await svc.reorderAttributeKinds(editor, ["A0002", "A0001"]));
      expect((await svc.listAttributeKinds()).map((k) => k.code)).toEqual(["A0002", "A0001"]);
      unwrap(await svc.reorderAttributeKinds(editor, ["A0001", "A0002"]));
    });

    it("종류명 중복 거부 · 표시명 변경은 편집자 자유", async () => {
      expect(reason(await svc.createAttributeKind(editor, { label: "갱신유형" }))).toBe("duplicate");
      unwrap(await svc.renameAttributeValue(editor, "A0001", "V01", "갱신형"));
      unwrap(await svc.renameAttributeKind(editor, "A0001", "갱신유형"));
    });
  });

  describe("세목구성 S1 — 상품 생성 · 보통약관 템플릿 선택 · 상품 레벨 값", () => {
    it("상품 「(무)알파Plus보장보험2604」 생성 → 보통약관 템플릿 1개 연결", async () => {
      const p = unwrap(await svc.createProduct(editor, { name: "(무)알파Plus보장보험2604" }));
      productId = p.id;
      expect(reason(await svc.createProduct(editor, { name: "(무)알파Plus보장보험2604" }))).toBe("duplicate");
      expect(reason(await svc.createProduct(editor, { name: " " }))).toBe("invalid");
      unwrap(await svc.setGeneralDocument(editor, productId, GENERAL_DOC));
      expect((await svc.getProduct(productId))?.generalDocumentId).toBe(GENERAL_DOC);
      // 없는 문서는 게이트가 거부
      expect(reason(await svc.setGeneralDocument(editor, productId, "dddddddd-0000-4000-8000-000000000099"))).toBe("notFound");
    });

    it("세목구성 S4 — 고지유형 = 간편심사 저장 (상품 레벨 enum 값) · 타입 밖 값 거부 · 미입력 되돌리기", async () => {
      unwrap(await svc.setProductValue(editor, productId, "D0002", undefined, "V02"));
      expect((await svc.getProductValues(productId)).get("D0002")).toEqual({ entered: true, value: "V02" });
      expect(reason(await svc.setProductValue(editor, productId, "D0002", undefined, "V99"))).toBe("invalid");
      expect(reason(await svc.setProductValue(editor, productId, "D0001", undefined, true))).toBe("invalid"); // 담보 레벨 구분자
      // 선택 노출 구분자는 부착해야 값 자리가 생긴다
      expect(reason(await svc.setProductValue(editor, productId, "D0007", undefined, "x"))).toBe("invalid");
      unwrap(await svc.attachProductDiscriminator(editor, productId, "D0007"));
      unwrap(await svc.setProductValue(editor, productId, "D0007", undefined, "x"));
      unwrap(await svc.setProductValue(editor, productId, "D0007", undefined, undefined));
      expect((await svc.getProductValues(productId)).has("D0007")).toBe(false);
      expect((await svc.productMissing(productId)).map((m) => m.path)).toEqual(["D0007"]);
    });
  });

  describe("세목구성 S2·S3·S5 — 세목 선택지와 유효 조합", () => {
    let t1: string, t2: string, f1: string, f2: string;
    it("종 축에 납입면제유형 1·2종, 형 축에 무저해지유형 1·2형 등록 · 유형 구조체 값 입력", async () => {
      t1 = unwrap(await svc.addPlanOption(editor, productId, { axis: "type", number: 1, name: "보험료 납입면제 미적용형", planTypeCode: "D0005" })).id;
      t2 = unwrap(await svc.addPlanOption(editor, productId, { axis: "type", number: 2, name: "보험료 납입면제형", planTypeCode: "D0005" })).id;
      f1 = unwrap(await svc.addPlanOption(editor, productId, { axis: "form", number: 1, name: "해약환급금지급형", planTypeCode: "D0006" })).id;
      f2 = unwrap(await svc.addPlanOption(editor, productId, { axis: "form", number: 2, name: "해약환급금미지급형", planTypeCode: "D0006" })).id;
      unwrap(await svc.setPlanOptionValue(editor, t2, "D0005", "F01", "장해"));
      expect((await svc.getPlanOptionValues(t2)).get("D0005.F01")).toEqual({ entered: true, value: "장해" });
      expect(reason(await svc.setPlanOptionValue(editor, t2, "D0006", "F01", "x"))).toBe("invalid"); // 다른 유형의 값
    });
    it("고지유형(상품 enum)은 세목유형이 아니다 · 한 유형은 한 축에만 · 번호 중복 거부", async () => {
      expect(reason(await svc.addPlanOption(editor, productId, { axis: "type", number: 3, name: "x", planTypeCode: "D0002" }))).toBe("invalid");
      expect(reason(await svc.addPlanOption(editor, productId, { axis: "form", number: 3, name: "x", planTypeCode: "D0005" }))).toBe("invalid");
      expect(reason(await svc.addPlanOption(editor, productId, { axis: "type", number: 1, name: "x", planTypeCode: "D0005" }))).toBe("invalid");
    });
    it("(1종,1형)·(2종,1형)·(2종,2형) 명시 등록 — 카테시안 아님 · 중복 거부 · 축 누락 거부", async () => {
      unwrap(await svc.registerPlan(editor, productId, [t1, f1]));
      unwrap(await svc.registerPlan(editor, productId, [t2, f1]));
      const p3 = unwrap(await svc.registerPlan(editor, productId, [f2, t2]));
      expect(p3.options.map((o) => o.axis)).toEqual(["type", "form"]);
      expect(reason(await svc.registerPlan(editor, productId, [f1, t1]))).toBe("duplicate");
      expect(reason(await svc.registerPlan(editor, productId, [t1]))).toBe("invalid");
      expect((await svc.listPlans(productId)).length).toBe(3);
    });
    it("0종 0형 상품은 조합 0건이 정상 — 담보 탑재까지 정상 진행", async () => {
      const p = unwrap(await svc.createProduct(editor, { name: "0종0형 상품" }));
      expect(await svc.listPlans(p.id)).toEqual([]);
      const pc = unwrap(await svc.mount(editor, p.id, DEATH, []));
      expect(pc.name).toBe("일반상해사망");
    });
  });

  describe("담보속성탑재 S2·S3·S4 — 탑재 = 담보 × 속성 조합 · 작명 · 스냅샷", () => {
    it("일반상해사망을 속성 없이, 그리고 부가유형=추가 로 탑재 — 다중 탑재 · 같은 조합 재탑재 거부", async () => {
      const a = unwrap(await svc.mount(editor, productId, DEATH, []));
      pcBasic = a.id;
      expect(a.name).toBe("일반상해사망");
      const b = unwrap(await svc.mount(editor, productId, DEATH, [{ kindCode: "A0002", valueCode: "V02" }]));
      pcAddon = b.id;
      expect(b.name).toBe("일반상해사망 추가");
      expect(reason(await svc.mount(editor, productId, DEATH, [{ kindCode: "A0002", valueCode: "V02" }]))).toBe("duplicate");
      expect(reason(await svc.mount(editor, productId, "aaaaaaaa-0000-4000-8000-000000000099", []))).toBe("notFound");
      expect(reason(await svc.mount(editor, productId, DEATH, [{ kindCode: "A0009", valueCode: "V01" }]))).toBe("invalid");
    });

    it("수술비 × 갱신형 → 「갱신형 수술비」 · 스냅샷: 담보·급부 값 복사 + 마스터 부착(감액기간) 복사", async () => {
      const s = unwrap(await svc.mount(editor, productId, SURGERY, [{ kindCode: "A0001", valueCode: "V01" }]));
      pcSurgery = s.id;
      expect(s.name).toBe("갱신형 수술비");
      const snap = unwrap(await svc.getSnapshot(pcSurgery));
      expect(snap.coverageName).toBe("수술비");
      expect(snap.subCoverages).toHaveLength(1);
      expect(snap.subCoverages[0].benefits).toHaveLength(1);
      const benefitNode = snap.subCoverages[0].benefits[0];
      expect((await readSlots(t.db, { kind: "productCoverage", id: pcSurgery })).get("D0001")).toEqual({ entered: true, value: false });
      expect((await readSlots(t.db, { kind: "productBenefit", id: benefitNode.id })).get("D0003.F02")).toEqual({ entered: true, value: 50 });
      // 스냅샷 값 조회 API
      const values = await svc.getSnapshotValues(pcSurgery);
      expect(values.get(benefitNode.id)?.get("D0003.F02")).toEqual({ entered: true, value: 50 });
    });

    it("마스터 지급률 60% 변경 → 이미 탑재된 「갱신형 수술비」는 50% 유지 · 필드 단위 70% 수정 · 새 탑재분은 60%", async () => {
      await writeSlot(t.db, { kind: "benefit", id: SURGERY_BEN1 }, "D0003", "F02", 60);
      const snap = unwrap(await svc.getSnapshot(pcSurgery));
      const ben = snap.subCoverages[0].benefits[0];
      expect((await svc.getSnapshotValues(pcSurgery)).get(ben.id)?.get("D0003.F02")).toEqual({ entered: true, value: 50 });
      unwrap(await svc.setSnapshotValue(editor, pcSurgery, { kind: "productBenefit", id: ben.id }, "D0003", "F02", 70));
      expect((await svc.getSnapshotValues(pcSurgery)).get(ben.id)?.get("D0003.F02")).toEqual({ entered: true, value: 70 });
      expect(reason(await svc.setSnapshotValue(editor, pcSurgery, { kind: "productBenefit", id: ben.id }, "D0003", "F02", "70%"))).toBe("invalid");
      expect(reason(await svc.setSnapshotValue(editor, pcSurgery, { kind: "productBenefit", id: ben.id }, "D0001", undefined, true))).toBe("invalid"); // 급부에 담보 레벨 구분자
      // 다른 상품담보의 노드는 거부
      expect(reason(await svc.setSnapshotValue(editor, pcBasic, { kind: "productBenefit", id: ben.id }, "D0003", "F02", 1))).toBe("notFound");
      // 선택 노출 감액기간은 스냅샷 부착분이라 값 입력 가능
      unwrap(await svc.setSnapshotValue(editor, pcSurgery, { kind: "productCoverage", id: pcSurgery }, "D0004", undefined, 12));

      const again = unwrap(await svc.mount(editor, productId, SURGERY, [{ kindCode: "A0002", valueCode: "V02" }]));
      const snap2 = unwrap(await svc.getSnapshot(again.id));
      expect((await svc.getSnapshotValues(again.id)).get(snap2.subCoverages[0].benefits[0].id)?.get("D0003.F02")).toEqual({ entered: true, value: 60 });
      unwrap(await svc.unmount(admin, again.id, { confirm: true }));
    });

    it("이름 수동 변경 「갱신형 수술비Ⅱ」 → 규칙 재생성으로 되돌림 · 속성 조합 수정(중복 검사) 후 재생성", async () => {
      unwrap(await svc.renameProductCoverage(editor, pcSurgery, "갱신형 수술비Ⅱ"));
      expect((await svc.getProductCoverage(pcSurgery))?.name).toBe("갱신형 수술비Ⅱ");
      expect(reason(await svc.renameProductCoverage(editor, pcSurgery, " "))).toBe("invalid");
      expect(unwrap(await svc.regenerateName(editor, pcSurgery)).name).toBe("갱신형 수술비");
      expect(reason(await svc.setAttributes(editor, pcAddon, []))).toBe("duplicate"); // 「일반상해사망」과 같은 조합
      const changed = unwrap(await svc.setAttributes(editor, pcAddon, [{ kindCode: "A0002", valueCode: "V02" }, { kindCode: "A0001", valueCode: "V01" }], { regenerateName: true }));
      expect(changed.name).toBe("갱신형 일반상해사망 추가");
      expect(changed.attributes.map((a) => a.kindCode)).toEqual(["A0001", "A0002"]);
      unwrap(await svc.setAttributes(editor, pcAddon, [{ kindCode: "A0002", valueCode: "V02" }], { regenerateName: true }));
    });

    it("syncStructure — 마스터에 세부보장이 추가되면 빈 대응 노드, 사라지면 값 행과 함께 삭제", async () => {
      trees.set(SURGERY, {
        id: SURGERY,
        name: "수술비",
        subCoverages: [
          { id: SURGERY_SUB1, name: "1종수술", order: 0, benefits: [{ id: SURGERY_BEN1, name: "1종수술급부", order: 0 }] },
          { id: SURGERY_SUB2, name: "2종수술", order: 1, benefits: [{ id: SURGERY_BEN2, name: "2종수술급부", order: 0 }] },
        ],
      });
      const r = unwrap(await svc.syncStructure(pcSurgery));
      expect(r.added).toBe(2);
      const snap = unwrap(await svc.getSnapshot(pcSurgery));
      expect(snap.subCoverages.map((s) => s.name)).toEqual(["1종수술", "2종수술"]);
      const newBen = snap.subCoverages[1].benefits[0];
      expect((await svc.getSnapshotValues(pcSurgery)).get(newBen.id)?.size ?? 0).toBe(0); // 빈 값
      // 완결성: 새 급부의 보험금지급 2 필드 + 1종수술급부 면책여부 + 감액기간 아님(입력함)
      const missing = await svc.coverageMissing(pcSurgery);
      expect(missing.map((m) => `${m.ownerName}:${m.path}`).sort()).toEqual(["1종수술급부:D0003.F01", "2종수술급부:D0003.F01", "2종수술급부:D0003.F02"]);

      await writeSlot(t.db, { kind: "productBenefit", id: newBen.id }, "D0003", "F01", true);
      trees.set(SURGERY, { id: SURGERY, name: "수술비", subCoverages: [{ id: SURGERY_SUB1, name: "1종수술", order: 0, benefits: [{ id: SURGERY_BEN1, name: "1종수술급부", order: 0 }] }] });
      const r2 = unwrap(await svc.syncStructure(pcSurgery));
      expect(r2.removed).toBe(2);
      expect((await readSlots(t.db, { kind: "productBenefit", id: newBen.id })).size).toBe(0);
      expect(unwrap(await svc.getSnapshot(pcSurgery)).subCoverages).toHaveLength(1);
    });
  });

  describe("담보속성탑재 S5 — 상품담보별 세목 부착 · 기본계약 지정 (ADR-0011)", () => {
    /** 조합을 축 번호로 찾는다 — 목록 순서(등록 시각)에 기대지 않는다. */
    async function plansByNumbers(): Promise<ProductPlan[]> {
      const key = (p: ProductPlan) => p.options.map((o) => o.number).join(",");
      return (await svc.listPlans(productId)).sort((a, b) => key(a).localeCompare(key(b)));
    }

    it("「갱신형 수술비」에 (1종,1형)·(2종,1형)만 부착 — 상품담보마다 다르다. 다른 상품의 조합·미등록 조합은 거부", async () => {
      const plans = await plansByNumbers(); // [0]=(1,1) [1]=(2,1) [2]=(2,2)
      unwrap(await svc.attachPlan(editor, pcSurgery, plans[0].id));
      unwrap(await svc.attachPlan(editor, pcSurgery, plans[1].id));
      expect((await svc.listAttachedPlans(pcSurgery)).map((p) => p.id)).toEqual([plans[0].id, plans[1].id]);
      expect(await svc.listAttachedPlans(pcBasic)).toEqual([]); // 기본은 미부착
      expect(reason(await svc.attachPlan(editor, pcSurgery, "cccccccc-0000-4000-8000-000000000001"))).toBe("notFound");
      // 세목 해제는 파괴적 (product.detachPlan) — 편집자 forbidden · 관리자 2단
      expect(reason(await svc.detachPlan(editor, pcSurgery, plans[1].id))).toBe("forbidden");
      expect(reason(await svc.detachPlan(admin, pcSurgery, plans[1].id))).toBe("needsConfirmation");
      unwrap(await svc.detachPlan(admin, pcSurgery, plans[1].id, { confirm: true }));
      expect((await svc.listAttachedPlans(pcSurgery)).length).toBe(1);
    });

    it("유효 조합 삭제 — 부착한 상품담보를 영향으로 보여주고 확인 후 연쇄 해제 (D-P5-12)", async () => {
      const plans = await plansByNumbers(); // [0]=(1,1) — 부착 중
      const first = await svc.removePlan(admin, plans[0].id);
      expect(first.ok).toBe(false);
      if (!first.ok && first.rejection.reason === "needsConfirmation") expect(first.rejection.impact.cascade).toEqual(["세목 부착 갱신형 수술비"]);
      unwrap(await svc.removePlan(admin, plans[0].id, { confirm: true }));
      expect(await svc.listAttachedPlans(pcSurgery)).toEqual([]);
      expect((await svc.listPlans(productId)).length).toBe(2);
    });

    it("기본계약 지정 → 보통약관 부착 검사 (미부착은 거부가 아니라 오류 목록, D-P5-13) · 2개째 지정은 거부", async () => {
      required = [
        { level: "coverage", discriminatorCode: "D0001" },
        { level: "coverage", discriminatorCode: "D0004", at: { document: "general", articleTitle: "감액" } },
        { level: "benefit", discriminatorCode: "D0003" },
      ];
      const r = unwrap(await svc.designateBaseContract(editor, productId, pcBasic));
      expect(r.productCoverageId).toBe(pcBasic);
      expect(r.issues.map((i) => [i.kind, i.at.refPath])).toEqual([["notAttached", "D0004"]]);
      expect(reason(await svc.designateBaseContract(editor, productId, pcAddon))).toBe("duplicate");
      expect(unwrap(await svc.checkBaseContract(productId)).map((c) => c.productCoverageId)).toEqual([pcBasic]);
      // 기본계약인 상품담보의 탑재 해제는 거부 (D-P5-7)
      expect(reason(await svc.unmount(admin, pcBasic, { confirm: true }))).toBe("invalid");
    });

    it("기본계약 해제 → 미지정 상태(noBaseContract) · 다른 상품의 상품담보는 지정 불가", async () => {
      unwrap(await svc.releaseBaseContract(editor, productId, pcBasic));
      const check = await svc.checkBaseContract(productId);
      expect(reason(check)).toBe("invalid");
      if (!check.ok && check.rejection.reason === "invalid") expect(check.rejection.issues[0].kind).toBe("noBaseContract");
      const other = unwrap(await svc.createProduct(editor, { name: "다른 상품" }));
      expect(reason(await svc.designateBaseContract(editor, other.id, pcBasic))).toBe("notFound");
      unwrap(await svc.designateBaseContract(editor, productId, pcBasic));
    });
  });

  describe("조립_기획 — 특약 그룹 · 자동 정렬 · 미배치", () => {
    it("그룹 「상해 관련 특별약관」 생성 → 배치 → 그룹 안은 담보→종류→값 순 자동 정렬, 미배치 목록", async () => {
      const g = unwrap(await svc.createGroup(editor, productId, { title: "상해 관련 특별약관" }));
      expect(g.order).toBe(0);
      const g2 = unwrap(await svc.createGroup(editor, productId, { title: "기타" }));
      expect(g2.order).toBe(1);
      expect(reason(await svc.createGroup(editor, productId, { title: "x", generalDocumentId: OTHER_DOC }))).toBe("invalid");
      unwrap(await svc.createGroup(editor, productId, { title: "같은 템플릿", generalDocumentId: GENERAL_DOC }));

      unwrap(await svc.placeInGroup(editor, g.id, pcAddon));
      unwrap(await svc.placeInGroup(editor, g.id, pcBasic));
      const view = await svc.listGroups(productId);
      expect(view[0].members.map((m) => m.name)).toEqual(["일반상해사망", "일반상해사망 추가"]);
      expect((await svc.listUnplaced(productId)).map((m) => m.name)).toEqual(["갱신형 수술비"]);
      // 옮기기: 한 상품담보는 한 그룹에만
      unwrap(await svc.placeInGroup(editor, g2.id, pcBasic));
      expect((await svc.listGroups(productId))[1].members.map((m) => m.id)).toEqual([pcBasic]);
      unwrap(await svc.removeFromGroup(editor, pcBasic));
      expect((await svc.listUnplaced(productId)).length).toBe(2);
      unwrap(await svc.renameGroup(editor, g2.id, "기타 특별약관"));
      unwrap(await svc.reorderGroups(editor, productId, [g2.id, g.id, (await svc.listGroups(productId))[2].id]));
      expect((await svc.listGroups(productId))[0].title).toBe("기타 특별약관");
      unwrap(await svc.deleteGroup(editor, g2.id));
      expect((await svc.listGroups(productId)).length).toBe(2);
    });
  });

  describe("ADR-0017 — 공용조항 옵션 오버라이드", () => {
    it("보통약관 옵션은 상품별, 담보약관은 상품담보별 — 유효 집합 밖은 거부", async () => {
      const o = unwrap(await svc.setOptionOverride(editor, { kind: "product", id: productId }, NODE, "C0001", { style: "A" }));
      expect(o.options).toEqual({ style: "A" });
      unwrap(await svc.setOptionOverride(editor, { kind: "product", id: productId }, NODE, "C0001", { style: "B" }));
      expect((await svc.listOptionOverrides({ kind: "product", id: productId })).map((x) => x.options)).toEqual([{ style: "B" }]);
      unwrap(await svc.setOptionOverride(editor, { kind: "productCoverage", id: pcSurgery }, NODE, "C0001", { style: "A" }));
      optionIssues = [{ kind: "optionInvalid", message: "없는 옵션", at: {} }];
      expect(reason(await svc.setOptionOverride(editor, { kind: "product", id: productId }, NODE, "C0001", { style: "Z" }))).toBe("invalid");
      optionIssues = [];
      expect(reason(await svc.setOptionOverride(editor, { kind: "productCoverage", id: "cccccccc-0000-4000-8000-000000000009" }, NODE, "C0001", {}))).toBe("notFound");
      unwrap(await svc.removeOptionOverride(editor, { kind: "product", id: productId }, NODE, "C0001"));
      expect(await svc.listOptionOverrides({ kind: "product", id: productId })).toEqual([]);
    });
  });

  describe("역할권한 — 파괴적 액션 2단 (탑재 해제 · 속성 삭제 · 상품 삭제)", () => {
    it("탑재 해제: 편집자 forbidden · 관리자 영향(값 행 수) 확인 후 스냅샷 값·세목 부착·오버라이드 연쇄 삭제", async () => {
      expect(reason(await svc.unmount(editor, pcSurgery))).toBe("forbidden");
      const first = await svc.unmount(admin, pcSurgery);
      expect(first.ok).toBe(false);
      if (!first.ok && first.rejection.reason === "needsConfirmation") {
        expect(first.rejection.impact.valueRowsLost).toBeGreaterThanOrEqual(3); // D0001 · D0004 · 급부 F02
        expect(first.rejection.impact.cascade).toContain("옵션 오버라이드 1건");
      }
      unwrap(await svc.unmount(admin, pcSurgery, { confirm: true }));
      expect(await svc.getProductCoverage(pcSurgery)).toBeUndefined();
      expect((await readSlots(t.db, { kind: "productCoverage", id: pcSurgery })).size).toBe(0);
      expect(await svc.listOptionOverrides({ kind: "productCoverage", id: pcSurgery })).toEqual([]);
    });

    it("담보속성 유효값 삭제: 사용 중인 상품담보를 깨질 참조로 보여준다 · 종류 삭제도 같은 결 (사용처는 남아 깨진 참조가 된다)", async () => {
      const first = await svc.removeAttributeValue(admin, "A0002", "V02");
      expect(first.ok).toBe(false);
      if (!first.ok && first.rejection.reason === "needsConfirmation") {
        expect(first.rejection.impact.brokenRefs).toEqual([{ document: "special", ownerId: pcAddon, ownerName: "일반상해사망 추가" }]);
      }
      expect(reason(await svc.removeAttributeValue(editor, "A0002", "V02"))).toBe("forbidden");
      unwrap(await svc.removeAttributeValue(admin, "A0002", "V01", { confirm: true }));
      expect((await svc.getAttributeKind("A0002"))?.values.map((v) => v.code)).toEqual(["V02"]);
      const kindFirst = await svc.removeAttributeKind(admin, "A0002");
      if (!kindFirst.ok && kindFirst.rejection.reason === "needsConfirmation") {
        expect(kindFirst.rejection.impact.cascade).toEqual(["값 추가(V02)"]);
        expect(kindFirst.rejection.impact.brokenRefs).toHaveLength(1);
      }
      unwrap(await svc.removeAttributeKind(admin, "A0002", { confirm: true }));
      expect(await svc.getAttributeKind("A0002")).toBeUndefined();
      expect((await svc.getProductCoverage(pcAddon))?.attributes).toEqual([{ kindCode: "A0002", valueCode: "V02" }]); // 깨진 참조로 남는다
    });

    it("세목 선택지 삭제(파괴적): 조합·값 연쇄 · 상품 삭제: 상품담보·스냅샷 값·세목·그룹·오버라이드 전부 연쇄", async () => {
      const opts = await svc.listPlanOptions(productId);
      const t1 = opts.find((o) => o.axis === "type" && o.number === 1)!;
      expect(reason(await svc.removePlanOption(editor, t1.id))).toBe("forbidden");
      unwrap(await svc.removePlanOption(admin, t1.id, { confirm: true }));
      expect((await svc.listPlans(productId)).length).toBe(2); // (1종,1형) 은 이미 삭제됐고 남은 조합은 2종뿐

      const first = await svc.deleteProduct(admin, productId);
      expect(first.ok).toBe(false);
      if (!first.ok && first.rejection.reason === "needsConfirmation") {
        expect(first.rejection.impact.cascade).toContain("상품담보 일반상해사망");
        expect(first.rejection.impact.valueRowsLost).toBeGreaterThan(0);
      }
      unwrap(await svc.deleteProduct(admin, productId, { confirm: true }));
      expect(await svc.getProduct(productId)).toBeUndefined();
      expect((await readSlots(t.db, { kind: "product", id: productId })).size).toBe(0);
      expect((await readSlots(t.db, { kind: "productCoverage", id: pcBasic })).size).toBe(0);
    });
  });
});
