import { describe, expect, it } from "vitest";

import type { Clause } from "../clause/types";
import { surgeryFixture } from "../document/fixture";
import type { ArticleNode, DocumentNode, ParagraphNode } from "../document/nodes";
import type { MissingSlot } from "../coverage/values";
import type { SpecialGroup } from "../product/types";
import type { Code, Id, Issue } from "../types";
import { assemble, assembleSpecial, executionBasedFilter } from "./booklet";
import { alphaPlusFixture, alphaGeneralDocument, coverageEntry, deathCoverage } from "./fixture";
import type { AssemblyCoverage, AssemblyInput, RenderedDoc, RenderedInline } from "./types";

// ───────────────────────────── 헬퍼 ─────────────────────────────

function lines(doc: RenderedDoc): string[] {
  const inline = (list: RenderedInline[]) => list.map((n) => (n.kind === "text" ? n.text : n.kind === "error" ? `⟦${n.issue.kind}⟧` : n.label)).join("");
  const out: string[] = [];
  for (const a of doc.children) {
    if (a.kind === "error") {
      out.push(`⟦${a.issue.kind}⟧`);
      continue;
    }
    out.push(`${a.label}(${a.title})`);
    for (const p of a.children) out.push(p.kind === "error" ? `  ⟦${p.issue.kind}⟧` : `  ${p.label} ${inline(p.children)}`);
  }
  return out;
}

function docsOf(input: AssemblyInput) {
  const b = assemble(input);
  const docs = new Map<Id, RenderedDoc>();
  for (const g of b.specials) for (const d of g.docs) docs.set(d.ownerId, d);
  return { booklet: b, docs, doc: (pcId: Id) => docs.get(pcId)! };
}

const kinds = (issues: Issue[]) => issues.map((i) => i.kind);

/** 수술비 탑재분 — surgeryFixture 의 문서를 쓴다. 급부 값: 면책 false · 지급률 50. */
function surgeryCoverage(id: Id, name: string, opts: { renew: boolean; exempt?: boolean; attributes?: { kindCode: Code; valueCode: Code }[]; groupId?: Id }): AssemblyCoverage {
  return coverageEntry({
    id,
    name,
    coverageId: "cov-surgery",
    coverageName: "수술비",
    attributes: opts.attributes ?? [],
    subCoverages: [{ id: `${id}-sub`, masterNodeId: "sub-surgery", name: "1종수술", benefits: [{ id: `${id}-ben`, masterNodeId: "ben-surgery", name: "수술보험금" }] }],
    values: { [id]: { D0001: opts.renew }, [`${id}-ben`]: { "D0003.F01": opts.exempt ?? false, "D0003.F02": 50 } },
    groupId: opts.groupId ?? "grp-injury",
  });
}

/** surgeryFixture 의 공용조항 — C001 block(옵션 tone: death · general) · C002 inline(갱신형 문구 인라인 조건). */
const surgeryClauses: Clause[] = [
  {
    code: "C001",
    label: "특별약관의 소멸",
    description: "",
    mode: "block",
    body: [{ id: "c1-p", kind: "paragraph", children: [{ id: "c1-t1", kind: "text", text: "이 특별약관은 " }, { id: "c1-o", kind: "optionSlot", optionCode: "tone" }, { id: "c1-t2", kind: "text", text: " 소멸합니다." }] }],
    options: [
      {
        code: "tone",
        label: "소멸 사유",
        order: 0,
        values: [
          { code: "death", label: "사망", order: 0, body: [{ id: "c1-death", kind: "text", text: "피보험자가 사망한 때" }] },
          { code: "general", label: "일반", order: 1, body: [{ id: "c1-gen", kind: "text", text: "보험기간이 끝난 때" }] },
        ],
      },
    ],
    required: { discriminators: [], attributes: [] },
  },
  {
    code: "C002",
    label: "준용 문구",
    description: "",
    mode: "inline",
    body: [
      { id: "c2-t1", kind: "text", text: "이 약관에서 정하지 않은 사항은 보통약관을 따릅니다." },
      { id: "c2-cond", kind: "inlineCond", branches: [{ id: "c2-if", when: "D0001 = true", children: [{ id: "c2-t2", kind: "text", text: " 갱신형 계약은 갱신 특칙을 우선합니다." }] }] },
    ],
    options: [],
    required: { discriminators: ["D0001"], attributes: [] },
  },
];

