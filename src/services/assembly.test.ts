import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { RenderedDoc, RenderedInline } from "@/domain/assembly";
import type { Command, DocumentNode } from "@/domain/document";
import type { Actor, Id, Result } from "@/domain/types";

import { createTestDb, type TestDb } from "@/db/test-utils";
import { createAssemblyService, executionBasedFilter, type AssemblyService } from "./assembly";
import { createCatalogService } from "./catalog";
import { createClauseService } from "./clause";
import { createCoverageService, type CoverageService } from "./coverage";
import { createDocumentService, type DocumentService } from "./document";
import { createProductService, type ProductService } from "./product";

const editor: Actor = { userId: "00000000-0000-4000-8000-000000000002", role: "editor" };

function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`기대: ok, 실제: ${JSON.stringify(r.rejection)}`);
  return r.value;
}

function lines(doc: RenderedDoc): string[] {
  const inline = (list: RenderedInline[]) => list.map((n) => (n.kind === "text" ? n.text : n.kind === "error" ? `⟦${n.issue.kind}⟧` : n.label)).join("");
  const out: string[] = [];
  for (const a of doc.children) {
    if (a.kind === "error") continue;
    out.push(`${a.label}(${a.title})`);
    for (const p of a.children) if (p.kind !== "error") out.push(`  ${p.label} ${inline(p.children)}`);
  }
  return out;
}

/**
 * 관통 1 축약 픽스처를 **실제 서비스**로 DB 에 만든다 (도메인 픽스처 `alphaPlusFixture` 와 같은 모양 —
 * 카탈로그 · 담보 · 공용조항 · 문서 · 별표 · 상품 · 탑재 · 그룹 · 기본계약).
 */
