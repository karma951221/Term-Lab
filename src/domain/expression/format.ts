/**
 * AST → 소스 문자열 재생성.
 *
 * 편집기는 코드 대신 표시명을 보여준다 (구분자_기획 「코드 + 표시명 이중 체계」).
 * `displayName` 훅을 주면 참조 자리에 표시명을 찍고, 안 주면 코드 경로를 찍는다 —
 * 훅 없이 찍은 결과는 다시 파싱하면 같은 AST 가 된다 (`parse(format(parse(s))) ≡ parse(s)`).
 */

import { refPath } from "./ast";
import type { Expr, Literal, Ref } from "./ast";

/** 우선순위 — 클수록 세게 묶인다. 괄호는 「자식이 부모보다 약하게 묶일 때」만 친다. */
const PRECEDENCE: Record<Expr["kind"], number> = {
  or: 1,
  and: 2,
  compare: 3,
  not: 4,
  literal: 5,
  ref: 5,
  aggregate: 5,
};

export type DisplayName = (ref: Ref) => string;

export function formatLiteral(lit: Literal): string {
  switch (lit.type) {
    case "string":
      return `'${lit.value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
    case "number":
      return String(lit.value);
    case "boolean":
      return lit.value ? "true" : "false";
    case "date":
      return `d'${lit.value}'`;
  }
}

export function format(expr: Expr, displayName: DisplayName = refPath): string {
  const name = (ref: Ref) => displayName(ref);

  /** 자식을 찍되, 부모보다 약하게 묶이면 괄호. 같은 세기의 오른쪽 자식도 괄호 (좌결합 보존). */
  const child = (e: Expr, parent: Expr, side: "left" | "right" | "only"): string => {
    const text = go(e);
    const pc = PRECEDENCE[parent.kind];
    const cc = PRECEDENCE[e.kind];
    if (cc < pc) return `(${text})`;
    if (cc === pc && side === "right" && (e.kind === "and" || e.kind === "or")) return `(${text})`;
    // 비교 안의 비교는 문법상 연쇄 불가 — 손으로 만든 AST 라도 괄호로 살린다
    if (e.kind === "compare" && parent.kind === "compare") return `(${text})`;
    return text;
  };

  const go = (e: Expr): string => {
    switch (e.kind) {
      case "literal":
        return formatLiteral(e.literal);
      case "ref":
        return name(e.ref);
      case "aggregate":
        return `${e.op}(${name(e.ref)})`;
      case "not":
        return `not ${child(e.operand, e, "only")}`;
      case "compare":
        return `${child(e.left, e, "left")} ${e.op} ${child(e.right, e, "right")}`;
      case "and":
      case "or":
        return `${child(e.left, e, "left")} ${e.kind} ${child(e.right, e, "right")}`;
    }
  };

  return go(expr);
}