/** 알파Plus 재료 + 수술비 문서(surgeryFixture) 를 합친 입력. */
function withSurgery(coverages: AssemblyCoverage[], patch: Partial<AssemblyInput> = {}, special: DocumentNode = surgeryFixture().special): AssemblyInput {
  const base = alphaPlusFixture();
  return {
    ...base,
    product: { ...base.product, general: surgeryFixture().general, generalDocumentId: "g-doc-surgery" },
    coverages,
    specialDocuments: new Map([["cov-surgery", special]]),
    clauses: surgeryClauses,
    ...patch,
  };
}

function tinyDoc(id: Id, title: string, text: string, appendixCode?: Code): DocumentNode {
  const par: ParagraphNode = { id: `${id}-p`, kind: "paragraph", children: [{ id: `${id}-t`, kind: "text", text }, ...(appendixCode ? [{ id: `${id}-x`, kind: "appendixRef" as const, appendixCode }] : [])] };
  return { id, kind: "document", title, children: [{ id: `${id}-a`, kind: "article", title: "보장", children: [par] }] };
}

// ───────────────────────────── 조립오류 시나리오 ─────────────────────────────

describe("조립오류 S2 — 미입력 값 참조 → 오류 마커 + 좌표 + 「완성본 아님」", () => {
  const input = alphaPlusFixture();
  const basic = input.coverages[0];
  (basic.values.get("pc-basic") as Map<string, unknown>).delete("D0006"); // 감액기간 미입력 (자리는 있다 — 부착됨)
  const { booklet, doc } = docsOf(input);

  it("조립은 중단되지 않는다 — 제3조 슬롯 자리에 notEntered 마커, 나머지는 끝까지 조립", () => {
    expect(lines(doc("pc-basic"))[6]).toBe("  ① 계약일부터 ⟦notEntered⟧개월 이내에 발생한 사망에 대해서는 사망보험금의 50%를 지급합니다.");
    expect(lines(doc("pc-basic"))).toHaveLength(10);
  });

  it("패널 항목 — 좌표(상품담보 → 조 → 노드 경로 · 참조 경로)와 원인 · complete=false", () => {
    expect(booklet.issues).toHaveLength(1);
    expect(booklet.issues[0]).toEqual({
      kind: "notEntered",
      message: "D0006 가 미입력입니다",
      at: {
        document: "special",
        ownerId: "pc-basic",
        ownerName: "일반상해사망보장",
        articleId: "s-art-reduce",
        articleTitle: "보험금의 감액지급",
        nodePath: ["s-doc-death", "s-art-reduce", "s-par-reduce", "s-slot-reduce"],
        refPath: "D0006",
      },
    });
    expect(booklet.complete).toBe(false);
  });

  it("값 차이는 탑재분별 — 「추가」 쪽은 그대로 완성", () => {
    expect(lines(doc("pc-addon"))[6]).toContain("24개월");
  });

  it("값 입력 후 재조립하면 오류 소멸 (S1 상태로 복귀)", () => {
    expect(assemble(alphaPlusFixture()).complete).toBe(true);
  });
});

