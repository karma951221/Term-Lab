/**
 * 식 자리 검증 — 저장 시점 (ADR-0013 「조건식 자리는 boolean」은 언어 밖 규칙).
 *
 * - 조건 가지 `when` : `parse` 문법 검사 → `checkCondition` (결과 boolean · 참조 존재).
 * - 슬롯 `ref`      : 값 참조 경로 하나여야 한다 (식 · 담보속성 불가) → `checkTypes` 로 존재 검사.
 * - 반복의 `source` 는 자리만 확보 (P7) — 검사하지 않는다.
 * 타입 조회(`TypeResolver`)는 카탈로그 정의로 서비스가 만든다.
 */

import { checkCondition, checkTypes, parse } from "../expression";
import type { TypeResolver } from "../expression";
import type { Coordinate, Issue } from "../types";
import { coordinateOf, indexTree, type DocumentNode } from "./nodes";

export function validateExpressions(doc: DocumentNode, resolve: TypeResolver, base: Coordinate = {}): Issue[] {
  const ix = indexTree(doc, base);
  const issues: Issue[] = [];

  const condition = (src: string, at: Coordinate) => {
    const parsed = parse(src, at);
    if (!parsed.ok) {
      if (parsed.rejection.reason === "invalid") issues.push(...parsed.rejection.issues);
      return;
    }
    const checked = checkCondition(parsed.value, resolve, at);
    if (!checked.ok && checked.rejection.reason === "invalid") issues.push(...checked.rejection.issues);
  };

  const slot = (src: string, at: Coordinate) => {
    if (src.trim().startsWith("attr.")) {
      issues.push({ kind: "typeMismatch", message: "슬롯은 담보속성을 찍을 수 없습니다 (값 참조 경로만)", at: { ...at, refPath: src } });
      return;
    }
    const parsed = parse(src, at);
    if (!parsed.ok) {
      if (parsed.rejection.reason === "invalid") issues.push(...parsed.rejection.issues);
      return;
    }
    if (parsed.value.kind !== "ref" || parsed.value.ref.kind === "attr") {
      issues.push({ kind: "typeMismatch", message: "슬롯은 값 참조 경로 하나여야 합니다 (식 불가)", at: { ...at, refPath: src } });
      return;
    }
    const checked = checkTypes(parsed.value, resolve, { coordinate: at });
    if (!checked.ok && checked.rejection.reason === "invalid") issues.push(...checked.rejection.issues);
  };

  for (const e of ix.nodes.values()) {
    const n = e.node;
    if (n.kind === "condBlock" || n.kind === "inlineCond") {
      for (const br of n.branches) {
        const be = ix.branches.get(br.id);
        if (br.when !== undefined && be) condition(br.when, coordinateOf(ix, be, base));
      }
    } else if (n.kind === "slot") {
      slot(n.ref, coordinateOf(ix, e, base));
    }
  }
  return issues;
}
