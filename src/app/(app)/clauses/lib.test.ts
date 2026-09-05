import { describe, expect, it } from "vitest";

import { parseClauseBody, str } from "./lib";

describe("clauses lib — 순수 파싱", () => {
  it("parseClauseBody — 빈 문자열은 빈 배열", () => {
    expect(parseClauseBody("")).toEqual([]);
    expect(parseClauseBody("   ")).toEqual([]);
  });

  it("parseClauseBody — 배열 JSON 은 그대로 파싱", () => {
    const body = [{ id: "n1", kind: "text", text: "hi" }];
    expect(parseClauseBody(JSON.stringify(body))).toEqual(body);
  });

  it("parseClauseBody — 배열이 아니거나 JSON 이 아니면 undefined", () => {
    expect(parseClauseBody("{}")).toBeUndefined();
    expect(parseClauseBody("not json")).toBeUndefined();
  });

  it("str — trim", () => {
    const fd = new FormData();
    fd.set("a", " x ");
    expect(str(fd, "a")).toBe("x");
  });
});
