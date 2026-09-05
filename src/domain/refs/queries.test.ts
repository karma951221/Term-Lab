import { describe, expect, it } from "vitest";

import type { Discriminator } from "../catalog";
import type { Clause } from "../clause";
import { surgeryFixture } from "../document";
import { buildGraph, nodeKey, type DocumentInput } from "./graph";
import { brokenEdges, cycles, orphans, relationView, usagesOf } from "./queries";

const D = (code: string, label = code): Discriminator => ({ kind: "scalar", code, label, description: "", level: "coverage", alwaysExposed: true, type: { kind: "boolean" } });
const struct: Discriminator = { kind: "struct", code: "D0003", label: "보험금지급", description: "", level: "benefit", alwaysExposed: true, fields: [{ code: "F01", label: "면책여부", type: { kind: "boolean" }, order: 0 }, { code: "F02", label: "지급률", type: { kind: "number" }, order: 1 }] };
const konst: Discriminator = { kind: "const", code: "D0004", label: "평균공시이율", description: "", value: "2.5%" };
const derived: Discriminator = { kind: "derived", code: "D0005", label: "면책여부합", description: "", level: "coverage", expression: "any(D0003.F01)" };
const clause = (code: string, label: string, body: Clause["body"] = [{ id: `${code}-p`, kind: "paragraph", children: [] }]): Clause => ({ code, label, description: "", mode: "block", body: body as never, options: [], required: { discriminators: [], attributes: [] } });

const fx = surgeryFixture();
const special: DocumentInput = { id: "doc-s", kind: "special", ownerId: fx.coverageId, title: fx.special.title, generalDocumentId: "doc-g", tree: fx.special };
const general: DocumentInput = { id: "doc-g", kind: "general", title: fx.general.title, tree: fx.general };

function surgeryGraph() {
  return buildGraph({
    discriminators: [D("D0001", "갱신여부"), struct, konst, derived, D("D0099", "아무도 안 쓰는 것")],
    clauses: [clause("C001", "특별약관의 소멸"), clause("C002", "준용규정"), clause("C003", "고아 조항")],
    documents: [special, general],
    appendices: [...fx.appendices, { code: "APX_ORPHAN", name: "고아 별표", description: "" }],
    coverages: [{ id: fx.coverageId, name: "수술비", description: "", documentId: "doc-s", subCoverages: [{ id: "sub-1", name: "1종수술", order: 0, benefits: [{ id: "ben-1", name: "수술보험금", order: 0 }] }] }],
    attachments: [{ owner: { kind: "coverage", id: fx.coverageId }, discriminatorCode: "D0099" }],
  });
}

describe("usagesOf — 역방향 조회 (구분자정의 S6 · 관계정보 뷰)", () => {
  it("구분자 사용처 = 문면 조건식·슬롯·파생식·공용조항 식·부착 — 좌표 목록으로", () => {
    const g = surgeryGraph();
    const u = usagesOf(g, { kind: "discriminator", code: "D0001" });
    expect(u.map((e) => e.via)).toEqual(["when", "when"]); // 인라인 조건(제1조) · 조 자리 조건 블록
    expect(u.every((e) => e.at.document === "special" && e.at.ownerId === "cov-surgery")).toBe(true);
  });

  it("구조체 사용처에는 필드 사용처가 포함된다 (포함 관계) · 필드만 물으면 그 필드만", () => {
    const g = surgeryGraph();
    expect(usagesOf(g, { kind: "discriminator", code: "D0003" }).map((e) => [e.via, e.at.refPath])).toEqual([
      ["expression", "D0003.F01"],
      ["slot", "D0003.F02"],
    ]);
    expect(usagesOf(g, { kind: "field", code: "D0003", fieldCode: "F01" }).map((e) => e.from)).toEqual([{ kind: "discriminator", code: "D0005" }]);
  });

  it("via 필터 — 부착만 · 참조만", () => {
    const g = surgeryGraph();
    expect(usagesOf(g, { kind: "discriminator", code: "D0099" }).map((e) => e.via)).toEqual(["attach"]);
    expect(usagesOf(g, { kind: "discriminator", code: "D0099" }, { via: ["when", "slot", "expression"] })).toEqual([]);
  });

  it("공용조항·조·별표 사용처", () => {
    const g = surgeryGraph();
    expect(usagesOf(g, { kind: "clause", code: "C001" }).map((e) => [e.via, e.at.articleTitle])).toEqual([
      ["clauseRef", "특별약관의 소멸"],
      ["optionSelect", "특별약관의 소멸"],
    ]);
    expect(usagesOf(g, { kind: "article", documentId: "doc-g", articleId: "g-art-apply" }).map((e) => e.via)).toEqual(["link"]);
    expect(usagesOf(g, { kind: "document", id: "doc-g" }).map((e) => e.via).sort()).toEqual(["articleRef", "generalDocument", "link"]);
    expect(usagesOf(g, { kind: "appendix", code: "APX_BURN" })).toHaveLength(1);
  });
});

