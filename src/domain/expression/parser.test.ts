import { describe, expect, it } from "vitest";

import type { Expr } from "./ast";
import { parse } from "./parser";

/** 파싱이 성공해야 하는 테스트용 헬퍼. */
function ast(src: string): Expr {
  const r = parse(src);
  if (!r.ok) throw new Error(`파싱 실패: ${JSON.stringify(r.rejection)}`);
  return r.value;
}

/** 파싱이 실패해야 하는 테스트용 헬퍼 — syntax Issue 메시지를 돌려준다. */
function syntaxError(src: string): string {
  const r = parse(src);
  if (r.ok) throw new Error(`파싱이 성공해 버림: ${src}`);
  expect(r.rejection.reason).toBe("invalid");
  if (r.rejection.reason !== "invalid") throw new Error("unreachable");
  expect(r.rejection.issues).toHaveLength(1);
  expect(r.rejection.issues[0].kind).toBe("syntax");
  return r.rejection.issues[0].message;
}

describe("리터럴", () => {
  it("문자열 리터럴은 작은따옴표로 감싼다", () => {
    expect(ast("'갱신형'")).toEqual({ kind: "literal", literal: { type: "string", value: "갱신형" } });
  });

  it("문자열 안의 작은따옴표는 역슬래시로 이스케이프한다", () => {
    expect(ast("'a\\'b\\\\c'")).toEqual({
      kind: "literal",
      literal: { type: "string", value: "a'b\\c" },
    });
  });

  it("숫자 리터럴은 정수·소수·음수를 허용한다", () => {
    expect(ast("50")).toEqual({ kind: "literal", literal: { type: "number", value: 50 } });
    expect(ast("2.5")).toEqual({ kind: "literal", literal: { type: "number", value: 2.5 } });
    expect(ast("-3")).toEqual({ kind: "literal", literal: { type: "number", value: -3 } });
  });

  it("true / false 는 boolean 리터럴이다", () => {
    expect(ast("true")).toEqual({ kind: "literal", literal: { type: "boolean", value: true } });
    expect(ast("false")).toEqual({ kind: "literal", literal: { type: "boolean", value: false } });
  });

  it("날짜 리터럴은 d'YYYY-MM-DD' 다", () => {
    expect(ast("d'2026-01-01'")).toEqual({
      kind: "literal",
      literal: { type: "date", value: "2026-01-01" },
    });
  });

  it("형식이 틀린 날짜 리터럴은 문법 오류다", () => {
    expect(syntaxError("d'2026-1-1'")).toContain("날짜");
    expect(syntaxError("d'2026-13-01'")).toContain("날짜");
    expect(syntaxError("d'2026-02-30'")).toContain("날짜");
  });

  it("닫히지 않은 문자열은 문법 오류다", () => {
    expect(syntaxError("'abc")).toContain("문자열");
  });
});

describe("참조 경로", () => {
  it("<구분자코드> 하나는 const·파생 구분자 참조다", () => {
    expect(ast("avg_rate")).toEqual({
      kind: "ref",
      ref: { kind: "discriminator", code: "avg_rate" },
    });
  });

  it("<구분자코드>.<필드코드> 는 구조체 필드 참조다", () => {
    expect(ast("cov_pay.exempt")).toEqual({
      kind: "ref",
      ref: { kind: "discriminator", code: "cov_pay", field: "exempt" },
    });
  });

  it("코드에 한글을 쓸 수 있다", () => {
    expect(ast("보험금지급.면책여부")).toEqual({
      kind: "ref",
      ref: { kind: "discriminator", code: "보험금지급", field: "면책여부" },
    });
  });

  it("builtin.<레벨>.<속성> 은 내장 경로(뼈대 속성) 참조다", () => {
    expect(ast("builtin.subCoverage.name")).toEqual({
      kind: "ref",
      ref: { kind: "builtin", level: "subCoverage", prop: "name" },
    });
  });

  it("builtin 의 레벨은 5개 부착 레벨 중 하나여야 한다", () => {
    expect(syntaxError("builtin.foo.name")).toContain("레벨");
  });

  it("세 단계 이상의 경로는 문법 오류다", () => {
    expect(syntaxError("a.b.c")).toContain("경로");
  });

  it("attr.<속성종류코드> 는 담보속성 참조이며 단독으로는 쓸 수 없다", () => {
    expect(syntaxError("attr.renew")).toContain("담보속성");
  });

  it("예약어는 구분자 코드로 쓸 수 없다", () => {
    expect(syntaxError("and")).toContain("예약어");
    expect(syntaxError("count.x")).toContain("예약어");
  });
});

