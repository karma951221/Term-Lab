import { describe, expect, it } from "vitest";

import type { Discriminator, EnumDef } from "../catalog";
import type { Clause } from "../clause";
import type { Coverage } from "../coverage";
import { surgeryFixture } from "../document";
import type { AttributeKind } from "../product";
import { buildGraph, nodeKey, type DocumentInput, type ProductInput } from "./graph";

// ───────── 픽스처 — 관통 1 축약 (2차구현_계획 §5) ─────────

const 갱신여부: Discriminator = { kind: "scalar", code: "D0001", label: "갱신여부", description: "", level: "coverage", alwaysExposed: true, type: { kind: "boolean" } };
const 고지유형: Discriminator = { kind: "scalar", code: "D0002", label: "고지유형", description: "", level: "product", alwaysExposed: false, type: { kind: "enum", enumCode: "E0001" } };
const 보험금지급: Discriminator = {
  kind: "struct",
  code: "D0003",
  label: "보험금지급",
  description: "",
  level: "benefit",
  alwaysExposed: true,
  fields: [
    { code: "F01", label: "면책여부", type: { kind: "boolean" }, order: 0 },
    { code: "F02", label: "지급률", type: { kind: "number" }, order: 1 },
  ],
};
const 평균공시이율: Discriminator = { kind: "const", code: "D0004", label: "평균공시이율", description: "", value: "2.5%" };
const 면책여부합: Discriminator = { kind: "derived", code: "D0005", label: "면책여부합", description: "", level: "coverage", expression: "any(D0003.F01)" };
const 고지유형enum: EnumDef = { code: "E0001", label: "고지유형", values: [{ code: "V01", label: "일반심사", order: 0 }, { code: "V02", label: "간편심사", order: 1 }] };

const 소멸: Clause = {
  code: "C001",
  label: "특별약관의 소멸",
  description: "",
  mode: "block",
  body: [{ id: "c1-p1", kind: "paragraph", children: [{ id: "c1-t1", kind: "text", text: "소멸합니다. " }, { id: "c1-opt", kind: "optionSlot", optionCode: "O01" }] }],
  options: [{ code: "O01", label: "어조", order: 0, values: [{ code: "death", label: "사망", body: [{ id: "c1-v1", kind: "text", text: "사망 시" }], order: 0 }, { code: "lapse", label: "해지", body: [], order: 1 }] }],
  required: { discriminators: [], attributes: [] },
};
const 준용: Clause = {
  code: "C002",
  label: "준용규정",
  description: "",
  mode: "inline",
  body: [
    { id: "c2-cond", kind: "inlineCond", branches: [{ id: "c2-b1", when: "D0001 = true and attr.A0001 = 'V01'", children: [{ id: "c2-t1", kind: "text", text: "갱신형" }] }] },
    { id: "c2-apx", kind: "appendixRef", appendixCode: "APX_BURN" },
  ],
  options: [],
  required: { discriminators: ["D0001"], attributes: ["A0001"] },
};

const 갱신유형: AttributeKind = { code: "A0001", label: "갱신유형", order: 0, values: [{ code: "V01", label: "갱신형", order: 0, naming: {} }, { code: "V02", label: "비갱신형", order: 1, naming: {} }] };

const fx = surgeryFixture();
const 수술비: Coverage = { id: fx.coverageId, name: "수술비", description: "", documentId: "doc-s", subCoverages: [{ id: "sub-1", name: "1종수술", order: 0, benefits: [{ id: "ben-1", name: "수술보험금", order: 0 }] }] };
const 담보약관: DocumentInput = { id: "doc-s", kind: "special", ownerId: fx.coverageId, title: fx.special.title, generalDocumentId: "doc-g", tree: fx.special };
const 보통약관: DocumentInput = { id: "doc-g", kind: "general", title: fx.general.title, tree: fx.general };
const 상품: ProductInput = {
  id: "prod-1",
  name: "알파Plus",
  generalDocumentId: "doc-g",
  coverages: [{ id: "pc-1", productId: "prod-1", coverageId: fx.coverageId, name: "갱신형 수술비", attributes: [{ kindCode: "A0001", valueCode: "V01" }] }],
  overrides: [{ id: "ov-1", scope: { kind: "productCoverage", id: "pc-1" }, nodeId: "s-clause-lapse", clauseCode: "C001", options: { O01: "lapse" } }],
};

