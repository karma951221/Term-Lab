import { describe, expect, it } from "vitest";

import type { Issue } from "../types";
import type { Expr, Ref } from "./ast";
import { refPath } from "./ast";
import { parse } from "./parser";
import { checkCondition, checkTypes } from "./typecheck";
import type { ExprType, TypeResolver } from "./typecheck";

function ast(src: string): Expr {
  const r = parse(src);
  if (!r.ok) throw new Error(`파싱 실패: ${JSON.stringify(r.rejection)}`);
  return r.value;
}

/** 테스트용 타입 표 — 경로 → 타입. 없는 경로는 undefined (깨진 참조). */
const TABLE: Record<string, ExprType> = {
  "cov_pay.exempt": { kind: "boolean" },
  "cov_pay.rate": { kind: "number" },
  "cov_pay.since": { kind: "date" },
  "cov_pay.memo": { kind: "string" },
  "cov_pay.causes": { kind: "list<enum>", enumCode: "cause" },
  "prod.notice": { kind: "enum", enumCode: "notice" },
  "prod.notice2": { kind: "enum", enumCode: "notice" },
  "prod.other": { kind: "enum", enumCode: "other" },
  avg_rate: { kind: "string" },
  renew: { kind: "boolean" },
  "builtin.subCoverage.name": { kind: "string" },
  "builtin.plan.name": { kind: "string" },
  "attr.renew": { kind: "attribute", validValues: ["renewable", "fixed"] },
  "attr.add": { kind: "attribute" },
};
const resolve: TypeResolver = (ref: Ref) => TABLE[refPath(ref)];

function issuesOf(src: string, expectBoolean = false): Issue[] {
  const r = expectBoolean ? checkCondition(ast(src), resolve) : checkTypes(ast(src), resolve);
  if (r.ok) return [];
  if (r.rejection.reason !== "invalid") throw new Error("unreachable");
  return r.rejection.issues;
}

function typeOf(src: string): ExprType {
  const r = checkTypes(ast(src), resolve);
  if (!r.ok) throw new Error(`타입 검사 실패: ${JSON.stringify(r.rejection)}`);
  return r.value;
}

describe("checkTypes — 식의 타입", () => {
  it("리터럴은 자기 타입이다", () => {
    expect(typeOf("'x'")).toEqual({ kind: "string" });
    expect(typeOf("1")).toEqual({ kind: "number" });
    expect(typeOf("true")).toEqual({ kind: "boolean" });
    expect(typeOf("d'2026-01-01'")).toEqual({ kind: "date" });
  });

  it("참조는 조회한 타입이다", () => {
    expect(typeOf("cov_pay.rate")).toEqual({ kind: "number" });
    expect(typeOf("prod.notice")).toEqual({ kind: "enum", enumCode: "notice" });
    expect(typeOf("builtin.subCoverage.name")).toEqual({ kind: "string" });
  });

  it("조회되지 않는 참조는 brokenRef 이며 좌표에 경로가 실린다", () => {
    const issues = issuesOf("gone.field = 1");
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "brokenRef", at: { refPath: "gone.field" } });
  });

  it("호출자가 준 좌표 위에 refPath 를 얹는다", () => {
    const r = checkTypes(ast("gone = 1"), resolve, { coordinate: { document: "special", ownerId: "pc1" } });
    expect(r.ok).toBe(false);
    if (r.ok || r.rejection.reason !== "invalid") return;
    expect(r.rejection.issues[0].at).toEqual({ document: "special", ownerId: "pc1", refPath: "gone" });
  });
});

describe("비교의 타입 규칙", () => {
  it("같은 타입끼리 = ≠ 를 쓰면 boolean 이다", () => {
    expect(typeOf("cov_pay.rate = 1")).toEqual({ kind: "boolean" });
    expect(typeOf("cov_pay.exempt ≠ true")).toEqual({ kind: "boolean" });
    expect(typeOf("cov_pay.since = d'2026-01-01'")).toEqual({ kind: "boolean" });
    expect(typeOf("cov_pay.memo = avg_rate")).toEqual({ kind: "boolean" });
  });

  it("enum 은 '코드' 문자열 리터럴과 비교한다", () => {
    expect(typeOf("prod.notice = 'simple'")).toEqual({ kind: "boolean" });
  });

  it("같은 enum 끼리는 비교할 수 있고 다른 enum 끼리는 typeMismatch 다", () => {
    expect(typeOf("prod.notice = prod.notice2")).toEqual({ kind: "boolean" });
    expect(issuesOf("prod.notice = prod.other")).toMatchObject([{ kind: "typeMismatch" }]);
  });

  it("양변 타입이 다르면 typeMismatch 다", () => {
    expect(issuesOf("cov_pay.rate = 'a'")).toMatchObject([{ kind: "typeMismatch" }]);
    expect(issuesOf("cov_pay.exempt = 1")).toMatchObject([{ kind: "typeMismatch" }]);
    expect(issuesOf("cov_pay.since = '2026-01-01'")).toMatchObject([{ kind: "typeMismatch" }]);
  });

  it("< <= > >= 는 number 와 date 에만 쓴다", () => {
    expect(typeOf("cov_pay.rate > 50")).toEqual({ kind: "boolean" });
    expect(typeOf("cov_pay.since < d'2026-01-01'")).toEqual({ kind: "boolean" });
    expect(issuesOf("cov_pay.memo < 'z'")).toMatchObject([{ kind: "typeMismatch" }]);
    expect(issuesOf("cov_pay.exempt >= false")).toMatchObject([{ kind: "typeMismatch" }]);
  });

  it("list<enum> 은 비교할 수 없다", () => {
    expect(issuesOf("cov_pay.causes = 'a'")).toMatchObject([{ kind: "typeMismatch" }]);
  });
});