describe("조립오류 S3 — 미사용 담보속성 참조 (exist 가드 없음) 는 오류, 가드하면 건너뛴다", () => {
  const attrDoc = (when: string): DocumentNode => ({
    id: "a-doc",
    kind: "document",
    title: "수술비 특별약관",
    children: [
      {
        id: "a-art",
        kind: "article",
        title: "보험금의 지급사유",
        children: [
          {
            id: "a-par",
            kind: "paragraph",
            children: [
              { id: "a-t1", kind: "text", text: "회사는 " },
              { id: "a-cond", kind: "inlineCond", branches: [{ id: "a-if", when, children: [{ id: "a-t2", kind: "text", text: "최초계약일" }] }, { id: "a-else", children: [{ id: "a-t3", kind: "text", text: "계약일" }] }] },
              { id: "a-t4", kind: "text", text: " 이후 수술을 보장합니다." },
            ],
          },
        ],
      },
    ],
  });
  const coverages = () => [surgeryCoverage("pc-surgery", "수술비", { renew: false }), surgeryCoverage("pc-renew", "갱신형 수술비", { renew: true, attributes: [{ kindCode: "A0001", valueCode: "V02" }] })];

  it("가드 없는 `attr.A0001 = 'V02'` — 「갱신형 수술비」는 true, 「수술비」(미사용)는 unusedAttribute 오류 + 좌표", () => {
    const { booklet, doc } = docsOf(withSurgery(coverages(), {}, attrDoc("attr.A0001 = 'V02'")));
    expect(lines(doc("pc-renew"))[1]).toBe("  ① 회사는 최초계약일 이후 수술을 보장합니다.");
    expect(lines(doc("pc-surgery"))[1]).toBe("  ① 회사는 ⟦unusedAttribute⟧ 이후 수술을 보장합니다.");
    expect(booklet.issues).toHaveLength(1);
    expect(booklet.issues[0]).toMatchObject({ kind: "unusedAttribute", at: { ownerId: "pc-surgery", articleId: "a-art", nodePath: ["a-doc", "a-art", "a-par", "a-cond", "a-if"], refPath: "attr.A0001" } });
    expect(booklet.complete).toBe(false);
  });

  it("`exist(attr.A0001) and attr.A0001 = 'V02'` 로 고치면 「수술비」는 분기를 건너뛰고 오류 없음", () => {
    const { booklet, doc } = docsOf(withSurgery(coverages(), {}, attrDoc("exist(attr.A0001) and attr.A0001 = 'V02'")));
    expect(lines(doc("pc-surgery"))[1]).toBe("  ① 회사는 계약일 이후 수술을 보장합니다.");
    expect(lines(doc("pc-renew"))[1]).toBe("  ① 회사는 최초계약일 이후 수술을 보장합니다.");
    expect(booklet.issues).toEqual([]);
  });
});

describe("조립오류 S4 — 분기로 사라진 조를 가리키는 조 참조 (surgeryFixture: 갱신형 전용 「보험기간」 조)", () => {
  /** 제1조 ① 끝에 「보험기간」 조 참조 슬롯을 단다. */
  const special = surgeryFixture().special;
  const art = special.children[0] as ArticleNode;
  (art.children[0] as ParagraphNode).children.push({ id: "s-txt-ref", kind: "text", text: " 보험기간은 " }, { id: "s-aref-term", kind: "articleRef", articleId: "s-art-term", scope: "self" });
  const { booklet, doc } = docsOf(withSurgery([surgeryCoverage("pc-surgery", "수술비", { renew: false }), surgeryCoverage("pc-renew", "갱신형 수술비", { renew: true })], {}, special));

  it("「갱신형 수술비」 — 보험기간 조가 살아 제2조가 되고 참조는 「제2조(보험기간)」, 이후 조 번호가 밀린다", () => {
    expect(lines(doc("pc-renew"))).toEqual([
      "제1조(보험금의 지급사유)",
      "  ① 회사는 피보험자가 최초계약일 이후 수술을 받은 경우 평균공시이율 2.5% 를 적용하여 보험금을 지급합니다. 보험기간은 제2조(보험기간)",
      "제2조(보험기간)",
      "  ① 이 특별약관의 보험기간은 갱신형입니다.",
      "제3조(특별약관의 소멸)",
      "  ① 이 특별약관은 다음의 경우 소멸합니다.",
      "  ② 이 특별약관은 피보험자가 사망한 때 소멸합니다.",
      "제4조(준용규정)",
      "  ① 이 특별약관에서 정하지 않은 사항은 보통약관 제2조(보험금의 지급사유) 및 이 특별약관 제1조(보험금의 지급사유) · 【별표2(화상 분류표)】 을 따릅니다. 이 약관에서 정하지 않은 사항은 보통약관을 따릅니다. 갱신형 계약은 갱신 특칙을 우선합니다.",
    ]);
  });

  it("「수술비」 — 대상 조가 분기로 꺼져 articleGone 마커 + 좌표, 나머지 참조는 어긋나지 않는다", () => {
    expect(lines(doc("pc-surgery"))[1]).toBe("  ① 회사는 피보험자가 계약일 이후 수술을 받은 경우 평균공시이율 2.5% 를 적용하여 보험금을 지급합니다. 보험기간은 ⟦articleGone⟧");
    expect(lines(doc("pc-surgery"))[2]).toBe("제2조(특별약관의 소멸)");
    expect(lines(doc("pc-surgery"))[6]).toContain("보통약관 제2조(보험금의 지급사유) 및 이 특별약관 제1조(보험금의 지급사유) · 【별표2(화상 분류표)】");
    expect(kinds(booklet.issues)).toEqual(["articleGone"]);
    expect(booklet.issues[0].at).toMatchObject({ ownerId: "pc-surgery", ownerName: "수술비", articleId: "s-art-pay", refPath: "s-art-term" });
  });

  it("별표 — 보통약관의 장해분류표가 1, 특약의 화상 분류표가 2 (책자 등장 순)", () => {
    expect(booklet.appendices.map((a) => [a.code, a.number])).toEqual([
      ["APX_DISABILITY", 1],
      ["APX_BURN", 2],
    ]);
  });
});

