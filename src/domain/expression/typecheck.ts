/**
 * 타입 검사 — 언어 밖 규칙(ADR-0013 「조건식 자리는 boolean」)을 식 위에서 검사한다.
 *
 * 타입 조회는 주입받는다 (`TypeResolver`) — 언어는 카탈로그를 모른다.
 * 오류는 하위 식마다 모아 한 번에 돌려주고, 오류가 난 하위 식의 타입은 「모름」으로 두어
 * 위로 연쇄 오류를 내지 않는다.
 */

import { ok, reject } from "../types";
import type { Code, Coordinate, FieldType, Issue, Result } from "../types";
import { refPath } from "./ast";
import type { CompareOp, Expr, Literal, Ref } from "./ast";

// ───────────────────────────── 타입 ─────────────────────────────

/**
 * 식의 타입. 필드 타입 6종(types.ts) + 담보속성.
 * 담보속성은 값 타입이 아니라 「탑재의 좌표」라 별도 종류다 — `validValues` 를 알면
 * `attr.X = '값'` 의 리터럴을 유효값 목록으로 검사한다.
 */
export type ExprType = FieldType | { kind: "attribute"; validValues?: Code[] };

/** 참조 → 타입. undefined 면 존재하지 않는 참조(brokenRef). */
export type TypeResolver = (ref: Ref) => ExprType | undefined;

export interface CheckOptions {
  /** 오류 좌표의 기본값. refPath 는 검사기가 얹는다. */
  coordinate?: Coordinate;
  /** 루트 식이 이 타입이어야 한다 (조건 자리면 boolean). */
  expect?: ExprType["kind"];
}

// ───────────────────────────── 검사 ─────────────────────────────

const BOOLEAN: ExprType = { kind: "boolean" };
const NUMBER: ExprType = { kind: "number" };

function literalType(lit: Literal): ExprType {
  return { kind: lit.type };
}

function describeType(t: ExprType): string {
  switch (t.kind) {
    case "enum":
    case "list<enum>":
      return `${t.kind}<${t.enumCode}>`;
    default:
      return t.kind;
  }
}

/** = / ≠ 로 비교 가능한 쌍인가. enum 은 string 리터럴(코드)과 비교한다. */
function equatable(a: ExprType, b: ExprType): boolean {
  if (a.kind === "list<enum>" || b.kind === "list<enum>") return false;
  if (a.kind === "attribute" || b.kind === "attribute") return false;
  if (a.kind === "enum" && b.kind === "enum") return a.enumCode === b.enumCode;
  if (a.kind === "enum") return b.kind === "string";
  if (b.kind === "enum") return a.kind === "string";
  return a.kind === b.kind;
}

/** < <= > >= 로 비교 가능한 쌍인가 — number 끼리, date 끼리만. */
function orderable(a: ExprType, b: ExprType): boolean {
  return a.kind === b.kind && (a.kind === "number" || a.kind === "date");
}

/**
 * 식의 타입을 계산하고 규칙 위반을 모은다.
 * 통과하면 `ok(타입)`, 아니면 `Rejection{reason:'invalid', issues}` (typeMismatch · brokenRef).
 */
