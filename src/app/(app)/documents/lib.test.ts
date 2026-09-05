import { describe, expect, it } from "vitest";

import { nodeBuilders } from "@/domain/document";

import { moveTarget, parseOptions, str } from "./lib";

describe("documents lib — 순수 파싱", () => {
  it("str — trim", () => {
    const fd = new FormData();
    fd.set("a", " hi ");
    expect(str(fd, "a")).toBe("hi");
  });

  it("parseOptions — 객체 JSON 은 그대로, 아니면 빈 객체", () => {
    expect(parseOptions("")).toEqual({});
    expect(parseOptions('{"O01":"V01"}')).toEqual({ O01: "V01" });
    expect(parseOptions("[1,2]")).toEqual({});
    expect(parseOptions("not json")).toEqual({});
  });

  it("moveTarget — 형제 안에서 위/아래로, 경계는 undefined", () => {
    const b = nodeBuilders();
    const p1 = b.paragraph([b.text("a")]);
    const p2 = b.paragraph([b.text("b")]);
    const article = b.article("조1", [p1, p2]);
    const doc = b.document("문서", [article]);

    expect(moveTarget(doc, p2.id, -1)).toEqual({ parentId: article.id, slot: "children", index: 0 });
    expect(moveTarget(doc, p1.id, -1)).toBeUndefined();
    expect(moveTarget(doc, p2.id, 1)).toBeUndefined();
    expect(moveTarget(doc, article.id, -1)).toBeUndefined(); // 문서 루트 바로 아래는 형제가 하나뿐
  });

  it("moveTarget — 존재하지 않는 노드는 undefined", () => {
    const b = nodeBuilders();
    const doc = b.document("문서", []);
    expect(moveTarget(doc, "no-such-id", 1)).toBeUndefined();
  });
});