describe("조립오류 S5 — 밟지 않은 분기 안의 깨질 참조는 오류 아님", () => {
  // surgeryFixture 의 제2조(D0005 = true 안)는 급부 레벨 슬롯 D0003.F02 를 담보 문맥에서 직접 읽는다 —
  // B1 규칙상 값 자리 없음(notAttached)이라 밟으면 오류다. 면책이 false 면 밟지 않으므로 오류가 아니다.
  it("면책여부 false → 제2조 분기를 밟지 않아 오류 0건", () => {
    const { booklet } = docsOf(withSurgery([surgeryCoverage("pc-surgery", "수술비", { renew: false })]));
    expect(booklet.issues).toEqual([]);
    expect(booklet.complete).toBe(true);
  });

  it("면책여부 true 인 탑재분이 처음 생기면 그때 드러난다 (잠복은 감수한 비용)", () => {
    const { booklet, doc } = docsOf(withSurgery([surgeryCoverage("pc-surgery", "수술비", { renew: false, exempt: true })]));
    expect(lines(doc("pc-surgery"))[2]).toBe("제2조(보험금을 지급하지 않는 사유)");
    expect(kinds(booklet.issues)).toEqual(["notAttached"]);
    expect(booklet.issues[0].at.refPath).toBe("D0003.F02");
  });
});