describe("비교", () => {
  it("= 는 비교 노드를 만든다", () => {
    expect(ast("renew = true")).toEqual({
      kind: "compare",
      op: "=",
      left: { kind: "ref", ref: { kind: "discriminator", code: "renew" } },
      right: { kind: "literal", literal: { type: "boolean", value: true } },
    });
  });

  it("!= 는 ≠ 로 정규화된다", () => {
    expect(ast("a != 1")).toEqual(ast("a ≠ 1"));
    expect(ast("a ≠ 1")).toMatchObject({ kind: "compare", op: "≠" });
  });

  it("< <= > >= 를 지원한다", () => {
    expect(ast("a < 1")).toMatchObject({ op: "<" });
    expect(ast("a <= 1")).toMatchObject({ op: "<=" });
    expect(ast("a > 1")).toMatchObject({ op: ">" });
    expect(ast("a >= 1")).toMatchObject({ op: ">=" });
  });

  it("비교는 연쇄할 수 없다 (a = b = c 는 문법 오류)", () => {
    expect(syntaxError("a = b = c")).toContain("연쇄");
  });

  it("enum 값은 '코드' 문자열 리터럴로 비교한다", () => {
    expect(ast("prod.notice = 'simple'")).toEqual({
      kind: "compare",
      op: "=",
      left: { kind: "ref", ref: { kind: "discriminator", code: "prod", field: "notice" } },
      right: { kind: "literal", literal: { type: "string", value: "simple" } },
    });
  });
});

describe("논리와 우선순위", () => {
  it("and 는 or 보다 먼저 묶인다", () => {
    expect(ast("a or b and c")).toEqual({
      kind: "or",
      left: { kind: "ref", ref: { kind: "discriminator", code: "a" } },
      right: {
        kind: "and",
        left: { kind: "ref", ref: { kind: "discriminator", code: "b" } },
        right: { kind: "ref", ref: { kind: "discriminator", code: "c" } },
      },
    });
  });

  it("비교는 and 보다 먼저 묶인다", () => {
    expect(ast("a = 1 and b = 2")).toEqual({
      kind: "and",
      left: { kind: "compare", op: "=", left: ast("a"), right: ast("1") },
      right: { kind: "compare", op: "=", left: ast("b"), right: ast("2") },
    });
  });

  it("not 은 비교보다 먼저 묶인다 (not a = b 는 (not a) = b)", () => {
    expect(ast("not a = b")).toEqual({
      kind: "compare",
      op: "=",
      left: { kind: "not", operand: ast("a") },
      right: ast("b"),
    });
  });

  it("괄호로 우선순위를 바꾼다", () => {
    expect(ast("(a or b) and c")).toEqual({
      kind: "and",
      left: { kind: "or", left: ast("a"), right: ast("b") },
      right: ast("c"),
    });
    expect(ast("not (a = b)")).toEqual({ kind: "not", operand: ast("a = b") });
  });

  it("같은 연산자는 왼쪽부터 묶인다", () => {
    expect(ast("a and b and c")).toEqual({
      kind: "and",
      left: { kind: "and", left: ast("a"), right: ast("b") },
      right: ast("c"),
    });
  });

  it("not 을 겹쳐 쓸 수 있다", () => {
    expect(ast("not not a")).toEqual({ kind: "not", operand: { kind: "not", operand: ast("a") } });
  });

  it("닫히지 않은 괄호는 문법 오류다", () => {
    expect(syntaxError("(a and b")).toContain(")");
  });
});

