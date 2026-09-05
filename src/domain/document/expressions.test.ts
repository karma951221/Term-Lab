import { describe, expect, it } from "vitest";

import type { TypeResolver } from "../expression";
import { nodeBuilders, sequentialIds } from "./builders";
import { validateExpressions } from "./expressions";

/** 관통 1 픽스처의 타입 조회 — D0001 boolean · D0002 enum · D0003 구조체 · D0004 const string · D0005 파생 boolean. */
const resolve: TypeResolver = (ref) => {
  if (ref.kind === "attr") return ref.code === "renew_type" ? { kind: "attribute", validValues: ["renew", "fixed"] } : undefined;
  if (ref.kind === "builtin") return { kind: "string" };
  switch (ref.code) {
    case "D0001":
      return ref.field === undefined ? { kind: "boolean" } : undefined;
    case "D0002":
      return ref.field === undefined ? { kind: "enum", enumCode: "E0001" } : undefined;
    case "D0003":
      return ref.field === "F01" ? { kind: "boolean" } : ref.field === "F02" ? { kind: "number" } : undefined;
    case "D0004":
      return ref.field === undefined ? { kind: "string" } : undefined;
    case "D0005":
      return ref.field === undefined ? { kind: "boolean" } : undefined;
    default:
      return undefined;
  }
};

describe("문면작성 S2 경계 — 조건식 자리는 문법 검사 + boolean 검사 (ADR-0013 언어 밖 규칙)", () => {
  it("올바른 조건식·슬롯은 문제 없음", () => {
    const b = nodeBuilders(sequentialIds("n"));
    const doc = b.document("d", [
      b.condBlock([b.branch("D0001 = true and any(D0003.F01)", [b.article("x", [b.paragraph([b.slot("D0004"), b.slot("D0003.F02")])])])]),
      b.article("y", [b.paragraph([b.inlineCond([b.inlineBranch("attr.renew_type = 'renew'", [b.text("a")]), b.inlineBranch(undefined, [b.text("b")])])])]),
    ]);
    expect(validateExpressions(doc, resolve)).toEqual([]);
  });

  it("파싱 실패 → syntax · boolean 아님 → typeMismatch · 없는 참조 → brokenRef, 전부 노드 경로 좌표", () => {
    const b = nodeBuilders(sequentialIds("n"));
    const doc = b.document("d", [
      b.condBlock([b.branch("D0001 = = true", [b.article("x", [])])]), // article n1 · branch n2 · cond n3
      b.article("y", [b.paragraph([b.inlineCond([b.inlineBranch("D0004", [b.text("a")])])])]), // text n4 · branch n5 · inlineCond n6 · paragraph n7 · article n8
      b.condBlock([b.branch("D0099 = true", [b.article("z", [])])]), // article n9 · branch n10 · cond n11 — document n12
    ]);
    const issues = validateExpressions(doc, resolve, { document: "special" });
    expect(issues.map((i) => [i.kind, i.at.nodePath, i.at.document])).toEqual([
      ["syntax", ["n12", "n3", "n2"], "special"],
      ["typeMismatch", ["n12", "n8", "n7", "n6", "n5"], "special"],
      ["brokenRef", ["n12", "n11", "n10"], "special"],
    ]);
    expect(issues[1].at.articleId).toBe("n8");
  });

  it("슬롯 참조는 값 참조 경로 하나여야 한다 — 식·담보속성·없는 경로는 거부", () => {
    const b = nodeBuilders(sequentialIds("n"));
    const doc = b.document("d", [
      b.article("x", [b.paragraph([b.slot("D0001 = true"), b.slot("attr.renew_type"), b.slot("D0003.F09"), b.slot("D0001 =")])]),
    ]);
    const issues = validateExpressions(doc, resolve);
    expect(issues.map((i) => [i.kind, i.at.nodePath?.at(-1)])).toEqual([
      ["typeMismatch", "n1"],
      ["typeMismatch", "n2"],
      ["brokenRef", "n3"],
      ["syntax", "n4"],
    ]);
  });
});