describe("조립오류 S6 — 생략 자동 판정: 리터럴 비교 · 탑재분별", () => {
  const general: DocumentNode = {
    id: "g6",
    kind: "document",
    title: "보통약관",
    children: [{ id: "g6-apply", kind: "article", title: "준용규정", children: [{ id: "g6-p", kind: "paragraph", children: [{ id: "g6-c", kind: "clauseInlineRef", clauseCode: "C002", options: {} }] }] }],
  };
  const special = (body: ParagraphNode["children"]): DocumentNode => ({
    id: "s6",
    kind: "document",
    title: "수술비 특별약관",
    children: [
      { id: "s6-pay", kind: "article", title: "보험금의 지급사유", children: [{ id: "s6-p1", kind: "paragraph", children: [{ id: "s6-t1", kind: "text", text: "수술을 보장합니다." }] }] },
      { id: "s6-apply", kind: "article", title: "준용규정", linkedArticleId: "g6-apply", children: [{ id: "s6-p2", kind: "paragraph", children: body }] },
    ],
  });
  const viaClause: ParagraphNode["children"] = [{ id: "s6-c", kind: "clauseInlineRef", clauseCode: "C002", options: {} }];
  const coverages = [surgeryCoverage("pc-surgery", "수술비", { renew: false }), surgeryCoverage("pc-renew", "갱신형 수술비", { renew: true })];
  const build = (body: ParagraphNode["children"]) => docsOf(withSurgery(coverages, { product: { ...alphaPlusFixture().product, general, generalDocumentId: "g6", baseContractId: "pc-surgery" } }, special(body)));

  it("같은 공용조항을 참조 → 「수술비」는 보통약관 조와 동일해 생략, 「갱신형 수술비」는 갱신 문구가 붙어 유지 (탑재분별 판정)", () => {
    const { booklet, doc } = build(viaClause);
    expect(lines(doc("pc-surgery")).map((l) => l.split("(")[0])).toEqual(["제1조", "  ① 수술을 보장합니다."]);
    expect(lines(doc("pc-renew"))).toEqual(["제1조(보험금의 지급사유)", "  ① 수술을 보장합니다.", "제2조(준용규정)", "  ① 이 약관에서 정하지 않은 사항은 보통약관을 따릅니다. 갱신형 계약은 갱신 특칙을 우선합니다."]);
    expect(booklet.omitted).toEqual([{ productCoverageId: "pc-surgery", productCoverageName: "수술비", articleId: "s6-apply", articleTitle: "준용규정", linkedArticleId: "g6-apply" }]);
  });

  it("띄어쓰기 하나만 달라도 생략되지 않는다 — 유사도·정규화 없음", () => {
    const { booklet, doc } = build([{ id: "s6-t2", kind: "text", text: "이 약관에서 정하지 않은 사항은  보통약관을 따릅니다." }]);
    expect(lines(doc("pc-surgery"))).toHaveLength(4);
    expect(booklet.omitted).toEqual([]);
  });

  it("직접 쓴 문장이 리터럴 동일하면 생략된다 — 동일성의 근거는 결과 문자열뿐 (보통약관 쪽은 기본계약=비갱신 값으로 렌더되므로 둘 다 동일)", () => {
    const { booklet } = build([{ id: "s6-t2", kind: "text", text: "이 약관에서 정하지 않은 사항은 보통약관을 따릅니다." }]);
    expect(booklet.omitted.map((o) => o.productCoverageId).sort()).toEqual(["pc-renew", "pc-surgery"]);
  });
});

// ───────────────────────────── 그룹핑·별표 시나리오 ─────────────────────────────

