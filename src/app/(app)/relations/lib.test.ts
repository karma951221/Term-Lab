import { describe, expect, it } from "vitest";

import { KIND_OPTIONS, VIA_LABEL, parseRefTarget, refTargetParams } from "./lib";

describe("relations lib — 쿼리스트링 → RefNodeKey (순수)", () => {
  it("discriminator · clause · appendix — code 필요", () => {
    expect(parseRefTarget({ kind: "discriminator", code: "D0001" })).toEqual({ kind: "discriminator", code: "D0001" });
    expect(parseRefTarget({ kind: "clause", code: "C0001" })).toEqual({ kind: "clause", code: "C0001" });
    expect(parseRefTarget({ kind: "appendix", code: "APX1" })).toEqual({ kind: "appendix", code: "APX1" });
    expect(parseRefTarget({ kind: "discriminator" })).toBeUndefined();
  });

  it("field — code · fieldCode 둘 다 필요", () => {
    expect(parseRefTarget({ kind: "field", code: "D0002", fieldCode: "F01" })).toEqual({ kind: "field", code: "D0002", fieldCode: "F01" });
    expect(parseRefTarget({ kind: "field", code: "D0002" })).toBeUndefined();
  });

  it("coverageNode — level 이 3종 중 하나여야 한다", () => {
    expect(parseRefTarget({ kind: "coverageNode", level: "benefit", id: "b1" })).toEqual({ kind: "coverageNode", level: "benefit", id: "b1" });
    expect(parseRefTarget({ kind: "coverageNode", level: "bogus", id: "b1" })).toBeUndefined();
  });

  it("product · productCoverage · document — id 필요", () => {
    expect(parseRefTarget({ kind: "product", id: "p1" })).toEqual({ kind: "product", id: "p1" });
    expect(parseRefTarget({ kind: "productCoverage", id: "pc1" })).toEqual({ kind: "productCoverage", id: "pc1" });
    expect(parseRefTarget({ kind: "document", id: "d1" })).toEqual({ kind: "document", id: "d1" });
  });

  it("조 · 옵션 · 기타 실체도 그래프 노드 링크에서 다시 조회한다", () => {
    expect(parseRefTarget({ kind: "article", code: "doc", id: "art" })).toEqual({ kind: "article", documentId: "doc", articleId: "art" });
    expect(parseRefTarget({ kind: "clauseOption", code: "C1", fieldCode: "O1" })).toEqual({ kind: "clauseOption", clauseCode: "C1", optionCode: "O1" });
    expect(parseRefTarget({ kind: "clauseOptionValue", code: "C1", fieldCode: "O1", valueCode: "V1" })).toEqual({ kind: "clauseOptionValue", clauseCode: "C1", optionCode: "O1", valueCode: "V1" });
    expect(parseRefTarget({ kind: "entity", code: "snapshot", id: "e1" })).toEqual({ kind: "entity", entityKind: "snapshot", id: "e1" });
  });

  it("16종 키는 URL 파라미터를 거쳐 같은 키로 돌아온다", () => {
    const samples = [
      { kind: "discriminator", code: "D1" },
      { kind: "field", code: "D1", fieldCode: "F1" },
      { kind: "enum", enumCode: "E1" },
      { kind: "enumValue", enumCode: "E1", valueCode: "V1" },
      { kind: "clause", code: "C1" },
      { kind: "clauseOption", clauseCode: "C1", optionCode: "O1" },
      { kind: "clauseOptionValue", clauseCode: "C1", optionCode: "O1", valueCode: "V1" },
      { kind: "document", id: "doc" },
      { kind: "article", documentId: "doc", articleId: "art" },
      { kind: "appendix", code: "A1" },
      { kind: "coverageNode", level: "benefit", id: "ben" },
      { kind: "attribute", code: "AT1" },
      { kind: "attributeValue", code: "AT1", valueCode: "V1" },
      { kind: "product", id: "p" },
      { kind: "productCoverage", id: "pc" },
      { kind: "entity", entityKind: "snapshot", id: "e" },
    ] as const;
    for (const key of samples) expect(parseRefTarget(refTargetParams(key))).toEqual(key);
  });

  it("알 수 없는 kind 는 undefined", () => {
    expect(parseRefTarget({ kind: "bogus" })).toBeUndefined();
    expect(parseRefTarget({})).toBeUndefined();
  });
});

describe("화면 라벨 (리뷰 #64 — 영문 enum 을 화면에 내보내지 않는다)", () => {
  it("조회 종류 선택지는 전부 parseRefTarget 이 아는 kind 이고 글자는 한글이다", () => {
    for (const o of KIND_OPTIONS) {
      expect(parseRefTarget({ kind: o.value, code: "X", id: "x", fieldCode: "F", valueCode: "V", level: "benefit" })).toBeDefined();
      expect(o.label).toMatch(/[가-힣]/);
    }
  });

  it("참조 형태는 전부 한글 표기를 갖는다", () => {
    for (const label of Object.values(VIA_LABEL)) expect(label).toMatch(/^[가-힣][가-힣 ()a-z]*$/);
  });
});