describe("집계", () => {
  it("집계 6종은 경로 하나를 인자로 받는다", () => {
    for (const op of ["any", "all", "sum", "count", "exist", "notexist"] as const) {
      expect(ast(`${op}(cov_pay.exempt)`)).toEqual({
        kind: "aggregate",
        op,
        ref: { kind: "discriminator", code: "cov_pay", field: "exempt" },
      });
    }
  });

  it("집계 인자는 리터럴이나 식이 될 수 없다", () => {
    expect(syntaxError("any(true)")).toContain("경로");
    expect(syntaxError("sum(a = 1)")).toContain("경로");
  });

  it("집계 인자로 내장 경로를 쓸 수 있다", () => {
    expect(ast("count(builtin.plan.name)")).toEqual({
      kind: "aggregate",
      op: "count",
      ref: { kind: "builtin", level: "plan", prop: "name" },
    });
  });

  it("집계 결과를 비교·논리에 쓸 수 있다", () => {
    expect(ast("count(builtin.plan.name) > 1 and any(cov_pay.exempt)")).toMatchObject({
      kind: "and",
      left: { kind: "compare", op: ">" },
      right: { kind: "aggregate", op: "any" },
    });
  });
});

describe("담보속성", () => {
  it("exist(attr.X) · notexist(attr.X) 를 쓸 수 있다", () => {
    expect(ast("exist(attr.renew)")).toEqual({
      kind: "aggregate",
      op: "exist",
      ref: { kind: "attr", code: "renew" },
    });
    expect(ast("notexist(attr.renew)")).toMatchObject({ op: "notexist" });
  });

  it("attr.X = '값' · attr.X ≠ '값' 을 쓸 수 있다", () => {
    expect(ast("attr.renew = 'renewable'")).toEqual({
      kind: "compare",
      op: "=",
      left: { kind: "ref", ref: { kind: "attr", code: "renew" } },
      right: { kind: "literal", literal: { type: "string", value: "renewable" } },
    });
    expect(ast("attr.renew != 'renewable'")).toMatchObject({ op: "≠" });
  });

  it("담보속성의 RHS 는 문자열 리터럴만 허용한다", () => {
    expect(syntaxError("attr.renew = renew_flag")).toContain("담보속성");
    expect(syntaxError("attr.renew = true")).toContain("담보속성");
  });

  it("담보속성에는 < <= > >= 를 쓸 수 없다", () => {
    expect(syntaxError("attr.renew > 'a'")).toContain("담보속성");
  });

  it("담보속성은 비교의 오른쪽에 올 수 없다", () => {
    expect(syntaxError("'renewable' = attr.renew")).toContain("담보속성");
  });

  it("담보속성은 any·all·sum·count 의 인자가 될 수 없다", () => {
    expect(syntaxError("any(attr.renew)")).toContain("담보속성");
    expect(syntaxError("count(attr.renew)")).toContain("담보속성");
  });
});

describe("문법 오류 형태", () => {
  it("빈 식은 문법 오류다", () => {
    expect(syntaxError("")).toContain("빈");
    expect(syntaxError("   ")).toContain("빈");
  });

  it("알 수 없는 문자는 위치와 함께 보고한다", () => {
    expect(syntaxError("a = 1 @ 2")).toContain("6");
  });

  it("식 끝에 남는 토큰은 문법 오류다", () => {
    expect(syntaxError("a b")).toContain("b");
  });

  it("산술 연산자는 지원하지 않는다", () => {
    expect(syntaxError("a + 1")).toContain("+");
  });

  it("거부 형태는 Rejection{reason:'invalid', issues:[{kind:'syntax'}]} 이며 좌표는 호출자가 준 것을 쓴다", () => {
    const r = parse("a +", { document: "clause", articleTitle: "소멸" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.rejection).toMatchObject({
      reason: "invalid",
      issues: [{ kind: "syntax", at: { document: "clause", articleTitle: "소멸" } }],
    });
    const bare = parse("a +");
    if (bare.ok) return;
    expect(bare.rejection).toMatchObject({ reason: "invalid", issues: [{ kind: "syntax", at: {} }] });
  });
});