describe("그룹핑별표 S1·S2 — 그룹 타이틀 · 그룹 순서 · 그룹 안 자동 정렬(담보 → 속성 종류 → 값)", () => {
  const groups: SpecialGroup[] = [
    { id: "grp-injury", productId: "prod-alpha", title: "1. 상해 관련 특별약관", order: 0 },
    { id: "grp-surgery", productId: "prod-alpha", title: "2. 수술 관련 특별약관", order: 1 },
  ];
  const base = alphaPlusFixture();
  const input: AssemblyInput = {
    ...base,
    groups,
    specialDocuments: new Map([...base.specialDocuments, ["cov-surgery", tinyDoc("t-surgery", "수술비", "수술을 보장합니다.")]]),
    coverages: [
      surgeryCoverage("pc-renew", "갱신형 수술비", { renew: true, attributes: [{ kindCode: "A0001", valueCode: "V02" }], groupId: "grp-surgery" }),
      deathCoverage("pc-addon", "일반상해사망보장 추가", [{ kindCode: "A0002", valueCode: "V02" }], "grp-surgery"),
      surgeryCoverage("pc-surgery", "수술비", { renew: false, attributes: [{ kindCode: "A0001", valueCode: "V01" }], groupId: "grp-surgery" }),
      deathCoverage("pc-basic", "일반상해사망보장", [{ kindCode: "A0002", valueCode: "V01" }], "grp-injury"),
    ],
  };
  const booklet = assemble(input);

  it("책자 = 보통약관 → 그룹(order 순) → 별표. 그룹 타이틀이 찍히고 하위에 특약 문서들", () => {
    expect(booklet.specials.map((g) => [g.title, g.docs.map((d) => d.title)])).toEqual([
      ["1. 상해 관련 특별약관", ["일반상해사망보장 특별약관"]],
      ["2. 수술 관련 특별약관", ["수술비 특별약관", "갱신형 수술비 특별약관", "일반상해사망보장 추가 특별약관"]],
    ]);
  });

  it("같은 담보의 탑재분은 뭉치고 속성 값 order 오름차순 — 정렬의 귀결", () => {
    expect(booklet.specials[1].docs.map((d) => d.ownerId)).toEqual(["pc-surgery", "pc-renew", "pc-addon"]);
    expect(booklet.complete).toBe(true);
  });

  it("미배치 상품담보 — 조립을 막지 않고 unplaced 오류, 책자에서 빠진다 (D-P6-5)", () => {
    const unplaced: AssemblyInput = { ...input, coverages: input.coverages.map((c) => (c.snapshot.id === "pc-basic" ? { ...c, groupId: undefined } : c)) };
    const b = assemble(unplaced);
    expect(b.specials[0].docs).toEqual([]);
    expect(b.issues).toEqual([{ kind: "unplaced", message: "상품담보 「일반상해사망보장」 이(가) 어느 특약 그룹에도 배치되지 않았습니다", at: { document: "special", ownerId: "pc-basic", ownerName: "일반상해사망보장" } }]);
    expect(b.complete).toBe(false);
  });

  it("문면 없는 담보의 탑재분은 오류가 아니라 「미산출 탑재분」 (D-P6-9)", () => {
    const b = assemble({ ...input, specialDocuments: base.specialDocuments });
    expect(b.undocumented).toEqual([
      { productCoverageId: "pc-renew", name: "갱신형 수술비", coverageId: "cov-surgery" },
      { productCoverageId: "pc-surgery", name: "수술비", coverageId: "cov-surgery" },
    ]);
    expect(b.complete).toBe(true);
  });
});

describe("그룹핑별표 S3·S4 — 참조된 별표만 · 번호는 책자 등장 순 (상품마다 다를 수 있다)", () => {
  const groups: SpecialGroup[] = [
    { id: "grp-a", productId: "prod-alpha", title: "A", order: 0 },
    { id: "grp-b", productId: "prod-alpha", title: "B", order: 1 },
  ];
  const general = tinyDoc("g-plain", "보통약관", "별표를 참조하지 않습니다.");
  const make = (groupOfBurn: Id, groupOfDisability: Id): AssemblyInput => {
    const base = alphaPlusFixture();
    return {
      ...base,
      product: { ...base.product, general, generalDocumentId: "g-plain" },
      groups,
      specialDocuments: new Map([
        ["cov-burn", tinyDoc("t-burn", "화상", "화상의 분류는 ", "APX_BURN")],
        ["cov-dis", tinyDoc("t-dis", "장해", "장해의 분류는 ", "APX_DISABILITY")],
      ]),
      coverages: [
        coverageEntry({ id: "pc-burn", name: "화상", coverageId: "cov-burn", coverageName: "화상", attributes: [], subCoverages: [], values: {}, groupId: groupOfBurn }),
        coverageEntry({ id: "pc-dis", name: "장해", coverageId: "cov-dis", coverageName: "장해", attributes: [], subCoverages: [], values: {}, groupId: groupOfDisability }),
      ],
      appendices: [...base.appendices, { code: "APX_UNUSED", name: "쓰이지 않는 표", description: "" }],
    };
  };

  it("상품 A — 화상 특약이 앞 그룹: 화상 분류표 1 · 장해분류표 2. 참조되지 않은 별표는 0회", () => {
    const b = assemble(make("grp-a", "grp-b"));
    expect(b.appendices.map((a) => [a.code, a.number])).toEqual([
      ["APX_BURN", 1],
      ["APX_DISABILITY", 2],
    ]);
    expect(b.appendices[0].firstAt).toMatchObject({ document: "special", ownerId: "pc-burn" });
    expect(lines(b.specials[0].docs[0])[1]).toBe("  ① 화상의 분류는 【별표1(화상 분류표)】");
  });

  it("상품 B — 배치가 뒤바뀌면 같은 별표의 번호가 달라진다 · 본문 슬롯도 그 번호를 찍는다", () => {
    const b = assemble(make("grp-b", "grp-a"));
    expect(b.appendices.map((a) => [a.code, a.number])).toEqual([
      ["APX_DISABILITY", 1],
      ["APX_BURN", 2],
    ]);
    expect(lines(b.specials[1].docs[0])[1]).toBe("  ① 화상의 분류는 【별표2(화상 분류표)】");
  });

  it("별표 마스터에 없는 코드는 brokenRef 마커 (참조 무결성)", () => {
    const b = assemble({ ...make("grp-a", "grp-b"), appendices: [] });
    expect(kinds(b.issues)).toEqual(["brokenRef", "brokenRef"]);
    expect(b.appendices).toEqual([]);
  });
});

