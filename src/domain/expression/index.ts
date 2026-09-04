/**
 * 식 언어(expression) 모듈 — 문면 조건식과 파생식이 공유하는 한 벌 (ADR-0013).
 *
 * 문법 정본: docs/03_설계/식언어.md
 *
 *   parse(src)                      소스 → AST (문법 오류는 Rejection invalid/syntax)
 *   format(expr, displayName?)      AST → 소스 (표시명 훅; parse∘format 동치)
 *   extractRefs(expr)               읽는 참조 전부 (집계·담보속성·내장 구분)
 *   requiredDiscriminatorCodes(expr) 요구 구분자 코드 집합 (ADR-0010 부착 검사)
 *   isAliasExpression(expr)         별칭형 파생 판정 (정의 저장 시 거부)
 *   checkTypes / checkCondition     타입 검사 (타입 조회 주입)
 *   evaluate(expr, ctx)             평가 (문맥 주입) → 값 | 미결 | 오류
 *
 * DB·React import 금지 (순수층).
 */

export type {
  AggregateOp,
  AttributeRef,
  BuiltinRef,
  CompareOp,
  DiscriminatorRef,
  Expr,
  ExprKind,
  Literal,
  Ref,
  ValueRef,
} from "./ast";
export { AGGREGATE_OPS, COMPARE_OPS, refPath, sameRef } from "./ast";

export { parse, RESERVED_WORDS } from "./parser";

export type { DisplayName } from "./format";
export { format, formatLiteral } from "./format";

export type { ExtractedRef } from "./refs";
export { extractRefs, isAliasExpression, requiredDiscriminatorCodes } from "./refs";

export type { CheckOptions, ExprType, TypeResolver } from "./typecheck";
export { checkCondition, checkTypes } from "./typecheck";

export type { AttributeResult, EvalContext, EvalResult, LookupResult } from "./evaluate";
export { evaluate } from "./evaluate";
