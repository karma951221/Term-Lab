import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Coverage } from "@/domain/coverage";
import { nodeBuilders } from "@/domain/document";
import type { Actor, Coordinate, Id, Rejection } from "@/domain/types";

import { createTestDb, type TestDb } from "@/db/test-utils";
import { createServices, type Services } from "./container";
import type { DocumentRecord } from "./document";

const admin: Actor = { userId: "00000000-0000-4000-8000-000000000001", role: "admin" };
const editor: Actor = { userId: "00000000-0000-4000-8000-000000000002", role: "editor" };

function unwrap<T>(r: { ok: true; value: T } | { ok: false; rejection: unknown }): T {
  if (!r.ok) throw new Error(`기대: ok, 실제: ${JSON.stringify(r.rejection)}`);
  return r.value;
}
function rejection(r: { ok: boolean; rejection?: Rejection }): Rejection {
  if (r.ok || !r.rejection) throw new Error("기대: 거부, 실제: ok");
  return r.rejection;
}
function impactOf(r: { ok: boolean; rejection?: Rejection }) {
  const rj = rejection(r);
  if (rj.reason !== "needsConfirmation") throw new Error(`기대: needsConfirmation, 실제: ${rj.reason}`);
  return rj.impact;
}

/**
 * 관통 흐름 — 조립 루트가 모든 주입을 실제 구현으로 연결했는지, 한 DB 위에서 영역을 가로질러 확인한다.
 * 구분자 채번 → 담보 생성·부착·값 → 공용조항 → 담보약관의 공용조항 참조(부착 제안 → 수락) → 상품·담보속성·탑재 →
 * 관계정보 역조회 → 구분자 삭제(needsConfirmation · 편집자 forbidden) → 각 영역 파괴적 액션의 영향에 다른 영역 사용처가 실린다.
 */
