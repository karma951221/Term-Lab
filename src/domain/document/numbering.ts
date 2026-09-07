/**
 * 번호 계산 — 번호는 저장하지 않는 계산값이다 (ADR-0012 · 문면_기획).
 *
 * `numberTree` 는 조건 해소 없이 **현재 트리** 순서대로 조·항·호·목 번호를 매긴다 (편집기 표시용 · 전체 뷰).
 * 사전평가 결과(`branchStates`)를 주면 `notTaken` 가지를 빼고 센다 — 톤다운된 조가 빠져 이후 번호가 당겨져 보인다
 * (사전평가 S1). 미결·오류 가지는 뺄 수 없으므로 그대로 센다. 조립은 조건 해소 뒤 C2 가 다시 계산한다.
 *
 * ⚠ 표기 규칙은 **임시**다 — 조·별표 참조 슬롯의 렌더 표기(「제3조(보험금의 지급사유)」·「【별표13(화상 분류표)】」)는
 *   실물 조사 후 확정한다 (문면_기획 「열어 둔 문제」). 항은 하나뿐이어도 ①을 붙인다 (표시 생략은 화면·조립 몫).
 *   공용조항 block 참조는 항 1개로 센다 — 실제 항 수는 인라인화 뒤 조립이 안다.
 */

import type { Id } from "../types";
import type { ArticleNode, BlockNode, DocumentNode, Node } from "./nodes";

export type NumberKind = "article" | "paragraph" | "item" | "subitem";

export interface NodeNumber {
  kind: NumberKind;
  /** 1부터. */
  n: number;
  label: string;
}

export type BranchState = "taken" | "notTaken" | "undetermined" | "error";

export interface NumberingOptions {
  /** 가지 id → 사전평가 상태. `notTaken` 가지는 번호 계산에서 뺀다. */
  branchStates?: ReadonlyMap<Id, BranchState>;
}

// ───────────────────────────── 표기 (임시 규칙) ─────────────────────────────

const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";
const HANGUL = ["가", "나", "다", "라", "마", "바", "사", "아", "자", "차", "카", "타", "파", "하"];

export function articleLabel(n: number): string {
  return `제${n}조`;
}

/** 원문자 ①…⑳, 그 너머는 (N). */
export function paragraphLabel(n: number): string {
  return n >= 1 && n <= 20 ? CIRCLED[n - 1] : `(${n})`;
}

export function itemLabel(n: number): string {
  return `${n}.`;
}

/** 가.나.다.…하. (14), 그 너머는 (N). */
export function subitemLabel(n: number): string {
  return n >= 1 && n <= HANGUL.length ? `${HANGUL[n - 1]}.` : `(${n})`;
}

/** 조 참조 슬롯 표기 — 「제N조(조 명)」. */
export function articleRefLabel(n: number, title: string): string {
  return `${articleLabel(n)}(${title})`;
}

export interface ReferencePart {
  id: Id;
  n: number;
}

/** 참조 대상의 계산 번호와 상위 구조. `kind` 아래 단계까지만 값이 있다. */
export interface ReferenceTarget {
  kind: NumberKind;
  article: ReferencePart & { title: string };
  paragraph?: ReferencePart;
  item?: ReferencePart;
  subitem?: ReferencePart;
}

/** 첫 대상은 전체 경로, 다음 대상은 직전 대상과 같은 상위 경로를 생략한 실물 표기를 만든다. */
export function referenceTargetLabel(target: ReferenceTarget, previous?: ReferenceTarget): string {
  const parts: string[] = [];
  const sameArticle = previous?.article.id === target.article.id;
  const sameParagraph = sameArticle && previous?.paragraph?.id === target.paragraph?.id;
  const sameItem = sameParagraph && previous?.item?.id === target.item?.id;
  if (target.kind === "article" || !sameArticle) parts.push(articleRefLabel(target.article.n, target.article.title));
  if (target.paragraph && (target.kind === "paragraph" || !sameParagraph)) parts.push(`제${target.paragraph.n}항`);
  if (target.item && (target.kind === "item" || !sameItem)) parts.push(`제${target.item.n}호`);
  if (target.subitem) parts.push(`제${target.subitem.n}목`);
  return parts.join(" ");
}

