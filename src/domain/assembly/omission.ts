/**
 * 5단계 — 생략 판정 (ADR-0014). 담보약관의 조에 조연결(`linkedArticleId`)이 있으면, 해소·치환이 끝난 렌더 결과를
 * (조 명 제외) 대응 보통약관 조와 **리터럴 비교**해 완전히 같으면 그 조를 문서에서 뺀다. 판정은 탑재분별.
 *
 * 비교 직렬화: 구조(항·호·목) + 텍스트 + 참조 대상(조 id · 별표 코드). 노드 id 는 비교하지 않는다 —
 * 같은 공용조항을 두 문서가 참조하면 id 접두(`${참조노드id}/…`)만 다르고 내용은 같기 때문.
 * 오류 마커가 있는 조는 절대 같다고 보지 않는다 (마커 id 로 직렬화 → 문서마다 다르다).
 * 띄어쓰기 하나도 다르면 다르다 — 정규화·유사도 없음.
 */

import type { Id } from "../types";
import type { ErrorNode, OmissionRecord, RArticle, RItem, RParagraph, RSubitem, SInline, SubstitutedDoc } from "./types";

// ───────────────────────────── 직렬화 ─────────────────────────────

function inline(n: SInline): string {
  switch (n.kind) {
    case "text":
      return `t(${n.text})`;
    case "articleRef":
      return `a(${n.articleId})`;
    case "appendixRef":
      return `x(${n.appendixCode})`;
    case "error":
      return `e(${n.id})`;
  }
}

const inlines = (list: readonly SInline[]) => list.map(inline).join("");
const err = (n: ErrorNode) => `e(${n.id})`;
const subitem = (n: RSubitem<SInline> | ErrorNode) => (n.kind === "error" ? err(n) : `목[${inlines(n.children)}]`);
const item = (n: RItem<SInline> | ErrorNode) => (n.kind === "error" ? err(n) : `호[${inlines(n.children)}${(n.subitems ?? []).map(subitem).join("")}]`);
const paragraph = (n: RParagraph<SInline> | ErrorNode) => (n.kind === "error" ? err(n) : `항[${inlines(n.children)}${(n.items ?? []).map(item).join("")}]`);

/** 조의 본문 직렬화 — 조 명 제외. */
export function articleBody(a: RArticle<SInline>): string {
  return a.children.map(paragraph).join("");
}

// ───────────────────────────── 판정 ─────────────────────────────

export interface OmissionOwner {
  productCoverageId: Id;
  productCoverageName: string;
}

export interface OmissionOutcome {
  doc: SubstitutedDoc;
  omitted: OmissionRecord[];
}

export function judgeOmission(special: SubstitutedDoc, general: SubstitutedDoc | undefined, owner: OmissionOwner): OmissionOutcome {
  const generalBodies = new Map<Id, string>();
  for (const a of general?.children ?? []) if (a.kind === "article") generalBodies.set(a.id, articleBody(a));

  const omitted: OmissionRecord[] = [];
  const children = special.children.filter((a) => {
    if (a.kind !== "article" || a.linkedArticleId === undefined) return true;
    const target = generalBodies.get(a.linkedArticleId);
    if (target === undefined || target !== articleBody(a)) return true;
    omitted.push({ ...owner, articleId: a.id, articleTitle: a.title, linkedArticleId: a.linkedArticleId });
    return false;
  });
  return { doc: { ...special, children }, omitted };
}