describe("assembly 서비스 (PGlite) — 관통 1 통합", () => {
  let t: TestDb;
  let svc: AssemblyService;
  let coverage: CoverageService;
  let documents: DocumentService;
  let product: ProductService;
  let productId: Id;
  let covDeath: Id;
  let pcBasic: Id;
  let pcAddon: Id;

  const insertAll = (root: Id, nodes: DocumentNode["children"]): Command[] => nodes.map((node) => ({ type: "insert", node, at: { parentId: root } }));

  beforeAll(async () => {
    t = await createTestDb();
    const catalog = createCatalogService(t.db);
    coverage = createCoverageService(t.db);
    const clause = createClauseService(t.db);
    documents = createDocumentService(t.db);
    // ⚠ product.mount 는 트랜잭션 안에서 coverageMaster.tree 를 부른다 — coverage.get(db) 를 그대로 꽂으면 PGlite 단일 연결 교착.
    //   통합(container)에서는 tx 를 받는 어댑터가 필요하다. 여기서는 트리를 미리 읽어 메모리로 답한다.
    const trees = new Map<Id, Awaited<ReturnType<CoverageService["get"]>>>();
    product = createProductService(t.db, { coverageMaster: { tree: async (id) => trees.get(id) } });
    svc = createAssemblyService(t.db, { catalog, coverage, clause, document: documents, product });

    // 카탈로그 — D0001 갱신여부 · E0001/D0002 고지유형 · D0003 보험금지급 · D0004 평균공시이율 · D0005 면책여부합 · D0006 감액기간(선택 노출)
    unwrap(await catalog.create(editor, { kind: "scalar", label: "갱신여부", level: "coverage", type: { kind: "boolean" }, alwaysExposed: true }));
    unwrap(await catalog.createEnum(editor, { label: "고지유형", values: [{ label: "일반심사" }, { label: "간편심사" }] }));
    unwrap(await catalog.create(editor, { kind: "scalar", label: "고지유형", level: "product", type: { kind: "enum", enumCode: "E0001" }, alwaysExposed: true }));
    unwrap(await catalog.create(editor, { kind: "struct", label: "보험금지급", level: "benefit", alwaysExposed: true, fields: [{ label: "면책여부", type: { kind: "boolean" } }, { label: "지급률", type: { kind: "number" } }] }));
    unwrap(await catalog.create(editor, { kind: "const", label: "평균공시이율", value: "2.5%" }));
    unwrap(await catalog.create(editor, { kind: "derived", label: "면책여부합", level: "coverage", expression: "any(D0003.F01)" }));
    unwrap(await catalog.create(editor, { kind: "scalar", label: "감액기간", level: "coverage", type: { kind: "number" } }));

    // 담보 마스터 — 일반상해사망 (세부보장 1 · 급부 1) + 값 + 감액기간 부착
    const tree = unwrap(await coverage.create(editor, { name: "일반상해사망", benefitName: "사망보험금" }));
    covDeath = tree.id;
    trees.set(covDeath, tree);
    const ben = tree.subCoverages[0].benefits[0];
    unwrap(await coverage.writeValue(editor, { level: "coverage", id: covDeath }, "D0001", false));
    unwrap(await coverage.attach(editor, { level: "coverage", id: covDeath }, "D0006"));
    unwrap(await coverage.writeValue(editor, { level: "coverage", id: covDeath }, "D0006", 24));
    unwrap(await coverage.writeValue(editor, { level: "benefit", id: ben.id }, "D0003.F01", true));
    unwrap(await coverage.writeValue(editor, { level: "benefit", id: ben.id }, "D0003.F02", 100));

    // 별표 · 공용조항 (C0001 소멸 block + 옵션 O01{V01 일반, V02 사망} · C0002 준용 inline)
    unwrap(await documents.createAppendix(editor, { code: "APX_DISABILITY", name: "장해분류표" }));
    unwrap(await documents.createAppendix(editor, { code: "APX_BURN", name: "화상 분류표" }));
    unwrap(
      await clause.create(editor, {
        label: "특별약관의 소멸",
        mode: "block",
        body: [{ id: "c1-par", kind: "paragraph", children: [{ id: "c1-t1", kind: "text", text: "이 특별약관은 " }, { id: "c1-opt", kind: "optionSlot", optionCode: "O01" }, { id: "c1-t2", kind: "text", text: " 소멸합니다." }] }],
        options: [{ label: "소멸 사유", values: [{ label: "일반", body: [{ id: "c1-o-gen", kind: "text", text: "보험기간이 끝난 때" }] }, { label: "사망", body: [{ id: "c1-o-death", kind: "text", text: "피보험자가 사망한 때" }] }] }],
      }),
    );

    // 보통약관 — 4개 조 (제2조 갱신여부 인라인 조건 + 고지유형 슬롯 · 제3조 별표 · 제4조 준용 = 공용조항)
    const g = unwrap(await documents.createGeneral(editor, "알파Plus 보통약관"));
    unwrap(
      await clause.create(editor, {
        label: "준용 문구",
        mode: "inline",
        body: [{ id: "c2-t1", kind: "text", text: "이 약관에서 정하지 않은 사항은 보통약관 " }, { id: "c2-ref", kind: "articleRef", articleId: "g-art-def" }, { id: "c2-t2", kind: "text", text: " 및 관계 법령을 따릅니다." }],
      }),
    );
    unwrap(
      await documents.apply(
        editor,
        g.id,
        insertAll(g.tree.id, [
          { id: "g-art-def", kind: "article", title: "용어의 정의", children: [{ id: "g-par-def", kind: "paragraph", children: [{ id: "g-txt-def", kind: "text", text: "이 계약에서 사용하는 용어의 정의는 다음과 같습니다." }] }] },
          {
            id: "g-art-pay",
            kind: "article",
            title: "보험금의 지급사유",
            children: [
              {
                id: "g-par-pay-1",
                kind: "paragraph",
                children: [
                  { id: "g-txt-pay-1", kind: "text", text: "회사는 피보험자가 " },
                  { id: "g-inl-renew", kind: "inlineCond", branches: [{ id: "g-inl-renew-if", when: "D0001 = true", children: [{ id: "g-txt-pay-2", kind: "text", text: "최초계약일" }] }, { id: "g-inl-renew-else", children: [{ id: "g-txt-pay-3", kind: "text", text: "계약일" }] }] },
                  { id: "g-txt-pay-4", kind: "text", text: " 이후 기본계약의 보험금 지급사유가 발생한 때 보험금을 지급합니다." },
                ],
              },
              { id: "g-par-pay-2", kind: "paragraph", children: [{ id: "g-txt-pay-5", kind: "text", text: "이 계약은 " }, { id: "g-slot-notice", kind: "slot", ref: "D0002" }, { id: "g-txt-pay-6", kind: "text", text: " 계약입니다." }] },
            ],
          },
          { id: "g-art-disability", kind: "article", title: "장해의 분류", children: [{ id: "g-par-dis", kind: "paragraph", children: [{ id: "g-txt-dis-1", kind: "text", text: "장해의 분류는 " }, { id: "g-apx-disability", kind: "appendixRef", appendixCode: "APX_DISABILITY" }, { id: "g-txt-dis-2", kind: "text", text: " 에 따릅니다." }] }] },
          { id: "g-art-apply", kind: "article", title: "준용규정", children: [{ id: "g-par-apply", kind: "paragraph", children: [{ id: "g-clause-apply", kind: "clauseInlineRef", clauseCode: "C0002", options: {} }] }] },
        ]),
      ),
    );

    // 담보약관 — 일반상해사망 (대응 보통약관 지정 → 조연결 · 보통약관 조 참조 가능)
    const s = unwrap(await documents.createSpecial(editor, covDeath, "일반상해사망 특별약관"));
    unwrap(await documents.setGeneralDocument(editor, s.id, g.id));
    unwrap(
      await documents.apply(
        editor,
        s.id,
        insertAll(s.tree.id, [
          {
            id: "s-art-pay",
            kind: "article",
            title: "보험금의 지급사유",
            children: [
              {
                id: "s-par-pay-1",
                kind: "paragraph",
                children: [
                  { id: "s-txt-pay-1", kind: "text", text: "회사는 피보험자가 " },
                  { id: "s-inl-renew", kind: "inlineCond", branches: [{ id: "s-inl-renew-if", when: "exist(attr.A0001) and attr.A0001 = 'V02'", children: [{ id: "s-txt-pay-2", kind: "text", text: "최초계약일" }] }, { id: "s-inl-renew-else", children: [{ id: "s-txt-pay-3", kind: "text", text: "계약일" }] }] },
                  { id: "s-txt-pay-4", kind: "text", text: " 이후 상해로 사망한 경우 사망보험금을 지급합니다." },
                ],
              },
              { id: "s-par-pay-2", kind: "paragraph", children: [{ id: "s-txt-pay-5", kind: "text", text: "사망보험금은 보험가입금액에 평균공시이율 " }, { id: "s-slot-rate", kind: "slot", ref: "D0004" }, { id: "s-txt-pay-6", kind: "text", text: " 을 적용하여 계산합니다." }] },
            ],
          },
          {
            id: "s-cond-exempt",
            kind: "condBlock",
            branches: [{ id: "s-cond-exempt-if", when: "D0005 = true", children: [{ id: "s-art-exempt", kind: "article", title: "보험금을 지급하지 않는 사유", children: [{ id: "s-par-exempt", kind: "paragraph", children: [{ id: "s-txt-exempt", kind: "text", text: "고의 사고에는 지급하지 않습니다." }] }] }] }],
          },
          { id: "s-art-reduce", kind: "article", title: "보험금의 감액지급", children: [{ id: "s-par-reduce", kind: "paragraph", children: [{ id: "s-txt-reduce-1", kind: "text", text: "계약일부터 " }, { id: "s-slot-reduce", kind: "slot", ref: "D0006" }, { id: "s-txt-reduce-2", kind: "text", text: "개월 이내의 사망은 감액 지급합니다." }] }] },
          { id: "s-art-lapse", kind: "article", title: "특별약관의 소멸", children: [{ id: "s-par-lapse", kind: "paragraph", children: [{ id: "s-txt-lapse", kind: "text", text: "이 특별약관은 다음의 경우 소멸합니다." }] }, { id: "s-clause-lapse", kind: "clauseBlockRef", clauseCode: "C0001", options: { O01: "V02" } }] },
          { id: "s-art-apply", kind: "article", title: "준용규정", linkedArticleId: "g-art-apply", children: [{ id: "s-par-apply", kind: "paragraph", children: [{ id: "s-clause-apply", kind: "clauseInlineRef", clauseCode: "C0002", options: {} }] }] },
        ]),
      ),
    );

    // 상품 — 담보속성 · 상품 · 값 · 탑재 ×2 · 기본계약 · 그룹
    unwrap(await product.createAttributeKind(editor, { label: "갱신유형" })); // A0001
    unwrap(await product.addAttributeValue(editor, "A0001", { label: "비갱신형" }));
    unwrap(await product.addAttributeValue(editor, "A0001", { label: "갱신형", naming: { prefix: "갱신형" } }));
    unwrap(await product.createAttributeKind(editor, { label: "부가유형" })); // A0002
    unwrap(await product.addAttributeValue(editor, "A0002", { label: "기본" }));
    unwrap(await product.addAttributeValue(editor, "A0002", { label: "추가", naming: { suffix: "추가" } }));
    productId = unwrap(await product.createProduct(editor, { name: "알파Plus(축약)", generalDocumentId: g.id })).id;
    unwrap(await product.setProductValue(editor, productId, "D0002", undefined, "V02"));
    pcBasic = unwrap(await product.mount(editor, productId, covDeath, [{ kindCode: "A0002", valueCode: "V01" }])).id;
    pcAddon = unwrap(await product.mount(editor, productId, covDeath, [{ kindCode: "A0002", valueCode: "V02" }])).id;
    unwrap(await product.designateBaseContract(editor, productId, pcBasic));
    const group = unwrap(await product.createGroup(editor, productId, { title: "상해 관련 특별약관" }));
    unwrap(await product.placeInGroup(editor, group.id, pcBasic));
    unwrap(await product.placeInGroup(editor, group.id, pcAddon));
  });
  afterAll(async () => {
    await t.close();
  });

  it("★ 관통 1 — preview: 보통약관 + 특약 2벌(본문 동일 · 제목만 다름) · 준용규정 생략 · 별표 1 · complete=true", async () => {
    const b = unwrap(await svc.preview(productId));
    expect(b.issues).toEqual([]);
    expect(b.complete).toBe(true);
    expect(lines(b.general!)).toEqual([
      "제1조(용어의 정의)",
      "  ① 이 계약에서 사용하는 용어의 정의는 다음과 같습니다.",
      "제2조(보험금의 지급사유)",
      "  ① 회사는 피보험자가 계약일 이후 기본계약의 보험금 지급사유가 발생한 때 보험금을 지급합니다.",
      "  ② 이 계약은 간편심사 계약입니다.",
      "제3조(장해의 분류)",
      "  ① 장해의 분류는 【별표1(장해분류표)】 에 따릅니다.",
      "제4조(준용규정)",
      "  ① 이 약관에서 정하지 않은 사항은 보통약관 제1조(용어의 정의) 및 관계 법령을 따릅니다.",
    ]);
    expect(b.specials.map((g) => [g.title, g.docs.map((d) => d.title)])).toEqual([["상해 관련 특별약관", ["일반상해사망 특별약관", "일반상해사망 추가 특별약관"]]]);
    const [basic, addon] = b.specials[0].docs;
    expect(lines(basic)).toEqual([
      "제1조(보험금의 지급사유)",
      "  ① 회사는 피보험자가 계약일 이후 상해로 사망한 경우 사망보험금을 지급합니다.",
      "  ② 사망보험금은 보험가입금액에 평균공시이율 2.5% 을 적용하여 계산합니다.",
      "제2조(보험금을 지급하지 않는 사유)",
      "  ① 고의 사고에는 지급하지 않습니다.",
      "제3조(보험금의 감액지급)",
      "  ① 계약일부터 24개월 이내의 사망은 감액 지급합니다.",
      "제4조(특별약관의 소멸)",
      "  ① 이 특별약관은 다음의 경우 소멸합니다.",
      "  ② 이 특별약관은 피보험자가 사망한 때 소멸합니다.",
    ]);
    expect(lines(addon)).toEqual(lines(basic));
    expect(b.omitted.map((o) => [o.productCoverageId, o.articleTitle])).toEqual([
      [pcBasic, "준용규정"],
      [pcAddon, "준용규정"],
    ]);
    expect(b.appendices.map((a) => [a.code, a.number])).toEqual([["APX_DISABILITY", 1]]);
    expect(b.undocumented).toEqual([]);
  });

  it("previewSpecial — 「일반상해사망 추가」 하나만 · 실행 기반 완결성 필터가 B1 completeness 에 꽂힌다", async () => {
    const r = unwrap(await svc.previewSpecial(productId, pcAddon));
    expect(r.complete).toBe(true);
    expect(r.doc.title).toBe("일반상해사망 추가 특별약관");
    expect(r.omitted).toHaveLength(1);
    // 실행 기반 필터: 지급률(D0003.F02)은 어떤 문서도 읽지 않으므로 마스터에서 지워도 이 상품의 미입력이 아니다
    const booklet = unwrap(await svc.preview(productId));
    const ben = (await coverage.get(covDeath))!.subCoverages[0].benefits[0];
    unwrap(await coverage.clearValue(editor, { level: "benefit", id: ben.id }, "D0003.F02"));
    const filtered = createCoverageService(t.db, { completenessFilter: executionBasedFilter(booklet) });
    expect(unwrap(await filtered.completeness(covDeath))).toEqual([]);
    expect(unwrap(await coverage.completeness(covDeath)).map((m) => m.path)).toEqual(["D0003.F02"]);
  });

  it("기본계약 미지정 → 보통약관의 담보 레벨 참조가 noBaseContract 오류 + 좌표, 특약은 그대로 (거부가 아니라 부분 조립)", async () => {
    unwrap(await product.releaseBaseContract(editor, productId, pcBasic));
    const b = unwrap(await svc.preview(productId));
    expect(b.complete).toBe(false);
    expect(b.issues).toHaveLength(1);
    expect(b.issues[0]).toMatchObject({ kind: "noBaseContract", at: { document: "general", articleId: "g-art-pay", articleTitle: "보험금의 지급사유", refPath: "D0001" } });
    expect(b.issues[0].at.nodePath?.slice(-2)).toEqual(["g-inl-renew", "g-inl-renew-if"]);
    expect(b.specials[0].docs).toHaveLength(2);
    expect(lines(b.specials[0].docs[0])).toHaveLength(10);
    unwrap(await product.designateBaseContract(editor, productId, pcBasic));
    expect(unwrap(await svc.preview(productId)).complete).toBe(true);
  });

  it("없는 상품은 notFound", async () => {
    const r = await svc.preview("00000000-0000-4000-8000-0000000000ff");
    expect(!r.ok && r.rejection.reason).toBe("notFound");
  });
});
