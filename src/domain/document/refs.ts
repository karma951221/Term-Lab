/**
 * 참조 추출 — 문서가 읽는 참조 전부를 좌표와 함께 (문면_기획 「참조 무결성 — 참조는 그래프다」).
 *
 * C1(refs) 역인덱스의 재료다: 구분자(식 안 · 슬롯) · 담보속성 · 내장 경로 · 공용조항 · 조(자기·보통약관) · 별표 · 조연결.
 * 문법이 깨진 식은 참조를 내지 않는다 (문법 오류는 `validateExpressions` 가 보고한다).
 * 참조 대상의 존재 검증은 `validateTree` (nodes.ts) 몫이다.
 */

import { extractRefs, parse } from "../expression";
import type { Code, Coordinate, Id } from "../types";
import { coordinateOf, indexTree, type ClauseGate, type DocumentNode } from "./nodes";

export type DocRef =
  | { kind: "discriminator"; code: Code; field?: Code; path: string; via: "when" | "slot"; at: Coordinate }
  | { kind: "attribute"; code: Code; path: string; at: Coordinate }
  | { kind: "builtin"; path: string; at: Coordinate }
  | { kind: "clause"; clauseCode: Code; options: Record<Code, Code>; mode: "block" | "inline"; at: Coordinate }
  | { kind: "article"; articleId: Id; scope: "self" | "general"; at: Coordinate }
  | { kind: "appendix"; appendixCode: Code; at: Coordinate }
  /** 조연결 — `at.articleId` 의 조가 보통약관 조 `linkedArticleId` 를 가리킨다. */
  | { kind: "link"; linkedArticleId: Id; at: Coordinate };

/** 문서 순서(전위)대로. `base` 는 좌표 기본값 (document · ownerId). */
export function collectRefs(doc: DocumentNode, base: Coordinate = {}): DocRef[] {
  const ix = indexTree(doc, base);
  const out: DocRef[] = [];

  const exprRefs = (src: string, via: "when" | "slot", at: Coordinate): void => {
    const parsed = parse(src);
    if (!parsed.ok) return;
    if (via === "slot" && parsed.value.kind !== "ref") return;
    for (const { ref, path } of extractRefs(parsed.value)) {
      const here = { ...at, refPath: path };
      switch (ref.kind) {
        case "discriminator":
          out.push({ kind: "discriminator", code: ref.code, ...(ref.field !== undefined ? { field: ref.field } : {}), path, via, at: here });
          break;
        case "attr":
          out.push({ kind: "attribute", code: ref.code, path, at: here });
          break;
        case "builtin":
          out.push({ kind: "builtin", path, at: here });
          break;
      }
    }
  };

  for (const e of ix.nodes.values()) {
    const n = e.node;
    const at = coordinateOf(ix, e, base);
    switch (n.kind) {
      case "article":
        if (n.linkedArticleId !== undefined) out.push({ kind: "link", linkedArticleId: n.linkedArticleId, at });
        break;
      case "condBlock":
      case "inlineCond":
        for (const br of n.branches) {
          const be = ix.branches.get(br.id);
          if (br.when !== undefined && be) exprRefs(br.when, "when", coordinateOf(ix, be, base));
        }
        break;
      case "slot":
        exprRefs(n.ref, "slot", at);
        break;
      case "clauseBlockRef":
        out.push({ kind: "clause", clauseCode: n.clauseCode, options: n.options, mode: "block", at });
        break;
      case "clauseInlineRef":
        out.push({ kind: "clause", clauseCode: n.clauseCode, options: n.options, mode: "inline", at });
        break;
      case "articleRef":
        out.push({ kind: "article", articleId: n.articleId, scope: n.scope, at });
        break;
      case "appendixRef":
        out.push({ kind: "appendix", appendixCode: n.appendixCode, at });
        break;
      default:
        break;
    }
  }
  return out;
}

/**
 * 요구 구분자 (ADR-0010) — 문서 자체가 읽는 구분자 + 참조한 공용조항의 요구 구분자(게이트). 등장 순 · 중복 없이.
 * B1 이 담보 부착 검사에 쓴다.
 */
export function requiredDiscriminators(doc: DocumentNode, gate?: ClauseGate): Code[] {
  const codes: Code[] = [];
  const add = (c: Code) => {
    if (!codes.includes(c)) codes.push(c);
  };
  for (const r of collectRefs(doc)) {
    if (r.kind === "discriminator") add(r.code);
    else if (r.kind === "clause" && gate) gate.requiredCodes(r.clauseCode).forEach(add);
  }
  return codes;
}
