import { describe, expect, it } from "vitest";

import { NOT_ENTERED, entered } from "../types";
import type { Code, Coordinate, Value, ValueSlot } from "../types";
import type { Expr, ValueRef } from "./ast";
import { refPath } from "./ast";
import { evaluate } from "./evaluate";
import type { AttributeResult, EvalContext, EvalResult, LookupResult } from "./evaluate";
import { parse } from "./parser";

function ast(src: string): Expr {
  const r = parse(src);
  if (!r.ok) throw new Error(`파싱 실패: ${JSON.stringify(r.rejection)}`);
  return r.value;
}

/** 테스트용 문맥 빌더 — 표 하나로 lookup/attribute/children 을 만든다. */
interface Spec {
  /** 경로 → ValueSlot | 'undetermined' | 'missing' | 'broken' */
  slots?: Record<string, ValueSlot | "undetermined" | "missing" | "broken">;
  /** 속성코드 → 값 | 'unused' | 'undetermined' */
  attrs?: Record<string, Code | "unused" | "undetermined">;
  /** 경로 → 하위 문맥들 (undefined 면 열거 불가 = 미결) */
  children?: Record<string, Spec[] | "undetermined">;
  coordinate?: Coordinate;
}

function ctx(spec: Spec): EvalContext {
  return {
    coordinate: spec.coordinate,
    lookup(ref: ValueRef): LookupResult {
      const s = spec.slots?.[refPath(ref)];
      if (s === undefined || s === "missing") return { kind: "missing" };
      if (s === "broken") return { kind: "missing", issue: "brokenRef" };
      if (s === "undetermined") return { kind: "undetermined" };
      return { kind: "slot", slot: s };
    },
    attribute(code: Code): AttributeResult {
      const a = spec.attrs?.[code];
      if (a === undefined || a === "unused") return { kind: "unused" };
      if (a === "undetermined") return { kind: "undetermined" };
      return { kind: "value", value: a };
    },
    children(ref: ValueRef): EvalContext[] | undefined {
      const c = spec.children?.[refPath(ref)];
      if (c === undefined || c === "undetermined") return undefined;
      return c.map(ctx);
    },
  };
}

const value = (v: Value): EvalResult => ({ kind: "value", value: v });

function run(src: string, spec: Spec = {}): EvalResult {
  return evaluate(ast(src), ctx(spec));
}

describe("리터럴과 참조", () => {
  it("리터럴은 그 값이다", () => {
    expect(run("'x'")).toEqual(value("x"));
    expect(run("2.5")).toEqual(value(2.5));
    expect(run("true")).toEqual(value(true));
    expect(run("d'2026-01-01'")).toEqual(value("2026-01-01"));
  });

  it("입력된 값 자리는 그 값이다", () => {
    expect(run("cov_pay.rate", { slots: { "cov_pay.rate": entered(50) } })).toEqual(value(50));
    expect(run("avg_rate", { slots: { avg_rate: entered("2.5%") } })).toEqual(value("2.5%"));
  });

  it("미입력 값 자리 참조는 notEntered 오류다 — 조용한 false 는 없다", () => {
    const r = run("cov_pay.exempt", {
      slots: { "cov_pay.exempt": NOT_ENTERED },
      coordinate: { document: "special", ownerName: "일반상해사망(추가)" },
    });
    expect(r).toMatchObject({
      kind: "error",
      issue: {
        kind: "notEntered",
        at: { document: "special", ownerName: "일반상해사망(추가)", refPath: "cov_pay.exempt" },
      },
    });
  });

  it("값 자리 자체가 없으면 notAttached (기본) 또는 brokenRef 오류다", () => {
    expect(run("cov_pay.exempt")).toMatchObject({
      kind: "error",
      issue: { kind: "notAttached", at: { refPath: "cov_pay.exempt" } },
    });
    expect(run("gone", { slots: { gone: "broken" } })).toMatchObject({
      kind: "error",
      issue: { kind: "brokenRef", at: { refPath: "gone" } },
    });
  });

  it("문맥이 모르는 레벨의 참조는 미결이며 이유에 경로가 실린다", () => {
    expect(run("prod.notice", { slots: { "prod.notice": "undetermined" } })).toEqual({
      kind: "undetermined",
      reason: "prod.notice",
    });
  });

  it("내장 경로도 같은 lookup 으로 읽는다", () => {
    expect(
      run("builtin.subCoverage.name", { slots: { "builtin.subCoverage.name": entered("1종수술") } }),
    ).toEqual(value("1종수술"));
  });
});

