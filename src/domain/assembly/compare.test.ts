import { describe, expect, it } from "vitest";

import { diffByArticle, normalizeLine, renderedToLines, sourceToLines } from "./compare";
import type { RenderedDoc } from "./types";

const doc: RenderedDoc = {
  kind: "document",
  id: "d",
  document: "general",
  ownerId: "g",
  title: "T",
  children: [
    {
      kind: "section",
      id: "s1",
      number: 1,
      label: "제1관",
      title: "목적",
      children: [
        {
          kind: "article",
          id: "a1",
          number: 1,
          label: "제1조",
          title: "목적",
          children: [
            {
              kind: "paragraph",
              id: "p1",
              number: 1,
              label: "",
              children: [
                { kind: "text", id: "t", text: "이 계약은 " },
                { kind: "articleRef", id: "r", targets: [{ nodeId: "a2", label: "제2조(정의)" }], connector: "및", label: "제2조(정의)" },
                { kind: "text", id: "t2", text: "를 따른다." },
              ],
            },
            {
              kind: "table",
              id: "tb",
              title: "용어",
              columns: [{}, {}],
              rows: [
                { header: true, cells: [[{ kind: "text", id: "h1", text: "용어" }], [{ kind: "text", id: "h2", text: "정의" }]] },
                { cells: [[{ kind: "text", id: "c1", text: "계약자" }], [{ kind: "text", id: "c2", text: "사람" }]] },
              ],
            },
            { kind: "box", id: "bx", title: "심신상실", lines: ["정신병"] },
          ],
        },
        {
          kind: "article",
          id: "a2",
          number: 2,
          label: "제2조",
          title: "정의",
          children: [
            {
              kind: "paragraph",
              id: "p2",
              number: 1,
              label: "①",
              children: [{ kind: "text", id: "x", text: "하나" }],
              items: [
                { kind: "item", id: "i1", number: 1, label: "1.", children: [{ kind: "text", id: "y", text: "호" }], subitems: [{ kind: "subitem", id: "u1", number: 1, label: "가.", children: [{ kind: "text", id: "z0", text: "목" }] }] },
                { kind: "box", id: "bx2", title: "민법", lines: ["줄"] },
              ],
            },
            { kind: "paragraph", id: "p3", number: 2, label: "②", children: [{ kind: "text", id: "z", text: "둘" }] },
          ],
        },
      ],
    },
  ],
};

describe("대조기 — 조립 결과 ↔ 원문 (파싱양식)", () => {
  it("렌더 문서를 파싱양식 줄로 되돌린다 (단항은 =, 다항은 @, 표·박스는 fence)", () => {
    expect(renderedToLines(doc)).toEqual([
      "# 제1관 목적",
      "## 제1조(목적)",
      "= 이 계약은 제2조(정의)를 따른다.",
      "```표",
      "제목: 용어",
      "|용어|정의|",
      "|---|---|",
      "|계약자|사람|",
      "```",
      "```용어풀이",
      "【심신상실】",
      "정신병",
      "```",
      "## 제2조(정의)",
      "@ 하나",
      "  - 호",
      "    - 목",
      "```용어풀이",
      "【민법】",
      "줄",
      "```",
      "@ 둘",
    ]);
  });

  it("원문은 머리·통계·주석·빈 줄을 버리고 관 헤딩은 남긴다", () => {
    expect(sourceToLines("# 제목\n\n> 출처: x\n\n# 제1관 목적\n\n## 제1조(목적)\n\n= 본문 <!-- 원문번호: 3 -->\n> 통계: 조 1\n")).toEqual(["# 제1관 목적", "## 제1조(목적)", "= 본문"]);
  });

  it("정규화는 조·관 번호를 지우고 공백을 없앤다 (별표 번호는 남긴다)", () => {
    expect(normalizeLine("## 제27조의1(보험료의 납입면제)")).toBe("##제§조(보험료의납입면제)");
    expect(normalizeLine("= 제9조(적립부분), 제10조(만기) 및 제38조(중도인출)은")).toBe("=제§조(적립부분),제§조(만기)및제§조(중도인출)은");
    expect(normalizeLine("【별표2(장해분류 표)】")).toBe("【별표2(장해분류표)】");
    expect(normalizeLine("# 제3관 계약자의")).toBe("#제§관계약자의");
  });

  it("조 단위로 다른 곳만 보고한다", () => {
    const expected = ["## 제1조(목적)", "= 같다", "## 제2조(정의)", "@ 다르다"];
    const actual = ["## 제1조(목적)", "= 같다", "## 제2조(정의)", "@ 다르다!"];
    const diffs = diffByArticle(expected, actual);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({ index: 1, title: "정의", expected: ["@ 다르다"], actual: ["@ 다르다!"] });
  });

  it("조 수가 다르면 없는 쪽이 빈 조로 보고된다", () => {
    const diffs = diffByArticle(["## 제1조(목적)", "= 같다"], ["## 제1조(목적)", "= 같다", "## 제2조(추가)", "= 더"]);
    expect(diffs).toEqual([{ index: 1, title: "추가", expected: [], actual: ["= 더"] }]);
  });
});
