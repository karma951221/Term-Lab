import { describe, expect, it } from "vitest";

import { isDirty } from "./edit";

describe("L2 편집 dirty 판정", () => {
  it("빈 문자열과 undefined는 같은 미입력으로 본다", () => {
    expect(isDirty({ description: undefined }, { description: "" })).toBe(false);
  });

  it("객체 키 순서는 무시하고 배열 순서는 변경으로 본다", () => {
    expect(isDirty({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(false);
    expect(isDirty({ values: ["A", "B"] }, { values: ["B", "A"] })).toBe(true);
  });

  it("중첩된 필드 값 변경을 찾는다", () => {
    expect(isDirty({ fields: [{ code: "F01", label: "면책" }] }, { fields: [{ code: "F01", label: "면제" }] })).toBe(true);
  });
});
