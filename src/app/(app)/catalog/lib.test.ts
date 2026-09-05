import { describe, expect, it } from "vitest";

import { bool, fieldTypeFrom, str, valueFromInput } from "./lib";

describe("catalog lib — FormData 파싱 (순수)", () => {
  it("str — trim 된 문자열, 없으면 빈 문자열", () => {
    const fd = new FormData();
    fd.set("a", "  hi  ");
    expect(str(fd, "a")).toBe("hi");
    expect(str(fd, "b")).toBe("");
  });

  it("bool — 체크박스 on/true 만 참", () => {
    const fd = new FormData();
    fd.set("a", "on");
    expect(bool(fd, "a")).toBe(true);
    expect(bool(fd, "b")).toBe(false);
  });

  it("fieldTypeFrom — scalar 4종은 그대로, enum/list<enum> 은 enumCode 필요", () => {
    expect(fieldTypeFrom("string", "")).toEqual({ kind: "string" });
    expect(fieldTypeFrom("number", "")).toEqual({ kind: "number" });
    expect(fieldTypeFrom("boolean", "")).toEqual({ kind: "boolean" });
    expect(fieldTypeFrom("date", "")).toEqual({ kind: "date" });
    expect(fieldTypeFrom("enum", "")).toBeUndefined();
    expect(fieldTypeFrom("enum", "E0001")).toEqual({ kind: "enum", enumCode: "E0001" });
    expect(fieldTypeFrom("list<enum>", "E0001")).toEqual({ kind: "list<enum>", enumCode: "E0001" });
    expect(fieldTypeFrom("bogus", "")).toBeUndefined();
  });

  it("valueFromInput — 빈 문자열은 undefined, 타입별로 파싱", () => {
    expect(valueFromInput({ kind: "string" }, "")).toBeUndefined();
    expect(valueFromInput({ kind: "string" }, "hi")).toBe("hi");
    expect(valueFromInput({ kind: "number" }, "3.5")).toBe(3.5);
    expect(valueFromInput({ kind: "boolean" }, "true")).toBe(true);
    expect(valueFromInput({ kind: "boolean" }, "false")).toBe(false);
    expect(valueFromInput({ kind: "date" }, "2026-01-01")).toBe("2026-01-01");
    expect(valueFromInput({ kind: "enum", enumCode: "E0001" }, "V01")).toBe("V01");
    expect(valueFromInput({ kind: "list<enum>", enumCode: "E0001" }, "V01, V02")).toEqual(["V01", "V02"]);
  });
});