// ───────────────────────────── 기본계약 · 공용조항 옵션 · 반복 자리 ─────────────────────────────

describe("ADR-0011 — 보통약관 문맥은 기본계약. 미지정이면 오류 + 좌표(noBaseContract)로 부분 조립", () => {
  it("기본계약 없음 — 보통약관의 담보 레벨 조건(갱신여부)만 noBaseContract, 특약은 정상", () => {
    const input = alphaPlusFixture();
    const b = assemble({ ...input, product: { ...input.product, baseContractId: undefined } });
    expect(b.issues).toHaveLength(1);
    expect(b.issues[0]).toMatchObject({ kind: "noBaseContract", at: { document: "general", ownerId: "g-doc", articleId: "g-art-pay", refPath: "D0001" } });
    expect(lines(b.general!)[3]).toBe("  ① 회사는 피보험자가 ⟦noBaseContract⟧ 이후 기본계약의 보험금 지급사유가 발생한 때 보험금을 지급합니다.");
    expect(b.specials[0].docs).toHaveLength(2);
    expect(b.complete).toBe(false);
  });

  it("기본계약 값이 갱신형이면 보통약관 문구도 따라간다 (최초계약일)", () => {
    const input = alphaPlusFixture();
    (input.coverages[0].values.get("pc-basic") as Map<string, unknown>).set("D0001", { entered: true, value: true });
    const b = assemble(input);
    expect(lines(b.general!)[3]).toContain("최초계약일");
    expect(b.complete).toBe(true);
  });

  it("보통약관 템플릿 미선택 — brokenRef 오류, general 없음, 담보약관의 보통약관 조 참조도 오류", () => {
    const input = withSurgery([surgeryCoverage("pc-surgery", "수술비", { renew: false })]);
    const b = assemble({ ...input, product: { ...input.product, general: undefined, generalDocumentId: undefined } });
    expect(b.general).toBeUndefined();
    expect(kinds(b.issues)).toEqual(["brokenRef", "brokenRef"]);
    expect(b.issues[1].message).toContain("보통약관 템플릿이 없어");
  });
});

