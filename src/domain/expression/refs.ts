/**
 * 참조 추출 · 별칭형 판정.
 *
 * - `extractRefs` : 식이 읽는 참조 전부 (집계 안의 경로·담보속성·내장 경로를 구분해서).
 *   공용조항의 요구 구분자 자동 추출(ADR-0010)·부착 해제 검사(담보_기획)·역인덱스가 쓴다.
 * - `requiredDiscriminatorCodes` : 위에서 구분자 코드만 뽑은 집합 — 부착 검사의 단위.
 * - `isAliasExpression` : 파생식이 단일 참조뿐인가 (별칭형 금지 — 구분자_기획).
 */

import type { Code } from "../types";
import { refPath } from "./ast";
import type { AggregateOp, Expr, Ref } from "./ast";

export interface ExtractedRef {
  ref: Ref;
  /** 코드 기반 경로 문자열 (`refPath(ref)`) */
  path: string;
  /** 집계 인자로 쓰였으면 그 집계. 직접 참조면 없음. */
  aggregate?: AggregateOp;
}

/** 식이 읽는 참조를 등장 순서대로, (경로, 쓰임) 이 같은 것은 한 번만. */
export function extractRefs(expr: Expr): ExtractedRef[] {
  const out: ExtractedRef[] = [];
  const seen = new Set<string>();
  const push = (ref: Ref, aggregate?: AggregateOp) => {
    const path = refPath(ref);
    const key = `${aggregate ?? ""}:${path}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(aggregate === undefined ? { ref, path } : { ref, path, aggregate });
  };
  const walk = (e: Expr): void => {
    switch (e.kind) {
      case "literal":
        return;
      case "ref":
        push(e.ref);
        return;
      case "aggregate":
        push(e.ref, e.op);
        return;
      case "not":
        walk(e.operand);
        return;
      case "compare":
      case "and":
      case "or":
        walk(e.left);
        walk(e.right);
        return;
    }
  };
  walk(expr);
  return out;
}

/** 요구 구분자 집합 — 구분자 코드만, 중복 없이, 등장 순서대로. 담보속성·내장 경로는 제외. */
export function requiredDiscriminatorCodes(expr: Expr): Code[] {
  const codes: Code[] = [];
  for (const { ref } of extractRefs(expr)) {
    if (ref.kind === "discriminator" && !codes.includes(ref.code)) codes.push(ref.code);
  }
  return codes;
}

/**
 * 별칭형 파생 판정 — 식이 참조 하나뿐이면 true. (`(a)` 도 파서가 괄호를 벗기므로 같다.)
 * 파생 구분자 정의 저장 시 true 면 거부한다. 리터럴만인 식은 별칭이 아니다 (다른 검사 몫).
 */
export function isAliasExpression(expr: Expr): boolean {
  return expr.kind === "ref";
}
