import { describe, expect, it } from "vitest";

import { inlinesFromText, type ArticleIndex, type RefEnv } from "./refs";

function index(): ArticleIndex {
  return {
    byNumber: new Map([
      ["1", { id: "a1", title: "보험금의 지급사유", paragraphIds: ["a1p1", "a1p2"], itemIds: new Map([["a1p1", ["a1p1i1", "a1p1i2"]]]) }],
      ["9", { id: "a9", title: "적립부분 적립이율에 관한 사항", paragraphIds: [], itemIds: new Map() }],
      ["10", { id: "a10", title: "만기환급금의 지급", paragraphIds: [], itemIds: new Map() }],
      ["27의1", { id: "a27-1", title: "보험료의 납입면제", paragraphIds: [], itemIds: new Map() }],
      ["38", { id: "a38", title: "중도인출", paragraphIds: [], itemIds: new Map() }],
    ]),
  };
}

function env(overrides: Partial<RefEnv> = {}): RefEnv {
  return { self: index(), general: index(), appendixByNumber: new Map([[2, "APX02_DISABILITY"]]), currentArticleId: "a1", report: [], ...overrides };
}

let n = 0;
const newId = () => `n${++n}`;

describe("inlinesFromText — 평문의 조·별표 참조를 슬롯으로", () => {
  it("조 참조·별표 참조를 슬롯으로 바꾸고 나머지는 텍스트", () => {
    const out = inlinesFromText("제1조(보험금의 지급사유)에서【별표2(장해분류표)】에 정한", env(), newId);
    expect(out.map((x) => x.kind)).toEqual(["articleRef", "text", "appendixRef", "text"]);
    expect(out[0]).toMatchObject({ kind: "articleRef", scope: "self", connector: "및", targets: [{ nodeId: "a1" }] });
    expect(out[1]).toMatchObject({ kind: "text", text: "에서" });
    expect(out[2]).toMatchObject({ kind: "appendixRef", appendixCode: "APX02_DISABILITY" });
    expect(out[3]).toMatchObject({ kind: "text", text: "에 정한" });
  });

  it("「보통약관 」 접두는 general 범위이고 쉼표·및 으로 이어진 참조는 한 슬롯(덩어리)", () => {
    const out = inlinesFromText("다만, 보통약관 제9조(적립부분 적립이율에 관한 사항), 제10조(만기환급금의 지급) 및 제38조(중도인출)은 제외하며", env(), newId);
    expect(out.map((x) => x.kind)).toEqual(["text", "articleRef", "text"]);
    expect(out[0]).toMatchObject({ text: "다만, " });
    expect(out[1]).toMatchObject({ scope: "general", connector: "및", targets: [{ nodeId: "a9" }, { nodeId: "a10" }, { nodeId: "a38" }] });
    expect(out[2]).toMatchObject({ text: "은 제외하며" });
  });

  it("두 덩어리는 접두가 각각 붙는다 (「보통약관 제27조의1(…) 및 제27조의2(…)도」)", () => {
    const e = env();
    e.general!.byNumber.set("27의2", { id: "a27-2", title: "납입면제에 관한 세부규정", paragraphIds: [], itemIds: new Map() });
    const out = inlinesFromText("보통약관 1종으로 가입한 경우 보통약관 제27조의1(보험료의 납입면제) 및 제27조의2(납입면제에 관한 세부규정)도 제외합니다.", e, newId);
    expect(out.map((x) => x.kind)).toEqual(["text", "articleRef", "text"]);
    expect(out[1]).toMatchObject({ scope: "general", targets: [{ nodeId: "a27-1" }, { nodeId: "a27-2" }] });
  });

  it("법령 인용(의료법 제3조 · 민법 제27조)은 건드리지 않는다", () => {
    const e = env();
    e.self.byNumber.set("3", { id: "a3", title: "의료기관", paragraphIds: [], itemIds: new Map() });
    const out = inlinesFromText("의료법 제3조(의료기관)에 규정한 종합병원. 민법 제27조(실종의 선고)에 따라", e, newId);
    expect(out.every((x) => x.kind === "text")).toBe(true);
    expect(e.report).toEqual([]);
  });

  it("조 없는 항·호 참조는 현재 조의 항·호를 가리킨다 (「제1항」 「제1항 제2호」)", () => {
    const out = inlinesFromText("제1항에 따라 제1항 제2호의 서류를", env(), newId);
    expect(out.map((x) => x.kind)).toEqual(["articleRef", "text", "articleRef", "text"]);
    expect(out[0]).toMatchObject({ targets: [{ nodeId: "a1p1" }] });
    expect(out[2]).toMatchObject({ targets: [{ nodeId: "a1p1i2" }] });
  });

  it("「제N조(…) 제M항」은 그 조의 항을 가리킨다", () => {
    const out = inlinesFromText("제1조(보험금의 지급사유) 제2항에서 정한", env(), newId);
    expect(out[0]).toMatchObject({ kind: "articleRef", targets: [{ nodeId: "a1p2" }] });
    expect(out[1]).toMatchObject({ text: "에서 정한" });
  });

  it("제목이 다르거나 조가 없으면 텍스트로 두고 보고한다", () => {
    const e = env();
    const out = inlinesFromText("제9조(다른 제목)을 제99조(없는 조)와", e, newId);
    expect(out.every((x) => x.kind === "text")).toBe(true);
    expect(e.report).toHaveLength(2);
    expect(e.report[0]).toMatch(/제9조/);
  });

  it("보통약관 색인이 없는 문서에서 「보통약관 제N조」는 텍스트 + 보고", () => {
    const e = env({ general: undefined });
    const out = inlinesFromText("보통약관 제9조(적립부분 적립이율에 관한 사항)은", e, newId);
    expect(out.every((x) => x.kind === "text")).toBe(true);
    expect(e.report[0]).toMatch(/보통약관 색인/);
  });
});
