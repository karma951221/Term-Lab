import { describe, expect, it } from "vitest";

import { nodeBuilders } from "@/domain/document";

import { moveTarget, parseLines, parseOptions, parseTableForm, str } from "./lib";

describe("documents lib — 순수 파싱", () => {
  it("str — trim", () => {
    const fd = new FormData();
    fd.set("a", " hi ");
    expect(str(fd, "a")).toBe("hi");
  });

  it("parseOptions — 객체 JSON 은 그대로, 아니면 빈 객체", () => {
    expect(parseOptions("")).toEqual({});
    expect(parseOptions('{"O01":"V01"}')).toEqual({ O01: "V01" });
    expect(parseOptions("[1,2]")).toEqual({});
    expect(parseOptions("not json")).toEqual({});
  });

  it("moveTarget — 형제 안에서 위/아래로, 경계는 undefined", () => {
    const b = nodeBuilders();
    const p1 = b.paragraph([b.text("a")]);
    const p2 = b.paragraph([b.text("b")]);
    const article = b.article("조1", [p1, p2]);
    const doc = b.document("문서", [article]);

    expect(moveTarget(doc, p2.id, -1)).toEqual({ parentId: article.id, slot: "children", index: 0 });
    expect(moveTarget(doc, p1.id, -1)).toBeUndefined();
    expect(moveTarget(doc, p2.id, 1)).toBeUndefined();
    expect(moveTarget(doc, article.id, -1)).toBeUndefined(); // 문서 루트 바로 아래는 형제가 하나뿐
  });

  it("moveTarget — 존재하지 않는 노드는 undefined", () => {
    const b = nodeBuilders();
    const doc = b.document("문서", []);
    expect(moveTarget(doc, "no-such-id", 1)).toBeUndefined();
  });
});

describe("parseTableForm — 표 폼 → 표 필드 (ADR-0029)", () => {
  it("행 텍스트(셀은 |)와 너비·제목줄 수를 표 필드로", () => {
    const fd = new FormData();
    fd.set("title", "용어");
    fd.set("widths", "30,");
    fd.set("headerRows", "1");
    fd.set("rows", "용어|정의\n계약자|사람");
    expect(parseTableForm(fd)).toEqual({ title: "용어", columns: [{ width: 30 }, {}], rows: [{ header: true, cells: ["용어", "정의"] }, { cells: ["계약자", "사람"] }] });
  });

  it("열 수는 가장 긴 행 기준, 짧은 행은 빈 셀 · 제목 없으면 title 없음", () => {
    const fd = new FormData();
    fd.set("rows", "a|b|c\nd");
    expect(parseTableForm(fd)).toEqual({ columns: [{}, {}, {}], rows: [{ cells: ["a", "b", "c"] }, { cells: ["d", "", ""] }] });
  });

  it("parseLines — 줄마다 하나, 빈 줄은 버린다", () => {
    expect(parseLines(" 첫 줄 \n\n둘째 줄\n")).toEqual(["첫 줄", "둘째 줄"]);
  });
});