describe("ADR-0017 — 공용조항 옵션 해소: 오버라이드 > 마스터, 미선택·무효는 오류 마커", () => {
  const withOptions = (options: Record<string, string>, override?: Record<string, string>) => {
    const input = alphaPlusFixture();
    const doc = input.specialDocuments.get("cov-death")!;
    const lapse = doc.children.find((a) => a.kind === "article" && a.id === "s-art-lapse") as ArticleNode;
    (lapse.children[1] as { options: Record<string, string> }).options = options;
    if (!override) return docsOf(input);
    const [basic, ...rest] = input.coverages;
    return docsOf({ ...input, coverages: [{ ...basic, overrides: [{ id: "ov-1", scope: { kind: "productCoverage", id: "pc-basic" }, nodeId: "s-clause-lapse", clauseCode: "C0001", options: override }] }, ...rest] });
  };

  it("상품담보 오버라이드가 마스터 선택을 이긴다 — 「기본」만 일반 문구, 「추가」는 마스터대로", () => {
    const { doc, booklet } = withOptions({ O01: "V02" }, { O01: "V01" });
    expect(lines(doc("pc-basic"))[9]).toBe("  ② 이 특별약관은 보험기간이 끝난 때 소멸합니다.");
    expect(lines(doc("pc-addon"))[9]).toBe("  ② 이 특별약관은 피보험자가 사망한 때 소멸합니다.");
    expect(booklet.complete).toBe(true);
  });

  it("옵션 미선택 → optionUnselected 마커 (항 자리) · 유효 집합 밖 오버라이드 → optionInvalid", () => {
    const unselected = withOptions({});
    expect(lines(unselected.doc("pc-basic"))[9]).toBe("  ⟦optionUnselected⟧");
    expect(unselected.booklet.issues.map((i) => [i.kind, i.at.ownerId])).toEqual([
      ["optionUnselected", "pc-basic"],
      ["optionUnselected", "pc-addon"],
    ]);
    const invalid = withOptions({ O01: "V02" }, { O01: "V99" });
    expect(kinds(invalid.booklet.issues)).toEqual(["optionInvalid"]);
    expect(invalid.booklet.issues[0].at).toMatchObject({ ownerId: "pc-basic", articleId: "s-art-lapse", nodePath: ["s-doc-death", "s-art-lapse", "s-clause-lapse"], refPath: "O01" });
  });

  it("없는 공용조항 참조는 brokenRef 마커", () => {
    const input = alphaPlusFixture();
    const b = assemble({ ...input, clauses: input.clauses.filter((c) => c.code !== "C0002") });
    expect(kinds(b.issues)).toEqual(["brokenRef", "brokenRef", "brokenRef"]); // 보통약관 1 + 특약 2 (생략 불가)
    expect(b.omitted).toEqual([]);
  });
});

describe("반복 자리(P7) · 밟은 자리 원칙", () => {
  it("forBlock 을 만나면 structure 마커 — 조립은 계속된다", () => {
    const input = alphaPlusFixture();
    const doc = input.specialDocuments.get("cov-death")!;
    (doc.children[0] as ArticleNode).children.push({ id: "s-for", kind: "forBlock", source: "subCoverage", children: [] });
    const { booklet, doc: d } = docsOf(input);
    expect(lines(d("pc-basic"))[3]).toBe("  ⟦structure⟧");
    expect(booklet.issues.map((i) => i.message)).toEqual(["블록 반복은 아직 조립하지 않습니다 (P7)", "블록 반복은 아직 조립하지 않습니다 (P7)"]);
  });

  it("실행 기반 완결성 필터 — 책자가 실제로 읽은 자리의 미입력만 남긴다", () => {
    const filter = executionBasedFilter(assemble(alphaPlusFixture()));
    const item = (id: Id, level: MissingSlot["owner"]["level"], path: string): MissingSlot => ({ owner: { level, id }, ownerName: "", discriminatorCode: path.split(".")[0], label: "", path, at: {} });
    const items = [item("cov-death", "coverage", "D0006"), item("ben-death", "benefit", "D0003.F02"), item("ben-death", "benefit", "D0003.F01"), item("cov-death", "coverage", "D0001")];
    const tree = { id: "cov-death", name: "일반상해사망", description: "", subCoverages: [] };
    expect(filter(items, tree).map((m) => m.path)).toEqual(["D0006", "D0003.F01", "D0001"]); // 지급률(F02)은 어떤 문서도 읽지 않았다
    expect(filter(items, { ...tree, id: "cov-other" })).toEqual([]);
  });

  it("상품담보 미리보기는 배치와 무관 — 미배치 탑재분도 미리보기 가능, 문면 없는 담보는 notFound", () => {
    const input = alphaPlusFixture();
    const r = assembleSpecial({ ...input, coverages: input.coverages.map((c) => ({ ...c, groupId: undefined })) }, "pc-basic");
    expect(r.ok && r.value.complete).toBe(true);
    const none = assembleSpecial({ ...input, specialDocuments: new Map() }, "pc-basic");
    expect(!none.ok && none.rejection.reason).toBe("notFound");
    expect(alphaGeneralDocument().children).toHaveLength(4);
  });
});
