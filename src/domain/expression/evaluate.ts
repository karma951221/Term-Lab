/**
 * 평가기 — 문맥(EvalContext)은 언어 밖에서 주입된다 (ADR-0013).
 *
 * 세 가지 결과: 값 · 미결(문맥이 그 자리를 모름 — 사전평가용) · 오류(Issue + 좌표).
 * 규칙 (ADR-0004 · ADR-0010 · ADR-0015):
 *   - 미입력 참조 → error notEntered. 조용한 false 는 없다.
 *   - 값 자리 자체가 없음(미부착·삭제) → error notAttached / brokenRef.
 *   - 미사용 담보속성의 = ≠ → error unusedAttribute. exist(attr.X) 는 unused 면 false.
 *   - and/or 는 3치 논리가 아니다 — 한쪽만으로 결정 가능하면 결정, 아니면 미결.
 *     왼쪽부터 평가하고 왼쪽에서 결정되면 오른쪽은 평가하지 않는다 (`exist(…) and …` 가드 관용구).
 *   - 오류는 미결보다 우선한다.
 *   - 집계는 문맥이 열거한 하위 문맥 각각에서 lookup 한다. 하나라도 오류면 오류.
 */

import type { Code, Coordinate, Issue, IssueKind, Value, ValueSlot } from "../types";
import { refPath } from "./ast";
import type { AggregateOp, CompareOp, Expr, Ref, ValueRef } from "./ast";

// ───────────────────────────── 문맥 계약 ─────────────────────────────

/** 값 자리 조회 결과. */
export type LookupResult =
  /** 값 자리가 있다 — 입력됐든 미입력이든 (ValueSlot 이 가른다). */
  | { kind: "slot"; slot: ValueSlot }
  /** 문맥이 그 레벨을 모른다 (담보약관 편집 문맥에서 상품 레벨 참조 등). */
  | { kind: "undetermined" }
  /**
   * 값 자리 자체가 없다. `issue` 로 원인을 가른다 — 기본 `notAttached`(요구 구분자 미부착),
   * 정의·필드가 삭제된 경우 `brokenRef`.
   */
  | { kind: "missing"; issue?: "notAttached" | "brokenRef" };

/** 담보속성 조회 결과. */
export type AttributeResult =
  | { kind: "value"; value: Code }
  /** 이 상품담보가 그 속성 종류를 쓰지 않는다 (sparse). */
  | { kind: "unused" }
  /** 문맥이 속성을 모른다 (담보 마스터 편집 문맥). */
  | { kind: "undetermined" };

/**
 * 평가 문맥 — 조립·사전평가·완결성 조회가 만든다. 언어는 문맥의 구조를 모른다.
 *
 * - `lookup(ref)`   : 값 참조(구분자 경로·내장 경로) → 값 자리.
 * - `attribute(code)`: 담보속성 종류 코드 → 이 상품담보의 속성 값.
 * - `children(ref)` : 집계용 — `ref` 의 부착 레벨에 맞는 **후손 실체들의 문맥**을 열거한다
 *   (담보 문맥에서 급부 레벨 경로면 아래 모든 급부; 자기 레벨이면 `[자기 자신]`).
 *   열거할 수 없으면 `undefined` (= 미결).
 * - `coordinate`    : 이 문맥에서 난 오류의 기본 좌표. 평가기가 `refPath` 를 얹는다.
 */
export interface EvalContext {
  lookup(ref: ValueRef): LookupResult;
  attribute(code: Code): AttributeResult;
  children(ref: ValueRef): EvalContext[] | undefined;
  coordinate?: Coordinate;
}

// ───────────────────────────── 결과 ─────────────────────────────

export type EvalResult =
  | { kind: "value"; value: Value }
  /** 미결 — `reason` 은 미결을 일으킨 참조 경로. */
  | { kind: "undetermined"; reason: string }
  | { kind: "error"; issue: Issue };

const TRUE: EvalResult = { kind: "value", value: true };
const FALSE: EvalResult = { kind: "value", value: false };

function val(value: Value): EvalResult {
  return { kind: "value", value };
}

function undetermined(ref: Ref): EvalResult {
  return { kind: "undetermined", reason: refPath(ref) };
}

function error(ctx: EvalContext, kind: IssueKind, message: string, ref?: Ref): EvalResult {
  const at: Coordinate = { ...(ctx.coordinate ?? {}) };
  if (ref !== undefined) at.refPath = refPath(ref);
  return { kind: "error", issue: { kind, message, at } };
}

function typeName(v: Value): string {
  return Array.isArray(v) ? "list" : typeof v;
}

// ───────────────────────────── 참조 ─────────────────────────────

