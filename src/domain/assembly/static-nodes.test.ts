import { describe, expect, it } from "vitest";

import { nodeBuilders, sequentialIds } from "../document/builders";
import type { ArticleNode, ParagraphNode } from "../document/nodes";
import { assemble } from "./booklet";
import { alphaPlusFixture } from "./fixture";
import type { RenderedArticle, RenderedArticleRef, RenderedParagraph, RenderedSection } from "./types";

describe("관·표·박스가 조립을 통과한다 (ADR-0029)", () => {
  it("보통약관의 관 제목·표·박스가 그대로 렌더되고 조 번호는 관을 넘어 이어진다", () => {
    const input = alphaPlusFixture();
    const b = nodeBuilders(sequentialIds("s"));
    const general = input.product.general!;
    const [first, ...rest] = general.children as ArticleNode[];
    const table = b.table({ title: "용어", columns: [{ width: 30 }, { width: 70 }], rows: [{ header: true, cells: ["용어", "정의"] }, { cells: ["계약자", "…"] }] });
    const box = b.box("심신상실", ["정신병 등"]);
    const withSections = {
      ...general,
      children: [b.section("목적 및 용어의 정의", [{ ...first, children: [...first.children, table, box] }]), b.section("보험금의 지급", rest)],
    };
    const booklet = assemble({ ...input, product: { ...input.product, general: withSections } });
    expect(booklet.issues).toEqual([]);
    const [s1, s2] = booklet.general!.children as RenderedSection[];
    expect(s1).toMatchObject({ kind: "section", label: "제1관", title: "목적 및 용어의 정의" });
    expect(s2.label).toBe("제2관");
    const a1 = s1.children[0] as RenderedArticle;
    expect(a1.label).toBe("제1조");
    expect((s2.children[0] as RenderedArticle).label).toBe("제2조");
    expect(a1.children.map((c) => c.kind)).toEqual(["paragraph", "table", "box"]);
    expect(a1.children[1]).toMatchObject({ kind: "table", title: "용어", columns: [{ width: 30 }, { width: 70 }], rows: [{ header: true, cells: ["용어", "정의"] }, { cells: ["계약자", "…"] }] });
    expect(a1.children[2]).toMatchObject({ kind: "box", title: "심신상실", lines: ["정신병 등"] });
    // 항 하나뿐인 조는 마커가 없다
    expect((a1.children[0] as RenderedParagraph).label).toBe("");
  });

  it("항의 호 목록 뒤에 붙은 박스도 그 자리에 남는다", () => {
    const input = alphaPlusFixture();
    const b = nodeBuilders(sequentialIds("s"));
    const general = input.product.general!;
    const first = general.children[0] as ArticleNode;
    const paragraph = first.children[0] as ParagraphNode;
    paragraph.items = [b.item([b.text("첫 호")]), b.box("민법 제27조", ["부재자의 생사가"])];
    const booklet = assemble(input);
    expect(booklet.issues).toEqual([]);
    const a1 = booklet.general!.children[0] as RenderedArticle;
    const p = a1.children[0] as RenderedParagraph;
    expect(p.items?.map((i) => i.kind)).toEqual(["item", "box"]);
  });

  it("기본계약 조 안의 자기 조 참조는 대치된 보통약관 조 번호로 찍힌다 (「보통약관 」 접두 없음)", () => {
    const input = alphaPlusFixture();
    const baseDoc = input.specialDocuments.get("cov-base-death")!;
    const [pay, detail] = baseDoc.children as ArticleNode[];
    const b = nodeBuilders(sequentialIds("r"));
    (detail.children[0] as ParagraphNode).children.unshift(b.articleRef(pay.id, "self"), b.text("에서 정한 "));
    const booklet = assemble(input);
    expect(booklet.issues).toEqual([]);
    const detailArticle = booklet.general!.children.find((c): c is RenderedArticle => c.kind === "article" && c.title === "보험금 지급에 관한 세부규정")!;
    const ref = (detailArticle.children[0] as RenderedParagraph).children[0] as RenderedArticleRef;
    expect(ref.kind).toBe("articleRef");
    expect(ref.label).toBe("제2조(보험금의 지급사유)");
  });
});