describe("비교", () => {
  const slots = {
    "cov_pay.rate": entered(50),
    "cov_pay.since": entered("2026-03-01"),
    "prod.notice": entered("simple"),
    "cov_pay.exempt": entered(false),
    "cov_pay.causes": entered(["a", "b"]),
  };

  it("= ≠ 는 같은 타입의 값을 비교한다", () => {
    expect(run("cov_pay.rate = 50", { slots })).toEqual(value(true));
    expect(run("cov_pay.rate ≠ 50", { slots })).toEqual(value(false));
    expect(run("prod.notice = 'simple'", { slots })).toEqual(value(true));
    expect(run("cov_pay.exempt = false", { slots })).toEqual(value(true));
  });

  it("< <= > >= 는 number 와 date(문자열 순서) 에 쓴다", () => {
    expect(run("cov_pay.rate > 49", { slots })).toEqual(value(true));
    expect(run("cov_pay.rate <= 49", { slots })).toEqual(value(false));
    expect(run("cov_pay.since < d'2026-04-01'", { slots })).toEqual(value(true));
    expect(run("cov_pay.since >= d'2026-03-01'", { slots })).toEqual(value(true));
  });

  it("양변 타입이 다르면 typeMismatch 오류다", () => {
    expect(run("cov_pay.rate = 'a'", { slots })).toMatchObject({
      kind: "error",
      issue: { kind: "typeMismatch", at: { refPath: "cov_pay.rate" } },
    });
    expect(run("cov_pay.exempt < true", { slots })).toMatchObject({
      kind: "error",
      issue: { kind: "typeMismatch" },
    });
    expect(run("cov_pay.causes = 'a'", { slots })).toMatchObject({
      kind: "error",
      issue: { kind: "typeMismatch" },
    });
  });

  it("한쪽이 미결이면 비교도 미결이다", () => {
    expect(run("prod.notice = 'simple'", { slots: { "prod.notice": "undetermined" } })).toEqual({
      kind: "undetermined",
      reason: "prod.notice",
    });
  });

  it("한쪽이 오류면 비교도 오류다 (오류가 미결보다 우선)", () => {
    expect(
      run("a = b", { slots: { a: "undetermined", b: NOT_ENTERED } }),
    ).toMatchObject({ kind: "error", issue: { kind: "notEntered", at: { refPath: "b" } } });
  });
});

describe("논리 — 결정 가능하면 결정, 아니면 미결, 오류는 우선", () => {
  const T = entered(true);
  const F = entered(false);

  it("and · or · not 의 기본 동작", () => {
    expect(run("a and b", { slots: { a: T, b: T } })).toEqual(value(true));
    expect(run("a and b", { slots: { a: T, b: F } })).toEqual(value(false));
    expect(run("a or b", { slots: { a: F, b: T } })).toEqual(value(true));
    expect(run("a or b", { slots: { a: F, b: F } })).toEqual(value(false));
    expect(run("not a", { slots: { a: T } })).toEqual(value(false));
  });

  it("and 의 왼쪽이 false 면 오른쪽을 평가하지 않는다 (exist 가드 관용구)", () => {
    expect(run("a and b", { slots: { a: F, b: NOT_ENTERED } })).toEqual(value(false));
    expect(run("exist(attr.renew) and attr.renew = 'r'", { attrs: { renew: "unused" } })).toEqual(
      value(false),
    );
  });

  it("or 의 왼쪽이 true 면 오른쪽을 평가하지 않는다", () => {
    expect(run("a or b", { slots: { a: T, b: NOT_ENTERED } })).toEqual(value(true));
  });

  it("and 는 한쪽이 false 면 다른 쪽이 미결이어도 false 다", () => {
    expect(run("a and b", { slots: { a: "undetermined", b: F } })).toEqual(value(false));
    expect(run("a and b", { slots: { a: "undetermined", b: T } })).toEqual({
      kind: "undetermined",
      reason: "a",
    });
    expect(run("a and b", { slots: { a: T, b: "undetermined" } })).toEqual({
      kind: "undetermined",
      reason: "b",
    });
  });

  it("or 는 한쪽이 true 면 다른 쪽이 미결이어도 true 다", () => {
    expect(run("a or b", { slots: { a: "undetermined", b: T } })).toEqual(value(true));
    expect(run("a or b", { slots: { a: "undetermined", b: F } })).toEqual({
      kind: "undetermined",
      reason: "a",
    });
  });

  it("오류는 미결보다 우선한다", () => {
    expect(run("a and b", { slots: { a: "undetermined", b: NOT_ENTERED } })).toMatchObject({
      kind: "error",
      issue: { kind: "notEntered" },
    });
    expect(run("a or b", { slots: { a: NOT_ENTERED, b: T } })).toMatchObject({
      kind: "error",
      issue: { kind: "notEntered" },
    });
  });

  it("not 은 미결·오류를 그대로 전파한다", () => {
    expect(run("not a", { slots: { a: "undetermined" } })).toEqual({ kind: "undetermined", reason: "a" });
    expect(run("not a", { slots: { a: NOT_ENTERED } })).toMatchObject({ kind: "error" });
  });

  it("boolean 이 아닌 값에 논리를 쓰면 typeMismatch 오류다", () => {
    expect(run("not a", { slots: { a: entered(1) } })).toMatchObject({
      kind: "error",
      issue: { kind: "typeMismatch" },
    });
    expect(run("a and true", { slots: { a: entered("x") } })).toMatchObject({
      kind: "error",
      issue: { kind: "typeMismatch" },
    });
  });
});

