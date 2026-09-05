import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Clause } from "@/domain/clause";
import type { Coverage } from "@/domain/coverage";
import { nodeBuilders } from "@/domain/document";
import { nodeKey } from "@/domain/refs";
import type { Actor, Id } from "@/domain/types";

import { insertClause } from "@/db/repo/clause";
import { insertAppendix, insertDocument, type DocumentRecord } from "@/db/repo/document";
import { insertAttributeKind, insertProduct, insertProductCoverage, upsertOverride } from "@/db/repo/product";
import { readSlots, writeSlot } from "@/db/repo/values";
import { createTestDb, type TestDb } from "@/db/test-utils";
import { createCatalogService } from "./catalog";
import { createCoverageService } from "./coverage";
import { attributeRefSource, catalogImpactSource, clauseUsageSource, coverageUsageSource, createRefsService, documentUsageSource, type RefsService } from "./refs";
import { contextualDb } from "./txContext";

const editor: Actor = { userId: "00000000-0000-4000-8000-000000000002", role: "editor" };

function unwrap<T>(r: { ok: true; value: T } | { ok: false; rejection: unknown }): T {
  if (!r.ok) throw new Error(`기대: ok, 실제: ${JSON.stringify(r.rejection)}`);
  return r.value;
}

describe("refs 서비스 · 주입 소스 (PGlite)", () => {
  let t: TestDb;
  let refs: RefsService;
  let surgery: Coverage;
  let general: DocumentRecord;
  let special: DocumentRecord;
  let productId: Id;
  let pcId: Id;
  const b = nodeBuilders();
  const artPay = b.article("보험금의 지급사유", [
    b.paragraph([
      b.text("회사는 피보험자가 "),
      b.inlineCond([b.inlineBranch("D0001 = true and attr.A0001 = 'V01'", [b.text("최초계약일")]), b.inlineBranch(undefined, [b.text("계약일")])]),
      b.text(" 이후 평균공시이율 "),
      b.slot("D0004"),
    ]),
  ]);
  const artExempt = b.article("보험금을 지급하지 않는 사유", [b.paragraph([b.text("지급률 "), b.slot("D0003.F02")])]);
  const exemptBlock = b.condBlock([b.branch("D0005 = true", [artExempt])]);
  const clauseBlock = b.clauseBlock("C001", { O01: "death" });
  const artLapse = b.article("특별약관의 소멸", [b.paragraph([b.text("이 특별약관은 다음의 경우 소멸합니다.")]), clauseBlock]);
  const gPay = b.article("보험금의 지급사유", [b.paragraph([b.text("기본계약의 지급사유에 따라")])]);
  const gApply = b.article("준용규정", [b.paragraph([b.text("관계 법령을 따릅니다.")])]);
  const gNotice = b.condBlock([b.branch("D0002 = 'V02'", [b.article("간편고지 특칙", [b.paragraph([b.text("간편심사")])])])]);
  const clauseInline = b.clauseInline("C002", {});
  const artApply = b.article("준용규정", [b.paragraph([b.articleRef(gPay.id, "general"), b.articleRef(artPay.id, "self"), b.appendixRef("APX_BURN"), clauseInline])], { linkedArticleId: gApply.id });

  beforeAll(async () => {
    t = await createTestDb();
    const db = contextualDb(t.db);
    refs = createRefsService(db);
    const catalog = createCatalogService(db);
    unwrap(await catalog.create(editor, { kind: "scalar", label: "갱신여부", level: "coverage", type: { kind: "boolean" }, alwaysExposed: true })); // D0001
    unwrap(await catalog.createEnum(editor, { label: "고지유형", values: [{ label: "일반심사" }, { label: "간편심사" }] })); // E0001 V01 V02
    unwrap(await catalog.create(editor, { kind: "scalar", label: "고지유형", level: "product", type: { kind: "enum", enumCode: "E0001" }, alwaysExposed: true })); // D0002
    unwrap(await catalog.create(editor, { kind: "struct", label: "보험금지급", level: "benefit", alwaysExposed: true, fields: [{ label: "면책여부", type: { kind: "boolean" } }, { label: "지급률", type: { kind: "number" } }] })); // D0003
    unwrap(await catalog.create(editor, { kind: "const", label: "평균공시이율", value: "2.5%" })); // D0004
    unwrap(await catalog.create(editor, { kind: "derived", label: "면책여부합", level: "coverage", expression: "any(D0003.F01)" })); // D0005
    unwrap(await catalog.create(editor, { kind: "scalar", label: "수술급여기준", level: "coverage", type: { kind: "string" } })); // D0006 선택 노출
    unwrap(await catalog.create(editor, { kind: "scalar", label: "아무도 안 쓰는 것", level: "coverage", type: { kind: "string" } })); // D0007

    const coverage = createCoverageService(db);
    surgery = unwrap(await coverage.create(editor, { name: "수술비", subCoverageName: "1종수술", benefitName: "수술보험금" }));
    unwrap(await coverage.attach(editor, { level: "coverage", id: surgery.id }, "D0006"));

    for (const a of [{ code: "APX_DISABILITY", name: "장해분류표", description: "" }, { code: "APX_BURN", name: "화상 분류표", description: "" }]) await insertAppendix(db, a, editor.userId);
    const clauses: Clause[] = [
      {
        code: "C001",
        label: "특별약관의 소멸",
        description: "",
        mode: "block",
        body: [{ id: "c1-p", kind: "paragraph", children: [{ id: "c1-t", kind: "text", text: "소멸합니다. " }, { id: "c1-o", kind: "optionSlot", optionCode: "O01" }] }],
        options: [{ code: "O01", label: "어조", order: 0, values: [{ code: "death", label: "사망", body: [{ id: "c1-v1", kind: "text", text: "사망 시" }], order: 0 }, { code: "lapse", label: "해지", body: [], order: 1 }] }],
        required: { discriminators: [], attributes: [] },
      },
      {
        code: "C002",
        label: "준용규정",
        description: "",
        mode: "inline",
        body: [
          { id: "c2-c", kind: "inlineCond", branches: [{ id: "c2-b", when: "D0006 = '기준A'", children: [{ id: "c2-t", kind: "text", text: "기준A 적용" }] }] },
          { id: "c2-a", kind: "appendixRef", appendixCode: "APX_BURN" },
        ],
        options: [],
        required: { discriminators: ["D0006"], attributes: [] },
      },
    ];
    for (const c of clauses) await insertClause(db, c, editor.userId);

    general = await insertDocument(db, { kind: "general", title: "알파Plus 보통약관", tree: b.document("알파Plus 보통약관", [gPay, gNotice, gApply]) }, editor.userId);
    special = await insertDocument(db, { kind: "special", ownerId: surgery.id, title: "수술비 특별약관", generalDocumentId: general.id, tree: b.document("수술비 특별약관", [artPay, exemptBlock, artLapse, artApply]) }, editor.userId);
    unwrap(await coverage.setDocument(editor, surgery.id, special.id));

    await insertAttributeKind(db, { code: "A0001", label: "갱신유형", order: 0, values: [{ code: "V01", label: "갱신형", order: 0, naming: {} }, { code: "V02", label: "비갱신형", order: 1, naming: {} }] }, editor.userId);
    const product = await insertProduct(db, { name: "알파Plus", generalDocumentId: general.id }, editor.userId);
    productId = product.id;
    const pc = await insertProductCoverage(db, { productId, coverageId: surgery.id, coverageName: "수술비", name: "갱신형 수술비", attributes: [{ kindCode: "A0001", valueCode: "V01" }], combinationKey: "k" }, editor.userId);
    pcId = pc.id;
    await upsertOverride(db, { kind: "productCoverage", id: pcId }, clauseBlock.id, "C001", { O01: "lapse" }, editor.userId);
    await writeSlot(db, { kind: "product", id: productId }, "D0002", undefined, "V02");
  });
  afterAll(async () => {
    await t.close();
  });

  describe("관계정보 (구분자정의 S6 · 문면_기획 「관계정보 뷰」)", () => {
    it("구분자 「갱신여부」 조회 → 참조하는 문면의 좌표(문서 · 담보 · 조 · 노드 경로)가 나온다", async () => {
      const u = await refs.usages({ kind: "discriminator", code: "D0001" });
      expect(u).toHaveLength(1);
      expect(u[0].at).toMatchObject({ document: "special", ownerId: surgery.id, ownerName: "수술비 특별약관", articleId: artPay.id, articleTitle: "보험금의 지급사유", refPath: "D0001" });
    });

    it("공용조항 관계정보 — 역방향(참조 문서·옵션 선택) · 옵션별 오버라이드 사용처 (ADR-0017 결정 4)", async () => {
      const v = await refs.relation({ kind: "clause", code: "C001" });
      expect(v.node?.label).toBe("특별약관의 소멸");
      expect(v.incoming.map((e) => [e.via, e.at.articleTitle])).toEqual([["clauseRef", "특별약관의 소멸"], ["optionSelect", "특별약관의 소멸"]]);
      expect(v.overrides).toEqual([expect.objectContaining({ from: { kind: "productCoverage", id: pcId }, through: { kind: "article", documentId: special.id, articleId: artLapse.id }, at: expect.objectContaining({ document: "special", ownerId: pcId, ownerName: "갱신형 수술비", nodePath: [clauseBlock.id], refPath: "C001.O01" }) })]);
    });

    it("무결성 — 고아(미참조 구분자 · 별표) · 순환 없음 · 깨진 참조 없음", async () => {
      const r = await refs.integrity();
      expect(r.orphans.map((n) => nodeKey(n.key))).toEqual(["discriminator:D0007", "appendix:APX_DISABILITY"]);
      expect(r.cycles).toEqual([]);
      expect(r.broken).toEqual([]);
      expect(r.issues).toEqual([]);
    });
  });

  describe("catalogImpactSource — 구분자 삭제·enum 값 삭제의 영향 (구분자_기획 변경·삭제 규칙)", () => {
    it("선택 노출 구분자의 깨질 참조 = 공용조항 식 + 담보 부착", async () => {
      const src = catalogImpactSource(contextualDb(t.db));
      const broken = await src.findBrokenRefs({ kind: "discriminator", code: "D0006" });
      expect(broken).toEqual([
        expect.objectContaining({ document: "clause", ownerId: "C002", ownerName: "준용규정", nodePath: ["c2-c", "c2-b"], refPath: "D0006" }),
        expect.objectContaining({ document: "coverageMaster", ownerId: surgery.id, ownerName: "수술비", refPath: "D0006" }),
      ]);
      expect(await src.findBrokenRefs({ kind: "field", code: "D0003", fieldCode: "F02" })).toEqual([expect.objectContaining({ document: "special", articleTitle: "보험금을 지급하지 않는 사유", refPath: "D0003.F02" })]);
    });

    it("enum 값 V02 — 리터럴로 비교하는 조건식이 깨질 참조, 그 값을 고른 값 행만 세고 지운다", async () => {
      const src = catalogImpactSource(contextualDb(t.db));
      expect(await src.findBrokenRefs({ kind: "enumValue", enumCode: "E0001", valueCode: "V02" })).toEqual([expect.objectContaining({ document: "general", ownerId: general.id, refPath: "D0002" })]);
      expect(await src.findBrokenRefs({ kind: "enumValue", enumCode: "E0001", valueCode: "V01" })).toEqual([]);
      expect(await src.countValueRows({ kind: "enumValue", enumCode: "E0001", valueCode: "V02" })).toBe(1);
      expect(await src.countValueRows({ kind: "enumValue", enumCode: "E0001", valueCode: "V01" })).toBe(0);
      expect(await src.countValueRows({ kind: "enum", enumCode: "E0001" })).toBe(1);
      await src.purgeValueRows({ kind: "enumValue", enumCode: "E0001", valueCode: "V02" });
      expect((await readSlots(t.db, { kind: "product", id: productId })).size).toBe(0);
    });

    it("트랜잭션 안에서 불러도 교착하지 않는다 (contextualDb)", async () => {
      const db = contextualDb(t.db);
      const src = catalogImpactSource(db);
      const n = await db.transaction(async () => (await src.findBrokenRefs({ kind: "discriminator", code: "D0001" })).length);
      expect(n).toBe(1);
    });
  });

  describe("coverageUsageSource — 부착 해제 · 노드 삭제가 깨뜨릴 문면 사용처", () => {
    const src = () => coverageUsageSource(contextualDb(t.db));

    it("부착 해제: 공용조항을 거쳐 읽는 자리도 사용처다 (ADR-0010 늦은 바인딩) — 좌표는 문서의 참조 노드", async () => {
      const u = await src().findUsages({ kind: "detach", coverageId: surgery.id, owner: { level: "coverage", id: surgery.id }, discriminatorCode: "D0006" });
      expect(u).toEqual([expect.objectContaining({ document: "special", ownerId: surgery.id, articleTitle: "준용규정", refPath: "D0006" })]);
      expect(u[0].nodePath?.at(-1)).toBe(clauseInline.id);
      expect(await src().findUsages({ kind: "detach", coverageId: surgery.id, owner: { level: "coverage", id: surgery.id }, discriminatorCode: "D0001" })).toHaveLength(1);
      expect(await src().findUsages({ kind: "detach", coverageId: surgery.id, owner: { level: "coverage", id: surgery.id }, discriminatorCode: "D0007" })).toEqual([]);
    });

    it("급부 삭제: 급부 레벨 자리를 읽는 슬롯 · 파생을 거친 집계가 사용처", async () => {
      const benefit = surgery.subCoverages[0].benefits[0];
      const u = await src().findUsages({ kind: "deleteNode", coverageId: surgery.id, node: { level: "benefit", id: benefit.id } });
      expect(u.map((c) => c.refPath).sort()).toEqual(["D0003.F01", "D0003.F02"]);
      expect(u.find((c) => c.refPath === "D0003.F01")?.nodePath).toEqual([special.tree.id, exemptBlock.id, exemptBlock.branches[0].id]);
    });

    it("담보 삭제: 문면 문서 자체와 탑재한 상품담보가 사용처", async () => {
      const u = await src().findUsages({ kind: "deleteNode", coverageId: surgery.id, node: { level: "coverage", id: surgery.id } });
      expect(u).toEqual([
        { document: "special", ownerId: surgery.id, ownerName: "수술비 특별약관" },
        { document: "special", ownerId: pcId, ownerName: "갱신형 수술비" },
      ]);
    });
  });

  describe("clauseUsageSource — 참조 문서(ownerKind coverage/general) + 옵션 선택", () => {
    it("C001 은 담보약관 1건이 참조하고 옵션 O01=death 를 골랐다", async () => {
      const u = await clauseUsageSource(contextualDb(t.db)).documentsReferencing("C001");
      expect(u).toEqual([{ documentId: special.id, ownerKind: "coverage", ownerId: surgery.id, ownerName: "수술비 특별약관", refNodeId: clauseBlock.id, selection: { O01: "death" } }]);
      expect((await clauseUsageSource(contextualDb(t.db)).documentsReferencing("C002"))[0].selection).toEqual({});
      expect(await clauseUsageSource(contextualDb(t.db)).documentsReferencing("C999")).toEqual([]);
    });
  });

  describe("documentUsageSource — 문서 서비스가 못 보는 외부 사용처", () => {
    it("보통약관: 상품 템플릿 선택 · 담보약관: 담보 문서 연결 + 옵션 오버라이드 · 별표: 공용조항 본문 참조", async () => {
      const src = documentUsageSource();
      expect(await src.documentUsages(t.db, general.id)).toEqual([{ document: "product", ownerId: productId, ownerName: "알파Plus" }]);
      expect(await src.documentUsages(t.db, special.id)).toEqual([
        { document: "coverageMaster", ownerId: surgery.id, ownerName: "수술비" },
        expect.objectContaining({ document: "special", ownerId: pcId, nodePath: [clauseBlock.id], refPath: "C001.O01" }),
      ]);
      expect(await src.appendixUsages(t.db, "APX_BURN")).toEqual([{ document: "clause", ownerId: "C002", ownerName: "준용규정", nodePath: ["c2-a"] }]);
      expect(await src.appendixUsages(t.db, "APX_DISABILITY")).toEqual([]);
    });
  });

  describe("attributeRefSource — 식이 읽는 담보속성 사용처 (조합 사용처는 상품 서비스가 따로 센다)", () => {
    it("종류 → 식 참조 좌표(중복 없이) · 유효값 → 그 값을 리터럴로 비교하는 식만", async () => {
      const src = attributeRefSource(contextualDb(t.db));
      const kind = await src.findExpressionRefs("A0001");
      expect(kind).toEqual([expect.objectContaining({ document: "special", articleTitle: "보험금의 지급사유", refPath: "attr.A0001" })]);
      expect(await src.findExpressionRefs("A0001", "V01")).toHaveLength(1);
      expect(await src.findExpressionRefs("A0001", "V02")).toEqual([]);
    });
  });
});