describe("논리의 타입 규칙", () => {
  it("and · or · not 의 피연산자는 boolean 이어야 한다", () => {
    expect(typeOf("renew and not cov_pay.exempt or true")).toEqual({ kind: "boolean" });
    expect(issuesOf("renew and cov_pay.rate")).toMatchObject([{ kind: "typeMismatch" }]);
    expect(issuesOf("not avg_rate")).toMatchObject([{ kind: "typeMismatch" }]);
  });

  it("오류는 하위 식마다 모아서 한 번에 보고한다", () => {
    const issues = issuesOf("gone1 and gone2.x = 1");
    expect(issues.map((i) => i.kind)).toEqual(["brokenRef", "brokenRef"]);
  });
});

describe("집계의 타입 규칙", () => {
  it("any · all 은 boolean 경로 → boolean", () => {
    expect(typeOf("any(cov_pay.exempt)")).toEqual({ kind: "boolean" });
    expect(typeOf("all(cov_pay.exempt)")).toEqual({ kind: "boolean" });
    expect(issuesOf("any(cov_pay.rate)")).toMatchObject([{ kind: "typeMismatch" }]);
  });

  it("sum 은 number 경로 → number", () => {
    expect(typeOf("sum(cov_pay.rate)")).toEqual({ kind: "number" });
    expect(issuesOf("sum(cov_pay.memo)")).toMatchObject([{ kind: "typeMismatch" }]);
  });

  it("count 는 스칼라 경로 → number (list<enum> 불가)", () => {
    expect(typeOf("count(builtin.plan.name)")).toEqual({ kind: "number" });
    expect(typeOf("count(prod.notice)")).toEqual({ kind: "number" });
    expect(issuesOf("count(cov_pay.causes)")).toMatchObject([{ kind: "typeMismatch" }]);
  });

  it("exist · notexist 는 어떤 경로든 → boolean", () => {
    expect(typeOf("exist(cov_pay.causes)")).toEqual({ kind: "boolean" });
    expect(typeOf("notexist(builtin.plan.name)")).toEqual({ kind: "boolean" });
  });

  it("집계 경로가 조회되지 않으면 brokenRef 다", () => {
    expect(issuesOf("any(gone.x)")).toMatchObject([{ kind: "brokenRef", at: { refPath: "gone.x" } }]);
  });
});

describe("담보속성의 타입 규칙 (ADR-0015)", () => {
  it("exist(attr.X) 와 attr.X = '유효값' 은 boolean 이다", () => {
    expect(typeOf("exist(attr.renew)")).toEqual({ kind: "boolean" });
    expect(typeOf("attr.renew = 'renewable'")).toEqual({ kind: "boolean" });
    expect(typeOf("attr.renew ≠ 'fixed'")).toEqual({ kind: "boolean" });
  });

  it("유효값 목록이 알려져 있으면 목록 밖 리터럴은 typeMismatch 다", () => {
    expect(issuesOf("attr.renew = 'nope'")).toMatchObject([
      { kind: "typeMismatch", at: { refPath: "attr.renew" } },
    ]);
  });

  it("유효값 목록을 모르면 어떤 문자열이든 허용한다", () => {
    expect(typeOf("attr.add = 'anything'")).toEqual({ kind: "boolean" });
  });

  it("조회되지 않는 담보속성은 brokenRef 다", () => {
    expect(issuesOf("exist(attr.gone)")).toMatchObject([{ kind: "brokenRef", at: { refPath: "attr.gone" } }]);
  });

  it("손으로 만든 AST 라도 담보속성 규칙 위반은 typeMismatch 다", () => {
    const bad: Expr = {
      kind: "compare",
      op: "<",
      left: { kind: "ref", ref: { kind: "attr", code: "renew" } },
      right: { kind: "ref", ref: { kind: "discriminator", code: "avg_rate" } },
    };
    const r = checkTypes(bad, resolve);
    expect(r.ok).toBe(false);
    if (r.ok || r.rejection.reason !== "invalid") return;
    expect(r.rejection.issues[0].kind).toBe("typeMismatch");
    const bare: Expr = { kind: "ref", ref: { kind: "attr", code: "renew" } };
    expect(checkTypes(bare, resolve).ok).toBe(false);
  });
});

describe("checkCondition — 조건 자리는 boolean", () => {
  it("boolean 식은 통과한다", () => {
    expect(issuesOf("renew and any(cov_pay.exempt)", true)).toEqual([]);
  });

  it("boolean 이 아닌 식은 typeMismatch 다", () => {
    expect(issuesOf("cov_pay.rate", true)).toMatchObject([{ kind: "typeMismatch" }]);
    expect(issuesOf("count(builtin.plan.name)", true)).toMatchObject([{ kind: "typeMismatch" }]);
  });

  it("하위 오류가 있으면 그 오류만 보고하고 boolean 검사를 중복 보고하지 않는다", () => {
    expect(issuesOf("gone", true).map((i) => i.kind)).toEqual(["brokenRef"]);
  });
});