describe("담보속성 (ADR-0015)", () => {
  it("attr.X = '값' · ≠ 은 속성 값과 비교한다", () => {
    expect(run("attr.renew = 'r'", { attrs: { renew: "r" } })).toEqual(value(true));
    expect(run("attr.renew ≠ 'r'", { attrs: { renew: "r" } })).toEqual(value(false));
    expect(run("attr.renew = 'r'", { attrs: { renew: "f" } })).toEqual(value(false));
  });

  it("미사용 속성의 = ≠ 는 unusedAttribute 오류 + 좌표다", () => {
    expect(run("attr.renew = 'r'", { coordinate: { document: "special", ownerId: "pc1" } })).toMatchObject({
      kind: "error",
      issue: { kind: "unusedAttribute", at: { document: "special", ownerId: "pc1", refPath: "attr.renew" } },
    });
  });

  it("exist(attr.X) 는 사용 중이면 true, 미사용이면 false (오류 아님)", () => {
    expect(run("exist(attr.renew)", { attrs: { renew: "r" } })).toEqual(value(true));
    expect(run("exist(attr.renew)")).toEqual(value(false));
    expect(run("notexist(attr.renew)")).toEqual(value(true));
  });

  it("담보약관 편집 문맥처럼 속성을 모르면 미결이다", () => {
    expect(run("attr.renew = 'r'", { attrs: { renew: "undetermined" } })).toEqual({
      kind: "undetermined",
      reason: "attr.renew",
    });
    expect(run("exist(attr.renew)", { attrs: { renew: "undetermined" } })).toEqual({
      kind: "undetermined",
      reason: "attr.renew",
    });
  });
});

