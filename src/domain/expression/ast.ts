/**
 * 식 언어 AST — 문면 조건식과 파생식이 공유하는 한 벌 (ADR-0013).
 *
 * 문법 정본: docs/03_설계/식언어.md. 여기에는 타입만 있다 (로직 없음).
 * 저장되는 식은 코드 기반 소스 문자열이고, AST 는 파서의 산출물이다.
 */

import type { AttachLevel, Code } from "../types";

// ───────────────────────────── 참조 ─────────────────────────────

/**
 * 구분자 참조 — `<구분자코드>` (const·파생) 또는 `<구분자코드>.<필드코드>` (구조체 필드).
 * 요구 구분자 추출(ADR-0010)의 단위는 `code` 다.
 */
export interface DiscriminatorRef {
  kind: "discriminator";
  code: Code;
  /** 구조체 필드 코드. 없으면 const·파생 구분자 그 자체. */
  field?: Code;
}

/**
 * 내장 경로 — 뼈대 속성 (담보_기획 「이름의 정체」). 소스 표기 `builtin.<레벨>.<속성>`.
 * 예: `builtin.subCoverage.name` (세부보장 이름) · `builtin.benefit.name` (급부 이름).
 * 속성 코드는 파서가 제한하지 않는다 — 타입 조회(TypeResolver)와 문맥이 안다.
 */
export interface BuiltinRef {
  kind: "builtin";
  level: AttachLevel;
  prop: string;
}

/** 담보속성 참조 — `attr.<속성종류코드>` (ADR-0015). exist · = · ≠ 에서만 쓸 수 있다. */
export interface AttributeRef {
  kind: "attr";
  code: Code;
}

/** 값 자리를 갖는 참조 (담보속성 제외). 문맥의 lookup/children 이 받는 것. */
export type ValueRef = DiscriminatorRef | BuiltinRef;

export type Ref = ValueRef | AttributeRef;

// ───────────────────────────── 리터럴 ─────────────────────────────

export type Literal =
  | { type: "string"; value: string }
  | { type: "number"; value: number }
  | { type: "boolean"; value: boolean }
  /** `d'YYYY-MM-DD'` — 값은 그 문자열 그대로 (types.ts 의 date 표현과 동일) */
  | { type: "date"; value: string };

// ───────────────────────────── 연산 ─────────────────────────────

/** 비교 연산. 소스의 `!=` 는 `≠` 로 정규화한다. */
export type CompareOp = "=" | "≠" | "<" | "<=" | ">" | ">=";

export const COMPARE_OPS: readonly CompareOp[] = ["=", "≠", "<", "<=", ">", ">="];

/** 집계 6종 (ADR-0007). `notexist` 는 소스에서 한 단어다. */
export type AggregateOp = "any" | "all" | "sum" | "count" | "exist" | "notexist";

export const AGGREGATE_OPS: readonly AggregateOp[] = [
  "any",
  "all",
  "sum",
  "count",
  "exist",
  "notexist",
];

// ───────────────────────────── 노드 ─────────────────────────────

export type Expr =
  | { kind: "literal"; literal: Literal }
  | { kind: "ref"; ref: Ref }
  | { kind: "compare"; op: CompareOp; left: Expr; right: Expr }
  | { kind: "and"; left: Expr; right: Expr }
  | { kind: "or"; left: Expr; right: Expr }
  | { kind: "not"; operand: Expr }
  /**
   * 집계. `ref` 는 집계 경로 — 값 참조(any·all·sum·count·exist·notexist)
   * 또는 담보속성(exist·notexist 만). 범위(하위 트리)는 문맥이 정한다.
   */
  | { kind: "aggregate"; op: AggregateOp; ref: Ref };

export type ExprKind = Expr["kind"];

// ───────────────────────────── 경로 문자열 ─────────────────────────────

/** 참조를 소스 표기(코드 기반 경로)로. `Coordinate.refPath` 에 넣는 문자열이 이것이다. */
export function refPath(ref: Ref): string {
  switch (ref.kind) {
    case "discriminator":
      return ref.field === undefined ? ref.code : `${ref.code}.${ref.field}`;
    case "builtin":
      return `builtin.${ref.level}.${ref.prop}`;
    case "attr":
      return `attr.${ref.code}`;
  }
}

/** 두 참조가 같은 자리를 가리키는가 (경로 동치). */
export function sameRef(a: Ref, b: Ref): boolean {
  return refPath(a) === refPath(b);
}
