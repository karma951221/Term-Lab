import { describe, expect, it } from "vitest";

import { decodeNodeKey, encodeNodeKey, moved, str } from "./lib";

describe("coverages lib — 순수 파싱", () => {
  it("encode/decodeNodeKey — 왕복", () => {
    const key = encodeNodeKey("benefit", "b1");
    expect(key).toBe("benefit:b1");
    expect(decodeNodeKey(key)).toEqual({ level: "benefit", id: "b1" });
  });

  it("decodeNodeKey — 잘못된 레벨·빈 문자열은 undefined", () => {
    expect(decodeNodeKey(undefined)).toBeUndefined();
    expect(decodeNodeKey("bogus:x")).toBeUndefined();
    expect(decodeNodeKey("coverage:")).toBeUndefined();
  });

  it("moved — 형제 순서에서 한 칸 옮긴다, 경계는 그대로", () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(moved(items, "b", -1)).toEqual(["b", "a", "c"]);
    expect(moved(items, "b", 1)).toEqual(["a", "c", "b"]);
    expect(moved(items, "a", -1)).toEqual(["a", "b", "c"]);
    expect(moved(items, "c", 1)).toEqual(["a", "b", "c"]);
  });

  it("str — trim", () => {
    const fd = new FormData();
    fd.set("x", "  hi ");
    expect(str(fd, "x")).toBe("hi");
  });
});
