import { describe, expect, it } from "vitest";

import { parseRefTarget } from "./lib";

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

  it("알 수 없는 kind 는 undefined", () => {
    expect(parseRefTarget({ kind: "bogus" })).toBeUndefined();
    expect(parseRefTarget({})).toBeUndefined();
  });
});