describe("집계 — 하위 문맥 각각 lookup", () => {
  const benefit = (exempt: ValueSlot | "undetermined" | "missing", rate = 10): Spec => ({
    slots: { "pay.exempt": exempt, "pay.rate": entered(rate) },
    coordinate: { articleTitle: "급부" },
  });

  it("any 는 하나라도 true 면 true, all 은 전부 true 여야 true", () => {
    const spec: Spec = {
      children: { "pay.exempt": [benefit(entered(true)), benefit(entered(false))] },
    };
    expect(run("any(pay.exempt)", spec)).toEqual(value(true));
    expect(run("all(pay.exempt)", spec)).toEqual(value(false));
  });

  it("범위가 비어 있으면 any=false · all=true · sum=0 · count=0 · exist=false", () => {
    const spec: Spec = { children: { "pay.exempt": [], "pay.rate": [] } };
    expect(run("any(pay.exempt)", spec)).toEqual(value(false));
    expect(run("all(pay.exempt)", spec)).toEqual(value(true));
    expect(run("sum(pay.rate)", spec)).toEqual(value(0));
    expect(run("count(pay.rate)", spec)).toEqual(value(0));
    expect(run("exist(pay.rate)", spec)).toEqual(value(false));
    expect(run("notexist(pay.rate)", spec)).toEqual(value(true));
  });

  it("sum 은 합, count 는 distinct 개수다", () => {
    const spec: Spec = {
      children: { "pay.rate": [benefit(entered(true), 10), benefit(entered(true), 20), benefit(entered(true), 10)] },
    };
    expect(run("sum(pay.rate)", spec)).toEqual(value(40));
    expect(run("count(pay.rate)", spec)).toEqual(value(2));
  });

  it("exist 는 값 자리를 가진 하위 실체가 하나라도 있으면 true 다", () => {
    expect(
      run("exist(pay.rate)", { children: { "pay.rate": [{ slots: {} }, benefit(entered(true))] } }),
    ).toEqual(value(true));
    expect(run("exist(pay.rate)", { children: { "pay.rate": [{ slots: {} }] } })).toEqual(value(false));
  });

  it("하위 실체의 미입력·미부착은 오류이며 좌표는 그 하위 문맥의 것이다", () => {
    const r = run("any(pay.exempt)", {
      coordinate: { document: "special" },
      children: { "pay.exempt": [benefit(entered(false)), benefit(NOT_ENTERED)] },
    });
    expect(r).toMatchObject({
      kind: "error",
      issue: { kind: "notEntered", at: { articleTitle: "급부", refPath: "pay.exempt" } },
    });
    expect(run("sum(pay.rate)", { children: { "pay.rate": [{ slots: {} }] } })).toMatchObject({
      kind: "error",
      issue: { kind: "notAttached" },
    });
  });

  it("하위 실체가 미결이면 결정 가능할 때만 결정한다", () => {
    const mixed = [benefit(entered(true)), benefit("undetermined")];
    expect(run("any(pay.exempt)", { children: { "pay.exempt": mixed } })).toEqual(value(true));
    expect(run("all(pay.exempt)", { children: { "pay.exempt": mixed } })).toEqual({
      kind: "undetermined",
      reason: "pay.exempt",
    });
    expect(
      run("all(pay.exempt)", { children: { "pay.exempt": [benefit(entered(false)), benefit("undetermined")] } }),
    ).toEqual(value(false));
    expect(run("sum(pay.rate)", { children: { "pay.rate": [{ slots: { "pay.rate": "undetermined" } }] } })).toEqual({
      kind: "undetermined",
      reason: "pay.rate",
    });
  });

  it("하위 실체 하나라도 오류면 오류가 미결보다 우선한다", () => {
    expect(
      run("any(pay.exempt)", { children: { "pay.exempt": [benefit("undetermined"), benefit(NOT_ENTERED)] } }),
    ).toMatchObject({ kind: "error", issue: { kind: "notEntered" } });
  });

  it("문맥이 하위 트리를 열거할 수 없으면 미결이다", () => {
    expect(run("any(pay.exempt)", { children: { "pay.exempt": "undetermined" } })).toEqual({
      kind: "undetermined",
      reason: "pay.exempt",
    });
  });

  it("any·all 의 하위 값이 boolean 이 아니면 typeMismatch, sum 이 number 가 아니면 typeMismatch", () => {
    expect(run("any(pay.rate)", { children: { "pay.rate": [benefit(entered(true))] } })).toMatchObject({
      kind: "error",
      issue: { kind: "typeMismatch" },
    });
    expect(run("sum(pay.exempt)", { children: { "pay.exempt": [benefit(entered(true))] } })).toMatchObject({
      kind: "error",
      issue: { kind: "typeMismatch" },
    });
  });

  it("집계 결과를 비교에 쓸 수 있다 (종별 문구 유즈케이스)", () => {
    const plans = [
      { slots: { "builtin.plan.name": entered("1종") } },
      { slots: { "builtin.plan.name": entered("2종") } },
    ];
    expect(run("count(builtin.plan.name) > 1", { children: { "builtin.plan.name": plans } })).toEqual(
      value(true),
    );
  });
});

describe("관통 1 시나리오", () => {
  it("면책여부합 = any(보험금지급.면책여부) 로 제2조 on/off", () => {
    const coverage: Spec = {
      coordinate: { document: "special", ownerName: "일반상해사망" },
      children: {
        "cov_pay.exempt": [{ slots: { "cov_pay.exempt": entered(true) } }],
      },
    };
    expect(run("any(cov_pay.exempt)", coverage)).toEqual(value(true));
  });

  it("계약일 vs 최초계약일 인라인 조건: attr.갱신유형 = '갱신형'", () => {
    expect(run("attr.renew_type = 'renewable'", { attrs: { renew_type: "renewable" } })).toEqual(value(true));
    expect(run("attr.renew_type = 'renewable'", { attrs: { renew_type: "fixed" } })).toEqual(value(false));
  });
});
