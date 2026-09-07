/**
 * 노드 삭제가 무엇을 데려가는지 세는 순수 계산 (디자인원칙 §9.5 · 리뷰 #33).
 * 「정말 삭제하시겠습니까?」 대신 「제4조(…) 삭제 → 항 2 · 호 5 · 공용조항 참조 1 이 함께 사라진다」를 만든다.
 * **계산된 것만 쓴다** — 겁주려고 범위를 부풀리지 않는다.
 */
import type { DocumentNode, Node } from "@/domain/document";
import type { Id } from "@/domain/types";

const KIND_LABEL: Record<string, string> = {
  section: "관",
  article: "조",
  table: "표",
  box: "박스",
  paragraph: "항",
  item: "호",
  subitem: "목",
  text: "문장",
  slot: "치환 슬롯",
  inlineCond: "문장 안 조건",
  condBlock: "조건 블록",
  clauseBlockRef: "공용조항 참조",
  clauseInlineRef: "공용조항 참조(문장 안)",
  articleRef: "조 참조",
  appendixRef: "별표 참조",
  forBlock: "반복 블록",
  inlineFor: "문장 안 반복",
};

/** 노드와 그 아래 전부 (자기 자신 포함) 를 훑는다. 조건 가지 안도 센다. */
export function walkSubtree(node: Node, visit: (n: Node) => void): void {
  visit(node);
  const children: Node[] = [];
  if ("children" in node && Array.isArray(node.children)) children.push(...(node.children as Node[]));
  if ("items" in node && Array.isArray(node.items)) children.push(...(node.items as Node[]));
  if ("subitems" in node && Array.isArray(node.subitems)) children.push(...(node.subitems as Node[]));
  if ("branches" in node) for (const br of node.branches) children.push(...(br.children as Node[]));
  if (node.kind === "table") for (const row of node.rows) for (const cell of row.cells) children.push(...cell);
  for (const c of children) walkSubtree(c, visit);
}

/** 삭제 대상의 모든 id (참조 검사용). */
export function subtreeIds(node: Node): Set<Id> {
  const ids = new Set<Id>();
  walkSubtree(node, (n) => {
    ids.add(n.id);
    if ("branches" in n) for (const br of n.branches) ids.add(br.id);
  });
  return ids;
}

/** 함께 사라지는 것 — 「항 2」 「호 5」 「공용조항 참조 1」. 자기 자신은 빼고 센다. */
export function cascadeOf(node: Node): string[] {
  const counts = new Map<string, number>();
  let first = true;
  walkSubtree(node, (n) => {
    if (first) {
      first = false;
      return;
    }
    counts.set(n.kind, (counts.get(n.kind) ?? 0) + 1);
  });
  return [...counts].map(([kind, n]) => `${KIND_LABEL[kind] ?? kind} ${n}`);
}

/** 이 문서 안에서 삭제 대상(과 그 아래)을 가리키는 조 참조 슬롯 · 조연결. */
export function internalReferrers(tree: DocumentNode, targets: ReadonlySet<Id>): { articleId?: Id; what: string }[] {
  const out: { articleId?: Id; what: string }[] = [];
  const visit = (node: Node, articleId?: Id): void => {
    const here = node.kind === "article" ? node.id : articleId;
    if (targets.has(node.id)) return; // 지워질 것 안의 참조는 같이 지워진다
    if (node.kind === "articleRef" && node.scope === "self" && node.targets.some((t) => targets.has(t.nodeId))) {
      out.push({ ...(here !== undefined ? { articleId: here } : {}), what: "조 참조 슬롯" });
    }
    if (node.kind === "article" && node.linkedArticleId !== undefined && targets.has(node.linkedArticleId)) {
      out.push({ articleId: node.id, what: "조연결" });
    }
    const children: Node[] = [];
    if ("children" in node && Array.isArray(node.children)) children.push(...(node.children as Node[]));
    if ("items" in node && Array.isArray(node.items)) children.push(...(node.items as Node[]));
    if ("subitems" in node && Array.isArray(node.subitems)) children.push(...(node.subitems as Node[]));
    if ("branches" in node) for (const br of node.branches) children.push(...(br.children as Node[]));
    for (const c of children) visit(c, here);
  };
  visit(tree);
  return out;
}