describe("orphans — 어디서도 참조되지 않는 구분자·공용조항·별표", () => {
  it("부착만 있고 식·문면이 읽지 않는 구분자, 참조 없는 공용조항·별표가 고아다. 파생·const 도 대상", () => {
    const g = surgeryGraph();
    expect(orphans(g).map((n) => nodeKey(n.key))).toEqual(["discriminator:D0099", "clause:C003", "appendix:APX_ORPHAN"]);
  });

  it("필드만 읽혀도 구조체는 고아가 아니다", () => {
    const g = buildGraph({ discriminators: [struct, derived] });
    expect(orphans(g).map((n) => nodeKey(n.key))).toEqual(["discriminator:D0005"]);
  });
});

describe("cycles — 파생식 순환 · 조 참조 순환", () => {
  it("파생이 파생을 맞물려 읽으면 순환 (MVP 는 다단 파생 자체를 거부하지만 저장 구조는 검증 가능해야 한다)", () => {
    const g = buildGraph({
      discriminators: [
        { kind: "derived", code: "D0010", label: "a", description: "", level: "coverage", expression: "D0011 = true" },
        { kind: "derived", code: "D0011", label: "b", description: "", level: "coverage", expression: "D0010 = true" },
      ],
    });
    const cs = cycles(g);
    expect(cs).toHaveLength(1);
    expect(cs[0].nodes.map(nodeKey).sort()).toEqual(["discriminator:D0010", "discriminator:D0011"]);
    expect(cs[0].edges.every((e) => e.via === "expression")).toBe(true);
  });

  it("조 참조가 서로를 가리키면 순환 · 자기 참조도 순환", () => {
    const tree = (id: string, refs: [string, string][]) => ({
      id: `${id}-root`,
      kind: "document" as const,
      title: id,
      children: refs.map(([art, target]) => ({ id: art, kind: "article" as const, title: art, children: [{ id: `${art}-p`, kind: "paragraph" as const, children: [{ id: `${art}-r`, kind: "articleRef" as const, articleId: target, scope: "self" as const }] }] })),
    });
    const g = buildGraph({ documents: [{ id: "d", kind: "general", title: "d", tree: tree("d", [["a1", "a2"], ["a2", "a1"], ["a3", "a3"]]) }] });
    expect(cycles(g).map((c) => c.nodes.map((n) => (n.kind === "article" ? n.articleId : "?")).sort())).toEqual([["a1", "a2"], ["a3"]]);
  });

  it("순환 없는 그래프는 빈 목록", () => {
    expect(cycles(surgeryGraph())).toEqual([]);
  });
});

