/**
 * 항 단위 자동 판정 (ADR-0020). 조연결된 담보 조와 보통약관 조를 순서 무관 항 집합으로 비교해
 * 생략 / 준용 / 통째로 가른다. 조 명과 노드 id는 비교하지 않는다.
 *
 * 비교 직렬화: 구조(항·호·목) + 텍스트 + 참조 대상(조 id · 별표 코드). 노드 id 는 비교하지 않는다 —
 * 같은 공용조항을 두 문서가 참조하면 id 접두(`${참조노드id}/…`)만 다르고 내용은 같기 때문.
 * 오류 마커가 있는 조는 절대 같다고 보지 않는다 (마커 id 로 직렬화 → 문서마다 다르다).
 * 띄어쓰기 하나도 다르면 다르다 — 정규화·유사도 없음.
 */

import type { Id } from "../types";
import type { ErrorNode, OmissionRecord, RArticle, RItem, RParagraph, RStatic, RSubitem, SInline, SubstitutedDoc } from "./types";
import { articlesOf, mapArticles } from "./walk";

// ───────────────────────────── 직렬화 ─────────────────────────────

function inline(n: SInline): string {
  switch (n.kind) {
    case "text":
      return `t(${n.text})`;
    case "articleRef":
      return `a(${n.scope}:${n.targets.map((target) => target.nodeId).join(",")}:${n.connector})`;
    case "appendixRef":
      return `x(${n.appendixCode})`;
    case "error":
      return `e(${n.id})`;
  }
}

const inlines = (list: readonly SInline[]) => list.map(inline).join("");
const err = (n: ErrorNode) => `e(${n.id})`;
const subitem = (n: RSubitem<SInline> | ErrorNode) => (n.kind === "error" ? err(n) : `목[${inlines(n.children)}]`);
/**
 * 정적 표·박스 — 항과 같은 한 단위로 비교한다 (ADR-0029).
 * 표는 **열 수·너비까지** 포함한다 — 같은 글자라도 서식이 다르면 다른 조다 (2026-09-08 리뷰 6).
 */
const stat = (n: RStatic<SInline>) =>
  n.kind === "table"
    ? `표[${n.title ?? ""}|${n.columns.map((c) => c.width ?? "-").join("·")}|${n.rows.map((r) => `${r.header ? "h" : ""}${r.cells.map(inlines).join("¦")}`).join("‖")}]`
    : `박스[${n.title}|${n.lines.join("‖")}]`;
const item = (n: RItem<SInline> | RStatic<SInline> | ErrorNode) => (n.kind === "error" ? err(n) : n.kind !== "item" ? stat(n) : `호[${inlines(n.children)}${(n.subitems ?? []).map(subitem).join("")}]`);
const paragraph = (n: RParagraph<SInline> | RStatic<SInline> | ErrorNode) => (n.kind === "error" ? err(n) : n.kind !== "paragraph" ? stat(n) : `항[${inlines(n.children)}${(n.items ?? []).map(item).join("")}]`);

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
  records: OmissionRecord[];
}

function paragraphBodies(a: RArticle<SInline>, excludeMarked: boolean): string[] {
  const children = a.children.filter((p) => p.kind !== "paragraph" || !excludeMarked || !p.excludeFromComparison);
  if (children.length === 0) return ["항[]"];
  return children.map(paragraph);
}

function containsErrors(a: RArticle<SInline>): boolean {
  return paragraphBodies(a, false).some((body) => body.includes("e("));
}

function takeMatches(general: readonly string[], special: readonly string[]): { all: boolean; unmatchedSpecial: number[] } {
  const used = new Set<number>();
  for (const body of general) {
    const found = special.findIndex((candidate, index) => !used.has(index) && candidate === body);
    if (found < 0) return { all: false, unmatchedSpecial: special.map((_x, index) => index) };
    used.add(found);
  }
  return { all: true, unmatchedSpecial: special.map((_x, index) => index).filter((index) => !used.has(index)) };
}

function topicParticle(title: string): "은" | "는" {
  const code = title.charCodeAt(title.length - 1);
  return code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 !== 0 ? "은" : "는";
}

function applicationParagraph(article: RArticle<SInline>, linkedArticleId: Id, owner: OmissionOwner): RParagraph<SInline> {
  const id = `${article.id}::application`;
  const at = { document: "special" as const, ownerId: owner.productCoverageId, ownerName: owner.productCoverageName, articleId: article.id, articleTitle: article.title, nodePath: [id] };
  return {
    kind: "paragraph",
    id,
    children: [
      { kind: "text", id: `${id}::prefix`, text: `이 특별약관의 ${article.title}${topicParticle(article.title)} ` },
      { kind: "articleRef", id: `${id}::ref`, targets: [{ nodeId: linkedArticleId }], connector: "및", scope: "general", at },
      { kind: "text", id: `${id}::suffix`, text: "를 준용합니다." },
    ],
  };
}

export function judgeOmission(special: SubstitutedDoc, general: SubstitutedDoc | undefined, owner: OmissionOwner): OmissionOutcome {
  const generalArticles = new Map<Id, RArticle<SInline>>();
  if (general) for (const a of articlesOf(general)) generalArticles.set(a.id, a);

  const records: OmissionRecord[] = [];
  const doc = mapArticles(special, (a): RArticle<SInline> | null => {
    if (a.linkedArticleId === undefined) return a;
    const target = generalArticles.get(a.linkedArticleId);
    let disposition: OmissionRecord["disposition"] = "full";
    let output: RArticle<SInline> | null = a;
    if (target && !containsErrors(a) && !containsErrors(target)) {
      const specialBodies = paragraphBodies(a, false);
      const generalBodies = paragraphBodies(target, true);
      const matched = takeMatches(generalBodies, specialBodies);
      if (matched.all && matched.unmatchedSpecial.length === 0) {
        disposition = "omitted";
        output = null;
      } else if (matched.all) {
        disposition = "applied";
        output = { ...a, children: [applicationParagraph(a, a.linkedArticleId, owner), ...matched.unmatchedSpecial.map((index) => a.children[index])] };
      }
    }
    records.push({ ...owner, articleId: a.id, articleTitle: a.title, linkedArticleId: a.linkedArticleId, disposition });
    return output;
  });
  return { doc, records };
}
