import { describe, expect, it } from "vitest";

import type { Expr } from "./ast";
import { parse } from "./parser";
import { extractRefs, isAliasExpression, requiredDiscriminatorCodes } from "./refs";

function ast(src: string): Expr {
  const r = parse(src);
  if (!r.ok) throw new Error(`파싱 실패: ${JSON.stringify(r.rejection)}`);
  return r.value;
}

describe("extractRefs — 참조 추출", () => {
  it("단순 참조는 경로와 함께 나온다", () => {
    expect(extractRefs(ast("cov_pay.exempt = true"))).toEqual([
      { ref: { kind: "discriminator", code: "cov_pay", field: "exempt" }, path: "cov_pay.exempt" },
    ]);
  });

  it("집계 안의 경로는 어느 집계인지 표시된다", () => {
    expect(extractRefs(ast("any(cov_pay.exempt)"))).toEqual([
      {
        ref: { kind: "discriminator", code: "cov_pay", field: "exempt" },
        path: "cov_pay.exempt",
        aggregate: "any",
      },
    ]);
  });

  it("담보속성 참조와 내장 경로는 종류로 구분된다", () => {
    const refs = extractRefs(ast("exist(attr.renew) and attr.add = 'x' and builtin.subCoverage.name = 'a'"));
    expect(refs).toEqual([
      { ref: { kind: "attr", code: "renew" }, path: "attr.renew", aggregate: "exist" },
      { ref: { kind: "attr", code: "add" }, path: "attr.add" },
      { ref: { kind: "builtin", level: "subCoverage", prop: "name" }, path: "builtin.subCoverage.name" },
    ]);
  });

  it("같은 경로·같은 쓰임은 한 번만, 등장 순서대로 나온다", () => {
    const refs = extractRefs(ast("a = 1 or (b and a = 2) or any(a)"));
    expect(refs.map((r) => [r.path, r.aggregate])).toEqual([
      ["a", undefined],
      ["b", undefined],
      ["a", "any"],
    ]);
  });

  it("리터럴만 있는 식은 참조가 없다", () => {
    expect(extractRefs(ast("1 = 1"))).toEqual([]);
  });

  it("not 안의 참조도 추출된다", () => {
    expect(extractRefs(ast("not renew")).map((r) => r.path)).toEqual(["renew"]);
  });
});

describe("requiredDiscriminatorCodes — 요구 구분자 집합 (ADR-0010)", () => {
  it("구분자 코드만 중복 없이 돌려준다 (담보속성·내장 경로 제외)", () => {
    expect(
      requiredDiscriminatorCodes(
        ast("cov_pay.exempt = true and cov_pay.rate > 50 and exist(attr.renew) and avg_rate = 'x' and builtin.benefit.name = 'y'"),
      ),
    ).toEqual(["cov_pay", "avg_rate"]);
  });
});

describe("isAliasExpression — 별칭형 파생 판정 (구분자_기획)", () => {
  it("단일 참조뿐인 식은 별칭형이다", () => {
    expect(isAliasExpression(ast("cov_pay.exempt"))).toBe(true);
    expect(isAliasExpression(ast("avg_rate"))).toBe(true);
    expect(isAliasExpression(ast("(avg_rate)"))).toBe(true);
    expect(isAliasExpression(ast("builtin.coverage.name"))).toBe(true);
  });

  it("계산이 있는 식은 별칭형이 아니다", () => {
    expect(isAliasExpression(ast("not cov_pay.exempt"))).toBe(false);
    expect(isAliasExpression(ast("any(cov_pay.exempt)"))).toBe(false);
    expect(isAliasExpression(ast("cov_pay.exempt = true"))).toBe(false);
    expect(isAliasExpression(ast("'x'"))).toBe(false);
  });
});