export function checkTypes(
  expr: Expr,
  resolve: TypeResolver,
  options: CheckOptions = {},
): Result<ExprType> {
  const issues: Issue[] = [];
  const base = options.coordinate ?? {};

  const report = (kind: Issue["kind"], message: string, ref?: Ref) => {
    issues.push({
      kind,
      message,
      at: ref === undefined ? { ...base } : { ...base, refPath: refPath(ref) },
    });
  };

  /** 참조 타입 조회. 없으면 brokenRef 보고 후 undefined. */
  const typeOfRef = (ref: Ref): ExprType | undefined => {
    const t = resolve(ref);
    if (t === undefined) {
      report("brokenRef", `참조 ${refPath(ref)} 를 찾을 수 없습니다`, ref);
      return undefined;
    }
    if (ref.kind === "attr" && t.kind !== "attribute") {
      report("typeMismatch", `attr.${ref.code} 는 담보속성이어야 하는데 ${describeType(t)} 입니다`, ref);
      return undefined;
    }
    if (ref.kind !== "attr" && t.kind === "attribute") {
      report("typeMismatch", `${refPath(ref)} 는 담보속성 타입일 수 없습니다 (attr.<코드> 로 참조)`, ref);
      return undefined;
    }
    return t;
  };

  /** 담보속성 비교(ADR-0015): LHS attr · = ≠ 만 · RHS 는 문자열 리터럴 · 유효값 안. */
  const checkAttributeCompare = (
    ref: Ref & { kind: "attr" },
    op: CompareOp,
    right: Expr,
  ): ExprType | undefined => {
    const t = typeOfRef(ref);
    if (t === undefined) return undefined;
    if (op !== "=" && op !== "≠") {
      report("typeMismatch", `담보속성 attr.${ref.code} 에는 = 와 ≠ 만 쓸 수 있습니다 ('${op}' 불가)`, ref);
      return undefined;
    }
    if (right.kind !== "literal" || right.literal.type !== "string") {
      report("typeMismatch", `담보속성 attr.${ref.code} 의 비교 대상은 유효값 문자열 리터럴이어야 합니다`, ref);
      return undefined;
    }
    if (t.kind === "attribute" && t.validValues && !t.validValues.includes(right.literal.value)) {
      report(
        "typeMismatch",
        `'${right.literal.value}' 는 담보속성 attr.${ref.code} 의 유효값이 아닙니다 (${t.validValues.join("·")})`,
        ref,
      );
      return undefined;
    }
    return BOOLEAN;
  };

  const expectBoolean = (t: ExprType | undefined, what: string, ref?: Ref): boolean => {
    if (t === undefined) return false;
    if (t.kind === "boolean") return true;
    report("typeMismatch", `${what} 는 boolean 이어야 하는데 ${describeType(t)} 입니다`, ref);
    return false;
  };

  const walk = (e: Expr): ExprType | undefined => {
    switch (e.kind) {
      case "literal":
        return literalType(e.literal);

      case "ref": {
        if (e.ref.kind === "attr") {
          report(
            "typeMismatch",
            `담보속성 attr.${e.ref.code} 는 exist(attr.X) · attr.X = '값' · attr.X ≠ '값' 형태로만 쓸 수 있습니다`,
            e.ref,
          );
          return undefined;
        }
        return typeOfRef(e.ref);
      }

      case "not": {
        const t = walk(e.operand);
        return expectBoolean(t, "not 의 피연산자") ? BOOLEAN : undefined;
      }

      case "and":
      case "or": {
        const l = walk(e.left);
        const r = walk(e.right);
        const lok = expectBoolean(l, `${e.kind} 의 왼쪽`);
        const rok = expectBoolean(r, `${e.kind} 의 오른쪽`);
        return lok && rok ? BOOLEAN : undefined;
      }

      case "compare": {
        if (e.left.kind === "ref" && e.left.ref.kind === "attr") {
          return checkAttributeCompare(e.left.ref, e.op, e.right);
        }
        const l = walk(e.left);
        const r = walk(e.right);
        if (l === undefined || r === undefined) return undefined;
        const fine = e.op === "=" || e.op === "≠" ? equatable(l, r) : orderable(l, r);
        if (!fine) {
          const leftRef = e.left.kind === "ref" ? e.left.ref : undefined;
          report(
            "typeMismatch",
            `'${e.op}' 의 양변 타입이 맞지 않습니다: ${describeType(l)} ${e.op} ${describeType(r)}`,
            leftRef,
          );
          return undefined;
        }
        return BOOLEAN;
      }

      case "aggregate": {
        const t = typeOfRef(e.ref);
        if (t === undefined) return undefined;
        switch (e.op) {
          case "exist":
          case "notexist":
            return BOOLEAN;
          case "any":
          case "all":
            return expectBoolean(t, `${e.op} 의 경로 ${refPath(e.ref)}`, e.ref) ? BOOLEAN : undefined;
          case "sum":
            if (t.kind !== "number") {
              report("typeMismatch", `sum 의 경로 ${refPath(e.ref)} 는 number 여야 하는데 ${describeType(t)} 입니다`, e.ref);
              return undefined;
            }
            return NUMBER;
          case "count":
            if (t.kind === "list<enum>" || t.kind === "attribute") {
              report("typeMismatch", `count 의 경로 ${refPath(e.ref)} 는 스칼라여야 하는데 ${describeType(t)} 입니다`, e.ref);
              return undefined;
            }
            return NUMBER;
        }
      }
    }
  };

  const type = walk(expr);
  if (type !== undefined && options.expect !== undefined && type.kind !== options.expect) {
    report("typeMismatch", `식의 결과는 ${options.expect} 이어야 하는데 ${describeType(type)} 입니다`);
  }
  if (issues.length > 0 || type === undefined) {
    return reject({ reason: "invalid", issues });
  }
  return ok(type);
}

/** 조건 자리(if/elif · 인라인 조건) 검사 — 결과가 boolean 이어야 한다. */
export function checkCondition(
  expr: Expr,
  resolve: TypeResolver,
  coordinate?: Coordinate,
): Result<ExprType> {
  return checkTypes(expr, resolve, { coordinate, expect: "boolean" });
}