describe("brokenEdges — 대상이 없는 참조 (삭제 후 남은 오류 상태)", () => {
  it("픽스처의 깨진 참조: 정의에 없는 옵션 선택(tone) 뿐", () => {
    const g = surgeryGraph();
    expect(brokenEdges(g).map((e) => nodeKey(e.to))).toEqual(["clauseOptionValue:C001/tone/death"]);
  });

  it("구분자를 지우면 그 구분자와 필드를 읽던 간선 전부가 깨진다 — 좌표는 그대로 남는다", () => {
    const g = buildGraph({ discriminators: [D("D0001"), konst, derived], documents: [special, general], clauses: [clause("C001", "x"), clause("C002", "y")], appendices: fx.appendices });
    const broken = brokenEdges(g);
    expect(broken.map((e) => e.at.refPath).sort()).toEqual(["C001.tone", "D0003.F01", "D0003.F02"]);
    expect(broken.find((e) => e.at.refPath === "D0003.F02")?.at).toMatchObject({ document: "special", articleId: "s-art-exempt" });
  });

  it("대응 보통약관이 없는 담보약관의 조연결·보통약관 조 참조는 깨진다", () => {
    const g = buildGraph({ documents: [{ ...special, generalDocumentId: undefined }] });
    // 자기 문서 조 참조(self)만 성립하고 나머지는 전부 깨진다
    expect(brokenEdges(g).map((e) => e.via).sort()).toEqual(["appendixRef", "articleRef", "clauseRef", "clauseRef", "link", "optionSelect", "slot", "slot", "when", "when", "when"]);
  });
});

describe("relationView — 관계정보 뷰 (정방향 · 역방향 · 옵션 오버라이드 사용처)", () => {
  it("공용조항: 정방향(본문이 읽는 것) · 역방향(참조 문서) · 오버라이드(ADR-0017) · 깨진 것", () => {
    const g = buildGraph({
      discriminators: [D("D0001")],
      clauses: [
        {
          code: "C001",
          label: "소멸",
          description: "",
          mode: "block",
          options: [{ code: "O01", label: "어조", order: 0, values: [{ code: "death", label: "사망", body: [], order: 0 }] }],
          body: [{ id: "cb", kind: "condBlock", branches: [{ id: "br", when: "D0001 = true", children: [] }] }],
          required: { discriminators: ["D0001"], attributes: [] },
        },
      ],
      documents: [{ ...special, generalDocumentId: undefined }],
      products: [{ id: "p", name: "알파", coverages: [{ id: "pc", productId: "p", coverageId: fx.coverageId, name: "수술비", attributes: [] }], overrides: [{ id: "o", scope: { kind: "productCoverage", id: "pc" }, nodeId: "s-clause-lapse", clauseCode: "C001", options: { O01: "death" } }] }],
    });
    const v = relationView(g, { kind: "clause", code: "C001" });
    expect(v.node?.label).toBe("소멸");
    expect(v.outgoing.map((e) => [e.via, nodeKey(e.to)])).toEqual([["when", "discriminator:D0001"]]);
    expect(v.incoming.map((e) => [e.via, e.at.articleTitle])).toEqual([
      ["clauseRef", "특별약관의 소멸"],
      ["optionSelect", "특별약관의 소멸"],
    ]);
    expect(v.overrides.map((e) => [nodeKey(e.from), e.at.refPath])).toEqual([["productCoverage:pc", "C001.O01"]]);
    expect(v.broken).toEqual([]);
  });

  it("문서: 정방향에 조 안 참조가 다 들어오고, 깨진 대상은 broken 으로 갈린다", () => {
    const g = buildGraph({ documents: [{ ...special, generalDocumentId: undefined }] });
    const v = relationView(g, { kind: "document", id: "doc-s" });
    expect(v.outgoing.length).toBeGreaterThan(5);
    expect(v.broken.length).toBe(v.outgoing.length - 1); // 자기 문서 조 참조(self) 하나만 성립, 나머지는 전부 깨짐
    expect(v.incoming.map((e) => [e.via, nodeKey(e.from)])).toEqual([["articleRef", "article:doc-s/s-art-apply"]]); // 문서 안 자기 조 참조
  });

  it("없는 대상은 node 없이 (참조만 남은 상태)", () => {
    const g = surgeryGraph();
    const v = relationView(g, { kind: "clauseOption", clauseCode: "C001", optionCode: "tone" });
    expect(v.node).toBeUndefined();
    expect(v.incoming.map((e) => e.via)).toEqual(["optionSelect"]);
  });
});
