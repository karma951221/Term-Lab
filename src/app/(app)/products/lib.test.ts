import { describe, expect, it } from "vitest";

import type { AttributeKind } from "@/domain/product";

import { parseOptionSelection, parseSelections, str } from "./lib";

const kinds: AttributeKind[] = [
  { code: "A0001", label: "갱신유형", order: 0, values: [{ code: "V01", label: "갱신형", order: 0, naming: {} }] },
  { code: "A0002", label: "부가유형", order: 1, values: [{ code: "V01", label: "기본", order: 0, naming: {} }] },
];

describe("products lib — 순수 파싱", () => {
  it("str — trim", () => {
    const fd = new FormData();
    fd.set("a", " x ");
    expect(str(fd, "a")).toBe("x");
  });

  it("parseSelections — attr:<kindCode> 이름의 값만 골라 담는다, 비어있으면 제외", () => {
    const fd = new FormData();
    fd.set("attr:A0001", "V01");
    fd.set("attr:A0002", "");
    expect(parseSelections(fd, kinds)).toEqual([{ kindCode: "A0001", valueCode: "V01" }]);
  });

  it("parseOptionSelection — 객체 JSON 은 그대로, 아니면 빈 객체", () => {
    expect(parseOptionSelection("")).toEqual({});
    expect(parseOptionSelection('{"O01":"V01"}')).toEqual({ O01: "V01" });
    expect(parseOptionSelection("not json")).toEqual({});
  });
});