function full() {
  return buildGraph({
    discriminators: [갱신여부, 고지유형, 보험금지급, 평균공시이율, 면책여부합],
    enums: [고지유형enum],
    clauses: [소멸, 준용],
    documents: [담보약관, 보통약관],
    appendices: fx.appendices,
    coverages: [수술비],
    attachments: [{ owner: { kind: "coverage", id: fx.coverageId }, discriminatorCode: "D0002" }],
    attributeKinds: [갱신유형],
    products: [상품],
  });
}

const edgesTo = (g: ReturnType<typeof buildGraph>, key: string) => g.edges.filter((e) => nodeKey(e.to) === key);

describe("refs 그래프 — buildGraph (문면_기획 「참조는 그래프다」)", () => {
  it("노드 = 실체: 구분자·필드·enum·enum 값·공용조항·옵션·문서·조·별표·담보 노드·담보속성·상품·상품담보", () => {
    const g = full();
    for (const k of [
      "discriminator:D0001",
      "field:D0003.F01",
      "enum:E0001",
      "enumValue:E0001/V02",
      "clause:C001",
      "clauseOption:C001/O01",
      "clauseOptionValue:C001/O01/death",
      "document:doc-s",
      "article:doc-s/s-art-pay",
      "article:doc-s/s-art-term", // 조 자리 조건 블록 안의 조도 노드다
      "appendix:APX_BURN",
      "coverageNode:coverage/cov-surgery",
      "coverageNode:benefit/ben-1",
      "attribute:A0001",
      "attributeValue:A0001/V01",
      "product:prod-1",
      "productCoverage:pc-1",
    ]) {
      expect(g.nodes.has(k), k).toBe(true);
    }
    expect(g.nodes.get("field:D0003.F01")).toMatchObject({ label: "보험금지급.면책여부", parent: { kind: "discriminator", code: "D0003" }, level: "benefit" });
    expect(g.nodes.get("coverageNode:benefit/ben-1")?.parent).toEqual({ kind: "coverageNode", level: "subCoverage", id: "sub-1" });
  });

  it("문서 노드 → 구분자 간선에 좌표(문서·소유자·조·노드 경로·refPath)가 실린다", () => {
    const g = full();
    const es = edgesTo(g, "discriminator:D0001");
    const when = es.find((e) => e.via === "when" && e.at.articleId === "s-art-pay");
    expect(when).toBeDefined();
    expect(when!.from).toEqual({ kind: "article", documentId: "doc-s", articleId: "s-art-pay" });
    expect(when!.at).toMatchObject({ document: "special", ownerId: "cov-surgery", ownerName: "수술비 특별약관", articleTitle: "보험금의 지급사유", refPath: "D0001" });
    expect(when!.at.nodePath).toContain("s-inl-renew-if");
    // 조 밖(조 자리 조건 블록 가지)의 조건식은 문서 노드에서 나간다
    const outside = es.find((e) => e.at.nodePath?.includes("s-cond-term-if"));
    expect(outside!.from).toEqual({ kind: "document", id: "doc-s" });
    // 슬롯 → const · 구조체 필드
    expect(edgesTo(g, "discriminator:D0004").map((e) => e.via)).toEqual(["slot"]);
    expect(edgesTo(g, "field:D0003.F02")[0]).toMatchObject({ via: "slot", at: { articleId: "s-art-exempt" } });
  });

  it("문서 → 공용조항 참조 + 옵션 선택, 조 참조(self·general), 조연결, 별표, 대응 보통약관", () => {
    const g = full();
    expect(edgesTo(g, "clause:C001")[0]).toMatchObject({ via: "clauseRef", options: { tone: "death" }, at: { articleId: "s-art-lapse", nodePath: ["s-doc", "s-art-lapse", "s-clause-lapse"] } });
    // 옵션 선택 — 정의에 없는 옵션 tone 은 깨진 대상이 된다 (재검사 목록 재료)
    expect(edgesTo(g, "clauseOptionValue:C001/tone/death")[0]?.via).toBe("optionSelect");
    expect(edgesTo(g, "clause:C002")[0]?.via).toBe("clauseRef");
    expect(edgesTo(g, "article:doc-s/s-art-pay")[0]).toMatchObject({ via: "articleRef", from: { kind: "article", documentId: "doc-s", articleId: "s-art-apply" } });
    const toGeneralPay = edgesTo(g, "article:doc-g/g-art-pay");
    expect(toGeneralPay.map((e) => e.via)).toEqual(["articleRef"]);
    expect(edgesTo(g, "article:doc-g/g-art-apply")).toEqual([expect.objectContaining({ via: "link", from: { kind: "article", documentId: "doc-s", articleId: "s-art-apply" } })]);
    expect(edgesTo(g, "appendix:APX_BURN").map((e) => e.from.kind).sort()).toEqual(["article", "clause"]);
    expect(edgesTo(g, "appendix:APX_DISABILITY")[0]?.at).toMatchObject({ document: "general", ownerId: "doc-g" });
    expect(edgesTo(g, "document:doc-g").map((e) => [e.from.kind, e.via])).toEqual([
      ["document", "generalDocument"],
      ["product", "generalDocument"],
    ]);
  });

  it("파생식 → 구분자(집계 표시) · 공용조항 본문 → 구분자·담보속성(리터럴 유효값까지) · enum 타입 간선", () => {
    const g = full();
    const derived = edgesTo(g, "field:D0003.F01").find((e) => e.via === "expression");
    expect(derived).toMatchObject({ from: { kind: "discriminator", code: "D0005" }, aggregate: "any", at: { refPath: "D0003.F01", ownerName: "면책여부합" } });
    const clauseWhen = edgesTo(g, "discriminator:D0001").find((e) => e.from.kind === "clause");
    expect(clauseWhen).toMatchObject({ via: "when", at: { document: "clause", ownerId: "C002", ownerName: "준용규정", nodePath: ["c2-cond", "c2-b1"], refPath: "D0001" } });
    expect(edgesTo(g, "attribute:A0001")[0]?.from).toEqual({ kind: "clause", code: "C002" });
    expect(edgesTo(g, "attributeValue:A0001/V01").map((e) => e.via).sort()).toEqual(["combination", "when"]);
    expect(edgesTo(g, "enum:E0001")).toEqual([expect.objectContaining({ from: { kind: "discriminator", code: "D0002" }, via: "type", at: { refPath: "D0002", ownerName: "고지유형" } })]);
  });

  it("담보 부착·문서 연결, 상품담보 탑재·조합·옵션 오버라이드(ADR-0017 — 문서 노드를 매개로)", () => {
    const g = full();
    expect(edgesTo(g, "discriminator:D0002").find((e) => e.via === "attach")).toMatchObject({ from: { kind: "coverageNode", level: "coverage", id: "cov-surgery" }, at: { document: "coverageMaster", ownerName: "수술비", refPath: "D0002" } });
    expect(edgesTo(g, "document:doc-s").map((e) => e.via)).toEqual(["document"]);
    expect(edgesTo(g, "coverageNode:coverage/cov-surgery")[0]).toMatchObject({ via: "mount", from: { kind: "productCoverage", id: "pc-1" }, at: { document: "special", ownerId: "pc-1", ownerName: "갱신형 수술비" } });
    const ov = edgesTo(g, "clauseOptionValue:C001/O01/lapse")[0];
    expect(ov).toMatchObject({ via: "override", from: { kind: "productCoverage", id: "pc-1" }, through: { kind: "article", documentId: "doc-s", articleId: "s-art-lapse" }, at: { document: "special", ownerId: "pc-1", nodePath: ["s-clause-lapse"], refPath: "C001.O01" } });
  });

  it("enum 타입 자리와 문자열 리터럴을 비교하는 식은 enum 값 간선을 낸다 (enum 값 삭제 영향 재료)", () => {
    const g = buildGraph({
      discriminators: [고지유형],
      enums: [고지유형enum],
      documents: [{ id: "d", kind: "general", title: "g", tree: { id: "root", kind: "document", title: "g", children: [{ id: "cb", kind: "condBlock", branches: [{ id: "br", when: "D0002 = 'V02'", children: [] }] }] } }],
    });
    expect(edgesTo(g, "enumValue:E0001/V02")).toEqual([expect.objectContaining({ via: "when", from: { kind: "document", id: "d" }, at: expect.objectContaining({ nodePath: ["root", "cb", "br"], refPath: "D0002" }) })]);
  });

  it("문법이 깨진 식은 간선을 내지 않는다 · 입력이 없는 종류는 노드도 간선도 없다", () => {
    const g = buildGraph({ discriminators: [{ kind: "derived", code: "D0009", label: "x", description: "", level: "coverage", expression: "D0001 = = true" }] });
    expect(g.edges).toEqual([]);
    expect(g.nodes.size).toBe(1);
  });
});