function readValue(ctx: EvalContext, ref: ValueRef): EvalResult {
  const r = ctx.lookup(ref);
  switch (r.kind) {
    case "slot":
      if (r.slot.entered) return val(r.slot.value);
      return error(ctx, "notEntered", `${refPath(ref)} 가 미입력입니다`, ref);
    case "undetermined":
      return undetermined(ref);
    case "missing": {
      const kind = r.issue ?? "notAttached";
      const message =
        kind === "brokenRef"
          ? `${refPath(ref)} 참조가 깨졌습니다 (삭제된 구분자·필드)`
          : `${refPath(ref)} 의 값 자리가 없습니다 (구분자 미부착)`;
      return error(ctx, kind, message, ref);
    }
  }
}

// ───────────────────────────── 비교 ─────────────────────────────

function compareValues(
  ctx: EvalContext,
  op: CompareOp,
  l: Value,
  r: Value,
  ref: Ref | undefined,
): EvalResult {
  if (Array.isArray(l) || Array.isArray(r)) {
    return error(ctx, "typeMismatch", `list 값은 비교할 수 없습니다 ('${op}')`, ref);
  }
  if (typeof l !== typeof r) {
    return error(ctx, "typeMismatch", `'${op}' 의 양변 타입이 다릅니다: ${typeName(l)} ${op} ${typeName(r)}`, ref);
  }
  switch (op) {
    case "=":
      return val(l === r);
    case "≠":
      return val(l !== r);
    default:
      break;
  }
  if (typeof l === "boolean" || typeof r === "boolean") {
    return error(ctx, "typeMismatch", `boolean 에는 '${op}' 를 쓸 수 없습니다`, ref);
  }
  // number 끼리 · string(date 'YYYY-MM-DD') 끼리 — 사전순이 곧 날짜순
  switch (op) {
    case "<":
      return val(l < r);
    case "<=":
      return val(l <= r);
    case ">":
      return val(l > r);
    case ">=":
      return val(l >= r);
  }
}

function compareAttribute(
  ctx: EvalContext,
  ref: Ref & { kind: "attr" },
  op: CompareOp,
  right: Expr,
): EvalResult {
  if ((op !== "=" && op !== "≠") || right.kind !== "literal" || right.literal.type !== "string") {
    return error(ctx, "typeMismatch", `담보속성 attr.${ref.code} 는 = / ≠ 와 문자열 리터럴로만 비교합니다`, ref);
  }
  const a = ctx.attribute(ref.code);
  switch (a.kind) {
    case "value":
      return val(op === "=" ? a.value === right.literal.value : a.value !== right.literal.value);
    case "unused":
      return error(ctx, "unusedAttribute", `담보속성 attr.${ref.code} 를 이 상품담보가 쓰지 않습니다`, ref);
    case "undetermined":
      return undetermined(ref);
  }
}

// ───────────────────────────── 논리 ─────────────────────────────

/** boolean 값이어야 하는 결과를 검사. 값인데 boolean 이 아니면 typeMismatch 로 바꾼다. */
function asBoolean(ctx: EvalContext, r: EvalResult, what: string, ref?: Ref): EvalResult {
  if (r.kind === "value" && typeof r.value !== "boolean") {
    return error(ctx, "typeMismatch", `${what} 는 boolean 이어야 하는데 ${typeName(r.value)} 입니다`, ref);
  }
  return r;
}

function refOf(e: Expr): Ref | undefined {
  if (e.kind === "ref") return e.ref;
  if (e.kind === "aggregate") return e.ref;
  return undefined;
}

/**
 * and / or 공통 — `decider` 가 결정값(and 면 false, or 면 true).
 * 왼쪽이 결정값이면 오른쪽을 평가하지 않는다. 오류 > 미결 > 나머지.
 */
function logical(ctx: EvalContext, e: Expr & { kind: "and" | "or" }, decider: boolean): EvalResult {
  const l = asBoolean(ctx, evaluate(e.left, ctx), `${e.kind} 의 왼쪽`, refOf(e.left));
  if (l.kind === "error") return l;
  if (l.kind === "value" && l.value === decider) return l;
  const r = asBoolean(ctx, evaluate(e.right, ctx), `${e.kind} 의 오른쪽`, refOf(e.right));
  if (r.kind === "error") return r;
  if (r.kind === "value" && r.value === decider) return r;
  if (l.kind === "undetermined") return l;
  if (r.kind === "undetermined") return r;
  // 둘 다 값이고 둘 다 결정값이 아님 → and 면 true, or 면 false
  return val(!decider);
}

// ───────────────────────────── 집계 ─────────────────────────────

