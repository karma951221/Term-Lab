/**
 * 6·7·8단계 — 번호 계산 · 별표 수집 · 참조 슬롯 해소.
 *
 * - `numberDocument`  : 남은 노드에 조·항·호·목 번호 (표기는 document/numbering 의 임시 규칙 재사용). 오류 마커는 번호를 먹지 않는다.
 * - `collectAppendices`: 책자 순(보통약관 → 그룹 순 → 그룹 안 정렬 순)으로 읽어 **참조된 별표만** 처음 등장 순 번호.
 *   마스터에 없는 코드는 수집하지 않는다 (참조 해소가 brokenRef 마커를 낸다).
 * - `renderDocument`  : articleRef → 「제N조(조 명)」 — 같은 문서에서 먼저 찾고, 없으면 보통약관에서. 어디에도 없으면
 *   `articleGone`(분기·생략으로 사라짐) 마커. appendixRef → 「【별표N(이름)】」.
 */

import type { Appendix } from "../document/appendix";
import { appendixRefLabel, articleLabel, articleRefLabel, itemLabel, paragraphLabel, subitemLabel } from "../document/numbering";
import type { Code, Coordinate, Id, Issue } from "../types";
import type {
  BookletAppendix,
  ErrorNode,
  NumberedDoc,
  NumberedNode,
  RenderedArticle,
  RenderedDoc,
  RenderedInline,
  RenderedItem,
  RenderedParagraph,
  RenderedSubitem,
  RItem,
  RParagraph,
  RSubitem,
  SInline,
  SubstitutedDoc,
} from "./types";

// ───────────────────────────── 6. 번호 ─────────────────────────────

export function numberDocument(doc: SubstitutedDoc): NumberedDoc {
  const numbers = new Map<Id, NumberedNode>();
  let article = 0;
  for (const a of doc.children) {
    if (a.kind === "error") continue;
    numbers.set(a.id, { n: ++article, label: articleLabel(article) });
    let paragraph = 0;
    for (const p of a.children) {
      if (p.kind === "error") continue;
      numbers.set(p.id, { n: ++paragraph, label: paragraphLabel(paragraph) });
      let item = 0;
      for (const it of p.items ?? []) {
        if (it.kind === "error") continue;
        numbers.set(it.id, { n: ++item, label: itemLabel(item) });
        let subitem = 0;
        for (const s of it.subitems ?? []) {
          if (s.kind === "error") continue;
          numbers.set(s.id, { n: ++subitem, label: subitemLabel(subitem) });
        }
      }
    }
  }
  return { doc, numbers };
}

// ───────────────────────────── 8. 별표 수집 ─────────────────────────────

function* inlinesOf(doc: SubstitutedDoc): Generator<SInline> {
  for (const a of doc.children) {
    if (a.kind === "error") continue;
    for (const p of a.children) {
      if (p.kind === "error") continue;
      yield* p.children;
      for (const it of p.items ?? []) {
        if (it.kind === "error") continue;
        yield* it.children;
        for (const s of it.subitems ?? []) if (s.kind !== "error") yield* s.children;
      }
    }
  }
}

/** 책자 순으로 읽어 처음 등장 순 번호. `docs` 는 책자 순서대로. */
export function collectAppendices(docs: readonly SubstitutedDoc[], master: readonly Appendix[]): BookletAppendix[] {
  const byCode = new Map(master.map((a) => [a.code, a]));
  const out: BookletAppendix[] = [];
  const seen = new Set<Code>();
  for (const doc of docs) {
    for (const n of inlinesOf(doc)) {
      if (n.kind !== "appendixRef" || seen.has(n.appendixCode)) continue;
      const def = byCode.get(n.appendixCode);
      if (!def) continue;
      seen.add(n.appendixCode);
      out.push({ code: def.code, name: def.name, number: out.length + 1, firstAt: n.at });
    }
  }
  return out;
}

// ───────────────────────────── 7. 참조 해소 + 렌더 ─────────────────────────────

export interface RenderEnv {
  document: "general" | "special";
  ownerId: Id;
  /** 보통약관 (담보약관의 `scope:'general'` 조 참조 · 같은 문서에 없는 조 id 의 두 번째 탐색 대상). */
  general?: NumberedDoc;
  appendices: readonly BookletAppendix[];
}

export interface RenderOutcome {
  doc: RenderedDoc;
  issues: Issue[];
}