/** 편집기용: 현재 계산 번호를 붙여 문서 안의 조·항·호·목을 참조 대상 id로 색인한다. */
export function referenceTargetIndex(doc: DocumentNode, numbers: ReadonlyMap<Id, NodeNumber>): Map<Id, ReferenceTarget> {
  const out = new Map<Id, ReferenceTarget>();
  const visit = (node: Node, parent?: ReferenceTarget): void => {
    if (node.kind === "condBlock") {
      for (const branch of node.branches) for (const child of branch.children) visit(child, parent);
      return;
    }
    const number = numbers.get(node.id);
    if (node.kind === "article" && number) {
      const target: ReferenceTarget = { kind: "article", article: { id: node.id, n: number.n, title: node.title } };
      out.set(node.id, target);
      for (const child of node.children) visit(child, target);
      return;
    }
    if (node.kind === "paragraph" && number && parent) {
      const target: ReferenceTarget = { kind: "paragraph", article: parent.article, paragraph: { id: node.id, n: number.n } };
      out.set(node.id, target);
      for (const item of node.items ?? []) visit(item, target);
      return;
    }
    if (node.kind === "item" && number && parent?.paragraph) {
      const target: ReferenceTarget = { kind: "item", article: parent.article, paragraph: parent.paragraph, item: { id: node.id, n: number.n } };
      out.set(node.id, target);
      for (const subitem of node.subitems ?? []) visit(subitem, target);
      return;
    }
    if (node.kind === "subitem" && number && parent?.paragraph && parent.item) {
      out.set(node.id, { kind: "subitem", article: parent.article, paragraph: parent.paragraph, item: parent.item, subitem: { id: node.id, n: number.n } });
    }
  };
  for (const node of doc.children) visit(node);
  return out;
}

/** 별표 참조 슬롯 표기 — 「【별표N(이름)】」. 번호는 책자별 등장 순 (조립). */
export function appendixRefLabel(n: number, name: string): string {
  return `【별표${n}(${name})】`;
}

const LABELS: Record<NumberKind, (n: number) => string> = {
  article: articleLabel,
  paragraph: paragraphLabel,
  item: itemLabel,
  subitem: subitemLabel,
};

// ───────────────────────────── 계산 ─────────────────────────────

class Counter {
  private n = 0;
  constructor(
    private readonly kind: NumberKind,
    private readonly out: Map<Id, NodeNumber>,
  ) {}
  next(id: Id): void {
    this.n += 1;
    this.out.set(id, { kind: this.kind, n: this.n, label: LABELS[this.kind](this.n) });
  }
}

/** 노드 id → 번호. 번호가 붙는 종류(조·항·호·목·공용조항 block 참조)만 들어 있다. */
export function numberTree(doc: DocumentNode, opts: NumberingOptions = {}): Map<Id, NodeNumber> {
  const out = new Map<Id, NodeNumber>();
  const skip = (branchId: Id) => opts.branchStates?.get(branchId) === "notTaken";

  /** 같은 자리의 형제 목록을 조건 블록·반복 블록을 투명하게 펼쳐 순회한다. */
  const each = (list: readonly Node[], fn: (node: Node) => void): void => {
    for (const node of list) {
      if (node.kind === "condBlock") {
        for (const br of node.branches) if (!skip(br.id)) each(br.children, fn);
      } else if (node.kind === "forBlock" || node.kind === "section") {
        each(node.children, fn);
      } else {
        fn(node);
      }
    }
  };

  const article = (a: ArticleNode): void => {
    const paragraphs = new Counter("paragraph", out);
    each(a.children, (n) => {
      if (n.kind === "paragraph") {
        paragraphs.next(n.id);
        const items = new Counter("item", out);
        each(n.items ?? [], (it) => {
          if (it.kind !== "item") return;
          items.next(it.id);
          const subitems = new Counter("subitem", out);
          each(it.subitems ?? [], (s) => {
            if (s.kind === "subitem") subitems.next(s.id);
          });
        });
      } else if (n.kind === "clauseBlockRef") {
        paragraphs.next(n.id); // 임시 — 항 1개로 센다
      }
    });
  };

  const articles = new Counter("article", out);
  each(doc.children as BlockNode[], (n) => {
    if (n.kind === "article") {
      articles.next(n.id);
      article(n);
    }
  });
  return out;
}