function aggregateAttribute(ctx: EvalContext, op: AggregateOp, ref: Ref & { kind: "attr" }): EvalResult {
  if (op !== "exist" && op !== "notexist") {
    return error(ctx, "typeMismatch", `담보속성 attr.${ref.code} 는 exist·notexist 에만 쓸 수 있습니다`, ref);
  }
  const a = ctx.attribute(ref.code);
  if (a.kind === "undetermined") return undetermined(ref);
  const exists = a.kind === "value";
  return val(op === "exist" ? exists : !exists);
}

function aggregate(ctx: EvalContext, op: AggregateOp, ref: ValueRef): EvalResult {
  const scope = ctx.children(ref);
  if (scope === undefined) return undetermined(ref);

  // exist / notexist — 값 자리가 있는 하위 실체가 하나라도 있는가. 미입력 자리는 오류.
  if (op === "exist" || op === "notexist") {
    let found = false;
    let pending: EvalResult | undefined;
    for (const child of scope) {
      const r = child.lookup(ref);
      if (r.kind === "missing") continue;
      if (r.kind === "undetermined") {
        pending ??= undetermined(ref);
        continue;
      }
      if (!r.slot.entered) return readValue(child, ref); // notEntered 오류
      found = true;
    }
    if (found) return val(op === "exist");
    if (pending) return pending;
    return val(op !== "exist");
  }

  // any / all / sum / count — 하위 값을 모아 계산. 오류 > 미결.
  const values: Value[] = [];
  let pending: EvalResult | undefined;
  for (const child of scope) {
    const r = readValue(child, ref);
    if (r.kind === "error") return r;
    if (r.kind === "undetermined") {
      pending ??= r;
      continue;
    }
    values.push(r.value);
  }

  switch (op) {
    case "any":
    case "all": {
      const decider = op === "any";
      for (const v of values) {
        if (typeof v !== "boolean") {
          return error(ctx, "typeMismatch", `${op} 의 경로 ${refPath(ref)} 값이 boolean 이 아닙니다 (${typeName(v)})`, ref);
        }
        if (v === decider) return val(decider);
      }
      if (pending) return pending;
      return val(!decider);
    }
    case "sum": {
      let total = 0;
      for (const v of values) {
        if (typeof v !== "number") {
          return error(ctx, "typeMismatch", `sum 의 경로 ${refPath(ref)} 값이 number 가 아닙니다 (${typeName(v)})`, ref);
        }
        total += v;
      }
      if (pending) return pending;
      return val(total);
    }
    case "count": {
      const distinct = new Set<string>();
      for (const v of values) {
        if (Array.isArray(v)) {
          return error(ctx, "typeMismatch", `count 의 경로 ${refPath(ref)} 값이 list 입니다`, ref);
        }
        distinct.add(`${typeof v}:${String(v)}`);
      }
      if (pending) return pending;
      return val(distinct.size);
    }
  }
}

// ───────────────────────────── 진입점 ─────────────────────────────

export function evaluate(expr: Expr, ctx: EvalContext): EvalResult {
  switch (expr.kind) {
    case "literal":
      return val(expr.literal.value);

    case "ref":
      if (expr.ref.kind === "attr") {
        return error(ctx, "typeMismatch", `담보속성 attr.${expr.ref.code} 는 exist · = · ≠ 로만 쓸 수 있습니다`, expr.ref);
      }
      return readValue(ctx, expr.ref);

    case "not": {
      const r = asBoolean(ctx, evaluate(expr.operand, ctx), "not 의 피연산자", refOf(expr.operand));
      if (r.kind !== "value") return r;
      return r.value === true ? FALSE : TRUE;
    }

    case "and":
      return logical(ctx, expr, false);
    case "or":
      return logical(ctx, expr, true);

    case "compare": {
      if (expr.left.kind === "ref" && expr.left.ref.kind === "attr") {
        return compareAttribute(ctx, expr.left.ref, expr.op, expr.right);
      }
      if (expr.right.kind === "ref" && expr.right.ref.kind === "attr") {
        return error(ctx, "typeMismatch", `담보속성 attr.${expr.right.ref.code} 는 비교의 왼쪽에만 올 수 있습니다`, expr.right.ref);
      }
      const l = evaluate(expr.left, ctx);
      const r = evaluate(expr.right, ctx);
      if (l.kind === "error") return l;
      if (r.kind === "error") return r;
      if (l.kind === "undetermined") return l;
      if (r.kind === "undetermined") return r;
      return compareValues(ctx, expr.op, l.value, r.value, refOf(expr.left) ?? refOf(expr.right));
    }

    case "aggregate":
      if (expr.ref.kind === "attr") return aggregateAttribute(ctx, expr.op, expr.ref);
      return aggregate(ctx, expr.op, expr.ref);
  }
}