interface ArticleInfo {
  n: number;
  title: string;
}

function articleIndex(d: NumberedDoc | undefined): Map<Id, ArticleInfo> {
  const out = new Map<Id, ArticleInfo>();
  for (const a of d?.doc.children ?? []) {
    if (a.kind === "error") continue;
    const num = d!.numbers.get(a.id);
    if (num) out.set(a.id, { n: num.n, title: a.title });
  }
  return out;
}

class Renderer {
  readonly issues: Issue[] = [];
  private readonly self: Map<Id, ArticleInfo>;
  private readonly general: Map<Id, ArticleInfo>;
  private readonly appendices: Map<Code, BookletAppendix>;

  constructor(
    private readonly numbered: NumberedDoc,
    private readonly env: RenderEnv,
  ) {
    this.self = articleIndex(numbered);
    this.general = articleIndex(env.general);
    this.appendices = new Map(env.appendices.map((a) => [a.code, a]));
  }

  error(id: Id, issue: Issue): ErrorNode {
    this.issues.push(issue);
    return { kind: "error", id, issue };
  }

  number(id: Id): { number: number; label: string } {
    const n: NumberedNode = this.numbered.numbers.get(id) ?? { n: 0, label: "" };
    return { number: n.n, label: n.label };
  }

  inline(n: SInline): RenderedInline {
    switch (n.kind) {
      case "text":
      case "error":
        return n;
      case "articleRef": {
        const info = this.self.get(n.articleId) ?? this.general.get(n.articleId);
        if (!info) {
          const at: Coordinate = { ...n.at, refPath: n.articleId };
          if (n.scope === "general" && !this.env.general) {
            return this.error(n.id, { kind: "brokenRef", message: "보통약관 템플릿이 없어 보통약관 조 참조를 해소할 수 없습니다", at });
          }
          return this.error(n.id, { kind: "articleGone", message: `조 참조 대상 ${n.articleId} 이(가) 분기·생략으로 사라졌거나 없습니다`, at });
        }
        return { kind: "articleRef", id: n.id, articleId: n.articleId, label: articleRefLabel(info.n, info.title) };
      }
      case "appendixRef": {
        const a = this.appendices.get(n.appendixCode);
        if (!a) return this.error(n.id, { kind: "brokenRef", message: `별표 ${n.appendixCode} 이(가) 별표 마스터에 없습니다`, at: { ...n.at, refPath: n.appendixCode } });
        return { kind: "appendixRef", id: n.id, appendixCode: a.code, number: a.number, label: appendixRefLabel(a.number, a.name) };
      }
    }
  }

  subitem(n: RSubitem<SInline>): RenderedSubitem {
    return { kind: "subitem", id: n.id, ...this.number(n.id), children: n.children.map((c) => this.inline(c)) };
  }

  item(n: RItem<SInline>): RenderedItem {
    return {
      kind: "item",
      id: n.id,
      ...this.number(n.id),
      children: n.children.map((c) => this.inline(c)),
      ...(n.subitems ? { subitems: n.subitems.map((s) => (s.kind === "error" ? s : this.subitem(s))) } : {}),
    };
  }

  paragraph(n: RParagraph<SInline>): RenderedParagraph {
    return {
      kind: "paragraph",
      id: n.id,
      ...this.number(n.id),
      children: n.children.map((c) => this.inline(c)),
      ...(n.items ? { items: n.items.map((it) => (it.kind === "error" ? it : this.item(it))) } : {}),
    };
  }

  render(): RenderedDoc {
    const doc = this.numbered.doc;
    return {
      kind: "document",
      id: doc.id,
      document: this.env.document,
      ownerId: this.env.ownerId,
      title: doc.title,
      children: doc.children.map((a): RenderedArticle | ErrorNode => {
        if (a.kind === "error") return a;
        return {
          kind: "article",
          id: a.id,
          ...this.number(a.id),
          title: a.title,
          ...(a.linkedArticleId !== undefined ? { linkedArticleId: a.linkedArticleId } : {}),
          children: a.children.map((p) => (p.kind === "error" ? p : this.paragraph(p))),
        };
      }),
    };
  }
}

export function renderDocument(numbered: NumberedDoc, env: RenderEnv): RenderOutcome {
  const r = new Renderer(numbered, env);
  const doc = r.render();
  return { doc, issues: r.issues };
}