describe("container — createServices 관통 (PGlite)", () => {
  let t: TestDb;
  let s: Services;
  let death: Coverage;
  let general: DocumentRecord;
  let special: DocumentRecord;
  let productId: Id;
  let pcId: Id;
  const b = nodeBuilders();
  const artPay = b.article("보험금의 지급사유", [
    b.paragraph([
      b.text("회사는 피보험자가 "),
      b.inlineCond([b.inlineBranch("D0001 = true", [b.text("최초계약일")]), b.inlineBranch(undefined, [b.text("계약일")])]),
      b.text(" 이후 평균공시이율 "),
      b.slot("D0004"),
    ]),
  ]);
  const clauseBlock = b.clauseBlock("C0001", { O01: "V01" });
  const artLapse = b.article("특별약관의 소멸", [b.paragraph([b.text("이 특별약관은 다음의 경우 소멸합니다.")]), clauseBlock]);
  const gApply = b.article("준용규정", [b.paragraph([b.text("이 약관에서 정하지 않은 사항은 관계 법령을 따릅니다.")])]);
  const gRenew = b.condBlock([b.branch("D0001 = true", [b.article("갱신 특칙", [b.paragraph([b.text("갱신형 계약의 특칙")])])])]);

  beforeAll(async () => {
    t = await createTestDb();
    s = createServices(t.db);
  });
  afterAll(async () => {
    await t.close();
  });

  it("구분자정의 S1·S3·S4·S5 — 채번: 갱신여부 D0001 · 수술급여기준 D0002(선택 노출) · 보험금지급 D0003 · 평균공시이율 D0004 · 면책여부합 D0005 · 고지유형 D0006", async () => {
    expect(unwrap(await s.catalog.create(editor, { kind: "scalar", label: "갱신여부", level: "coverage", type: { kind: "boolean" }, alwaysExposed: true })).code).toBe("D0001");
    expect(unwrap(await s.catalog.create(editor, { kind: "scalar", label: "수술급여기준", level: "coverage", type: { kind: "string" } })).code).toBe("D0002");
    unwrap(await s.catalog.create(editor, { kind: "struct", label: "보험금지급", level: "benefit", alwaysExposed: true, fields: [{ label: "면책여부", type: { kind: "boolean" } }, { label: "지급률", type: { kind: "number" } }] }));
    unwrap(await s.catalog.create(editor, { kind: "const", label: "평균공시이율", value: "2.5%" }));
    unwrap(await s.catalog.create(editor, { kind: "derived", label: "면책여부합", level: "coverage", expression: "any(D0003.F01)" }));
    // 별칭형 파생은 파서 기반 판정으로 거부된다 (괄호를 씌워도)
    expect(rejection(await s.catalog.create(editor, { kind: "derived", label: "별칭", level: "coverage", expression: "(D0001)" })).reason).toBe("invalid");
    const e = unwrap(await s.catalog.createEnum(editor, { label: "고지유형", values: [{ label: "일반심사" }, { label: "간편심사" }] }));
    unwrap(await s.catalog.create(editor, { kind: "scalar", label: "고지유형", level: "product", type: { kind: "enum", enumCode: e.code }, alwaysExposed: true }));
  });

  it("담보트리·담보값입력 — 담보 「일반상해사망」 생성 · 담보 값 · 급부 값", async () => {
    death = unwrap(await s.coverage.create(editor, { name: "일반상해사망", benefitName: "사망보험금" }));
    unwrap(await s.coverage.writeValue(editor, { level: "coverage", id: death.id }, "D0001", false));
    const benefit = death.subCoverages[0].benefits[0];
    unwrap(await s.coverage.writeValue(editor, { level: "benefit", id: benefit.id }, "D0003.F01", false));
    unwrap(await s.coverage.writeValue(editor, { level: "benefit", id: benefit.id }, "D0003.F02", 100));
    expect(unwrap(await s.coverage.completeness(death.id))).toEqual([]);
  });

  it("공용조항 S1 — 「특별약관의 소멸」 C0001: 옵션(어조) + 선택 노출 구분자 D0002 를 읽는 조건 → 요구 구분자 자동 추출", async () => {
    const c = unwrap(
      await s.clause.create(editor, {
        label: "특별약관의 소멸",
        mode: "block",
        body: [
          { id: "c-p", kind: "paragraph", children: [{ id: "c-t", kind: "text", text: "소멸합니다. " }, { id: "c-o", kind: "optionSlot", optionCode: "O01" }] },
          { id: "c-cb", kind: "condBlock", branches: [{ id: "c-br", when: "D0002 = '기준A'", children: [{ id: "c-p2", kind: "paragraph", children: [{ id: "c-t2", kind: "text", text: "기준A 특칙" }] }] }] },
        ],
        options: [{ label: "어조", values: [{ label: "사망", body: [{ id: "c-v1", kind: "text", text: "사망 시" }] }, { label: "해지", body: [{ id: "c-v2", kind: "text", text: "해지 시" }] }] }],
      }),
    );
    expect(c.code).toBe("C0001");
    expect(c.options[0].values.map((v) => v.code)).toEqual(["V01", "V02"]);
    expect(c.required.discriminators).toEqual(["D0002"]);
  });

  it("문면작성 — 보통약관 마스터 + 담보약관(대응 보통약관 지정) 작성 · 식 타입은 카탈로그+담보속성 카탈로그로 검사된다", async () => {
    general = unwrap(await s.document.createGeneral(editor, "알파Plus 보통약관"));
    general = unwrap(await s.document.apply(editor, general.id, [{ type: "insert", node: gApply, at: { parentId: general.tree.id } }, { type: "insert", node: gRenew, at: { parentId: general.tree.id } }]));
    special = unwrap(await s.document.createSpecial(editor, death.id, "일반상해사망 특별약관"));
    unwrap(await s.document.setGeneralDocument(editor, special.id, general.id));
    unwrap(await s.coverage.setDocument(editor, death.id, special.id));
    special = unwrap(await s.document.apply(editor, special.id, [{ type: "insert", node: artPay, at: { parentId: special.tree.id } }]));
    // 담보속성 카탈로그가 없으면 attr.A0001 은 깨진 참조 → 저장 거부
    const badAttr = b.article("x", [b.paragraph([b.inlineCond([b.inlineBranch("attr.A0001 = 'V01'", [b.text("갱신형")])])])]);
    expect(rejection(await s.document.apply(editor, special.id, [{ type: "insert", node: badAttr, at: { parentId: special.tree.id } }])).reason).toBe("invalid");
  });

  it("공용조항 S2 — 참조 추가 시 부착 검사: 미부착 D0002 를 제안 → 수락하면 coverage 서비스(Attacher)가 그 자리에서 부착 → 참조 성립", async () => {
    const check = unwrap(await s.clause.checkReference("C0001", { kind: "coverage", id: death.id }));
    expect(check.missing).toEqual(["D0002"]);
    expect(unwrap(await s.clause.acceptAttachments(editor, "C0001", { kind: "coverage", id: death.id }))).toEqual(["D0002"]);
    expect(unwrap(await s.coverage.forms({ level: "coverage", id: death.id })).map((f) => f.def.code)).toEqual(["D0001", "D0002"]);
    unwrap(await s.coverage.writeValue(editor, { level: "coverage", id: death.id }, "D0002", "기준A"));
    // 옵션 미선택 참조는 저장 시점에 거부된다 (ADR-0017) — 게이트가 공용조항 정의로 검사
    const unselected = b.article("y", [b.clauseBlock("C0001", {})]);
    const r = await s.document.apply(editor, special.id, [{ type: "insert", node: unselected, at: { parentId: special.tree.id } }]);
    const rj = rejection(r);
    expect(rj.reason === "invalid" && rj.issues[0].kind).toBe("optionUnselected");
    special = unwrap(await s.document.apply(editor, special.id, [{ type: "insert", node: artLapse, at: { parentId: special.tree.id } }]));
    expect(await s.document.requiredDiscriminators(special.id)).toEqual(["D0001", "D0004", "D0002"]);
    expect(unwrap(await s.clause.recheck("C0001"))).toEqual([]);
  });

  it("담보속성탑재·세목구성 — 담보속성 「갱신유형」 · 상품 · 탑재(마스터 트리 = coverage 서비스) · 기본계약 부착 검사(보통약관 요구 참조 = document 서비스) · 옵션 오버라이드(유효 집합 = clause 서비스)", async () => {
    const kind = unwrap(await s.product.createAttributeKind(editor, { label: "갱신유형" }));
    unwrap(await s.product.addAttributeValue(editor, kind.code, { label: "갱신형", naming: { prefix: "갱신형 " } }));
    unwrap(await s.product.addAttributeValue(editor, kind.code, { label: "비갱신형" }));
    // 이제 attr.A0001 = 'V01' 은 통과, 유효값 밖 'V99' 는 거부 — TypeResolver 가 담보속성 카탈로그를 본다
    const okAttr = b.article("갱신 문구", [b.paragraph([b.inlineCond([b.inlineBranch("attr.A0001 = 'V01'", [b.text("갱신형")])])])]);
    special = unwrap(await s.document.apply(editor, special.id, [{ type: "insert", node: okAttr, at: { parentId: special.tree.id } }]));
    const badValue = b.article("z", [b.paragraph([b.inlineCond([b.inlineBranch("attr.A0001 = 'V99'", [b.text("?")])])])]);
    expect((await s.document.apply(editor, special.id, [{ type: "insert", node: badValue, at: { parentId: special.tree.id } }])).ok).toBe(false);

    const product = unwrap(await s.product.createProduct(editor, { name: "알파Plus(축약)" }));
    productId = product.id;
    expect(rejection(await s.product.setGeneralDocument(editor, productId, special.id)).reason).toBe("notFound"); // 담보약관은 템플릿이 아니다 (게이트)
    unwrap(await s.product.setGeneralDocument(editor, productId, general.id));
    const pc = unwrap(await s.product.mount(editor, productId, death.id, [{ kindCode: "A0001", valueCode: "V01" }]));
    pcId = pc.id;
    expect(pc.name).toBe("갱신형 일반상해사망");
    const snap = unwrap(await s.product.getSnapshot(pcId));
    expect(snap.subCoverages[0].benefits[0].name).toBe("사망보험금");
    expect((await s.product.getSnapshotValues(pcId)).get(pcId)?.get("D0002")).toEqual({ entered: true, value: "기준A" });
    // 기본계약 지정 — 보통약관이 요구하는 담보 레벨 구분자 D0001 은 무조건 노출이라 부착 검사 통과
    expect(unwrap(await s.product.designateBaseContract(editor, productId, pcId)).issues).toEqual([]);
    // 옵션 오버라이드 — 유효 집합 안에서만
    unwrap(await s.product.setOptionOverride(editor, { kind: "productCoverage", id: pcId }, clauseBlock.id, "C0001", { O01: "V02" }));
    expect(rejection(await s.product.setOptionOverride(editor, { kind: "productCoverage", id: pcId }, clauseBlock.id, "C0001", { O01: "V09" })).reason).toBe("invalid");
    expect(rejection(await s.product.setOptionOverride(editor, { kind: "productCoverage", id: pcId }, clauseBlock.id, "C9999", {})).reason).toBe("invalid");
  });

  it("구분자정의 S6-1 — 관계정보 뷰에서 「갱신여부」 조회 → 참조하는 문면(담보약관·보통약관)·저장 값 소유 실체가 나온다", async () => {
    const u = await s.refs.usages({ kind: "discriminator", code: "D0001" });
    expect(u.map((e) => [e.at.document, e.at.articleTitle])).toEqual([
      ["general", undefined], // 조 자리 조건 블록 — 조 밖 (문서 목록 순: 종류 · 제목)
      ["special", "보험금의 지급사유"],
    ]);
    expect(u[1].at).toMatchObject({ ownerId: death.id, ownerName: "일반상해사망 특별약관", articleId: artPay.id, refPath: "D0001" });
    const v = await s.refs.relation({ kind: "clause", code: "C0001" });
    expect(v.incoming.map((e) => e.via)).toEqual(["clauseRef", "optionSelect"]);
    expect(v.overrides.map((e) => [e.from.kind, e.at.ownerName, e.at.refPath])).toEqual([["productCoverage", "갱신형 일반상해사망", "C0001.O01"]]);
    expect(v.outgoing.map((e) => e.at.refPath)).toEqual(["D0002"]);
    const integrity = await s.refs.integrity();
    expect(integrity.broken).toEqual([]);
    expect(integrity.cycles).toEqual([]);
    expect(integrity.orphans.map((n) => n.label)).toEqual(["면책여부합", "고지유형"]); // 아직 아무 문면도 읽지 않는 구분자 (파생 포함)
  });

  it("구분자정의 S6-2 · 역할권한 S1·S4 — 편집자의 삭제는 forbidden · 관리자의 삭제 시도는 영향 목록(값 행 · 깨질 참조)으로 확인을 요구한다", async () => {
    expect(rejection(await s.catalog.remove(editor, "D0002"))).toEqual({ reason: "forbidden", role: "editor", action: "catalog.delete" });
    const impact = impactOf(await s.catalog.remove(admin, "D0002"));
    expect(impact.valueRowsLost).toBe(2); // 담보 마스터 값 + 탑재 스냅샷 값
    const kinds = impact.brokenRefs.map((c: Coordinate) => [c.document, c.ownerName]);
    expect(kinds).toEqual([
      ["clause", "특별약관의 소멸"], // 공용조항 식
      ["coverageMaster", "일반상해사망"], // 담보 부착
      ["special", "갱신형 일반상해사망"], // 스냅샷 부착
    ]);
    expect(impact.brokenRefs[0]).toMatchObject({ ownerId: "C0001", nodePath: ["c-cb", "c-br"], refPath: "D0002" });
  });

  it("역할권한 S3 — 다른 영역의 파괴적 액션 영향에도 그래프 사용처가 실린다: 담보 삭제 · 공용조항 삭제 · 보통약관 삭제 · 담보속성 유효값 삭제", async () => {
    // 담보 삭제 → 문면 문서 · 탑재한 상품담보
    const cov = impactOf(await s.coverage.remove(admin, death.id));
    expect(cov.brokenRefs).toEqual([
      { document: "special", ownerId: death.id, ownerName: "일반상해사망 특별약관" },
      { document: "special", ownerId: pcId, ownerName: "갱신형 일반상해사망" },
    ]);
    expect(cov.valueRowsLost).toBe(4);
    // 급부 삭제는 최소 구조 위반 — 관리자도 거부
    expect(rejection(await s.coverage.removeBenefit(admin, death.subCoverages[0].benefits[0].id)).reason).toBe("minimumStructure");
    // 공용조항 삭제 → 참조 문서 (참조 노드 좌표)
    const cl = impactOf(await s.clause.remove(admin, "C0001"));
    expect(cl.brokenRefs).toEqual([{ document: "coverageMaster", ownerId: death.id, ownerName: "일반상해사망 특별약관", nodePath: [clauseBlock.id] }]);
    // 보통약관 삭제 → 담보약관의 대응 지정(문서 서비스 자체 스캔) + 상품 템플릿 선택(refs 외부 사용처)
    const doc = impactOf(await s.document.remove(admin, general.id));
    expect(doc.brokenRefs.map((c: Coordinate) => c.document)).toEqual(["special", "product"]);
    // 담보속성 유효값 삭제 → 조합(상품 서비스) + 식 참조(refs)
    const attr = impactOf(await s.product.removeAttributeValue(admin, "A0001", "V01"));
    expect(attr.brokenRefs.map((c: Coordinate) => [c.document, c.refPath])).toEqual([
      ["special", undefined],
      ["special", "attr.A0001"],
    ]);
  });

  it("구분자정의 S6-3 — 확인 후 삭제: 값 행 연쇄 삭제, 남은 식 참조는 깨진 참조(오류 상태)로 관계정보에 드러난다", async () => {
    unwrap(await s.catalog.remove(admin, "D0002", { confirm: true }));
    expect(await s.catalog.get("D0002")).toBeUndefined();
    expect((await s.product.getSnapshotValues(pcId)).get(pcId)?.has("D0002")).toBe(false);
    const { broken, issues } = await s.refs.integrity();
    expect(broken.filter((e) => e.via !== "attach").map((e) => [e.via, e.at.ownerId])).toEqual([["when", "C0001"]]);
    expect(issues[0]).toMatchObject({ kind: "brokenRef", at: { document: "clause", ownerId: "C0001", refPath: "D0002" } });
    // 공용조항 재검사도 같은 사실을 brokenRef 로 보고한다
    const recheck = unwrap(await s.clause.recheck("C0001"));
    expect(recheck[0].issues.map((i) => i.kind)).toEqual(["brokenRef"]);
  });
});
