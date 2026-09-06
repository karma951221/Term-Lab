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
import { appendixRefLabel, articleLabel, itemLabel, paragraphLabel, referenceTargetLabel, subitemLabel, type ReferenceTarget } from "../document/numbering";
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
  /** 생략된 특약 조 id → 연결된 보통약관 조 id. */
  aliases?: ReadonlyMap<Id, Id>;
  appendices: readonly BookletAppendix[];
}

export interface RenderOutcome {
  doc: RenderedDoc;
  issues: Issue[];
}

function targetIndex(d: NumberedDoc | undefined): Map<Id, ReferenceTarget> {
  const out = new Map<Id, ReferenceTarget>();
  for (const a of d?.doc.children ?? []) {
    if (a.kind === "error") continue;
    const articleNumber = d!.numbers.get(a.id);
    if (!articleNumber) continue;
    const article = { id: a.id, n: articleNumber.n, title: a.title };
    out.set(a.id, { kind: "article", article });
    for (const p of a.children) {
      if (p.kind === "error") continue;
      const paragraphNumber = d!.numbers.get(p.id);
      if (!paragraphNumber) continue;
      const paragraph = { id: p.id, n: paragraphNumber.n };
      out.set(p.id, { kind: "paragraph", article, paragraph });
      for (const it of p.items ?? []) {
        if (it.kind === "error") continue;
        const itemNumber = d!.numbers.get(it.id);
        if (!itemNumber) continue;
        const item = { id: it.id, n: itemNumber.n };
        out.set(it.id, { kind: "item", article, paragraph, item });
        for (const sub of it.subitems ?? []) {
          if (sub.kind === "error") continue;
          const subitemNumber = d!.numbers.get(sub.id);
          if (subitemNumber) out.set(sub.id, { kind: "subitem", article, paragraph, item, subitem: { id: sub.id, n: subitemNumber.n } });
        }
      }
    }
  }
  return out;
}

function issueNodeKind(issue: Issue): string | undefined {
  if (issue.at.nodeKind) return issue.at.nodeKind;
  if (issue.kind === "notEntered" || issue.kind === "notAttached") return "slot";
  if (issue.kind === "unusedAttribute" || issue.kind === "syntax" || issue.kind === "typeMismatch") return "condition";
  if (issue.kind === "articleGone") return "articleRef";
  if (issue.kind === "optionInvalid" || issue.kind === "optionUnselected") return "option";
  return undefined;
}

/** 조립 후 계산 번호를 issue 결과·원천 좌표에 보탠다. */
export function locateIssues(issues: readonly Issue[], numbered: NumberedDoc): Issue[] {
  const index = targetIndex(numbered);
  return issues.map((issue) => {
    const structural = [issue.at.articleId ?? "", ...(issue.at.nodePath ?? [])].reverse().map((id) => index.get(id)).find(Boolean);
    const numberedAt: Coordinate = structural
      ? {
          ...issue.at,
          articleNumber: structural.article.n,
          ...(structural.paragraph ? { paragraphNumber: structural.paragraph.n } : {}),
          ...(structural.item ? { itemNumber: structural.item.n } : {}),
          ...(structural.subitem ? { subitemNumber: structural.subitem.n } : {}),
          ...(issueNodeKind(issue) ? { nodeKind: issueNodeKind(issue) } : {}),
        }
      : { ...issue.at, ...(issueNodeKind(issue) ? { nodeKind: issueNodeKind(issue) } : {}) };
    const source = issue.source && issue.source.document !== "product" && structural
      ? {
          ...issue.source,
          ...(structural.paragraph ? { paragraphNumber: structural.paragraph.n } : {}),
          ...(structural.item ? { itemNumber: structural.item.n } : {}),
          ...(structural.subitem ? { subitemNumber: structural.subitem.n } : {}),
        }
      : issue.source;
    return { ...issue, at: numberedAt, ...(source ? { source } : {}) };
  });
}

class Renderer {
  readonly issues: Issue[] = [];
  private readonly self: Map<Id, ReferenceTarget>;
  private readonly general: Map<Id, ReferenceTarget>;
  private readonly appendices: Map<Code, BookletAppendix>;

  constructor(
    private readonly numbered: NumberedDoc,
    private readonly env: RenderEnv,
  ) {
    this.self = targetIndex(numbered);
    this.general = targetIndex(env.general);
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

  inline(n: SInline, source: ReferenceTarget): RenderedInline {
    switch (n.kind) {
      case "text":
      case "error":
        return n;
      case "articleRef": {
        const targets: { nodeId: Id; label: string }[] = [];
        let previous = n.scope === "self" ? source : undefined;
        let generalPrefix = n.scope === "general";
        for (const target of n.targets) {
          let info = n.scope === "self" || this.env.document === "general" ? this.self.get(target.nodeId) : this.general.get(target.nodeId);
          if (!info && n.scope === "self") {
            const alias = this.env.aliases?.get(target.nodeId);
            if (alias) {
              info = this.general.get(alias);
              generalPrefix = true;
              previous = undefined;
            }
          }
          if (!info) {
            const at: Coordinate = { ...n.at, refPath: target.nodeId };
            const issue: Issue = n.scope === "general" && !this.env.general
              ? { kind: "brokenRef", message: "보통약관 템플릿이 없어 보통약관 참조를 해소할 수 없습니다", at }
              : { kind: "articleGone", message: `참조 대상 ${target.nodeId} 이(가) 분기·생략으로 사라졌거나 없습니다`, at };
            this.issues.push(issue);
            continue;
          }
          targets.push({ nodeId: target.nodeId, label: referenceTargetLabel(info, previous) });
          previous = info;
        }
        if (targets.length !== n.targets.length) return { kind: "error", id: n.id, issue: this.issues.at(-1)! };
        const labels = targets.map((target) => target.label);
        const label = labels.length <= 1 ? (labels[0] ?? "") : `${labels.slice(0, -1).join(", ")} ${n.connector} ${labels.at(-1)}`;
        return { kind: "articleRef", id: n.id, targets, connector: n.connector, label: `${generalPrefix ? "보통약관 " : ""}${label}` };
      }
      case "appendixRef": {
        const a = this.appendices.get(n.appendixCode);
        if (!a) return this.error(n.id, { kind: "brokenRef", message: `별표 ${n.appendixCode} 이(가) 별표 마스터에 없습니다`, at: { ...n.at, refPath: n.appendixCode } });
        return { kind: "appendixRef", id: n.id, appendixCode: a.code, number: a.number, label: appendixRefLabel(a.number, a.name) };
      }
    }
  }

  subitem(n: RSubitem<SInline>): RenderedSubitem {
    return { kind: "subitem", id: n.id, ...this.number(n.id), children: n.children.map((c) => this.inline(c, this.self.get(n.id)!)) };
  }

  item(n: RItem<SInline>): RenderedItem {
    return {
      kind: "item",
      id: n.id,
      ...this.number(n.id),
      children: n.children.map((c) => this.inline(c, this.self.get(n.id)!)),
      ...(n.subitems ? { subitems: n.subitems.map((s) => (s.kind === "error" ? s : this.subitem(s))) } : {}),
    };
  }

  paragraph(n: RParagraph<SInline>): RenderedParagraph {
    return {
      kind: "paragraph",
      id: n.id,
      ...this.number(n.id),
      children: n.children.map((c) => this.inline(c, this.self.get(n.id)!)),
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
  return { doc, issues: locateIssues(r.issues, numbered) };
}
