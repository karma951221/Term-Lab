import { describe, expect, it } from "vitest";

import { bool, csv, str } from "./formData";

describe("_lib/formData — FormData 파싱 (순수)", () => {
  it("str — trim, 없으면 빈 문자열", () => {
    const fd = new FormData();
    fd.set("a", "  hi ");
    expect(str(fd, "a")).toBe("hi");
    expect(str(fd, "missing")).toBe("");
  });

  it("bool — on/true 만 참", () => {
    const fd = new FormData();
    fd.set("a", "on");
    fd.set("b", "true");
    fd.set("c", "off");
    expect(bool(fd, "a")).toBe(true);
    expect(bool(fd, "b")).toBe(true);
    expect(bool(fd, "c")).toBe(false);
    expect(bool(fd, "missing")).toBe(false);
  });

  it("csv — 콤마 구분 · trim · 빈 항목 제거", () => {
    const fd = new FormData();
    fd.set("a", "V01, V02 ,, V03");
    expect(csv(fd, "a")).toEqual(["V01", "V02", "V03"]);
    expect(csv(fd, "missing")).toEqual([]);
  });
});
