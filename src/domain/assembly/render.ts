/**
 * 6·7·8단계 — 번호 계산 · 별표 수집 · 참조 슬롯 해소.
 *
 * - `numberDocument`  : 남은 노드에 조·항·호·목 번호 (표기는 document/numbering 의 임시 규칙 재사용). 오류 마커는 번호를 먹지 않는다.
 * - `collectAppendices`: 상품 별표 목록의 순서가 곧 번호 (ADR-0030). 목록에 없는 별표 참조는 brokenRef 마커.
 * - `renderDocument`  : articleRef → 「제N조(조 명)」 — 같은 문서에서 먼저 찾고, 없으면 보통약관에서. 어디에도 없으면
 *   `articleGone`(분기·생략으로 사라짐) 마커. appendixRef → 「【별표N(이름)】」.
 */

import type { Appendix } from "../document/appendix";
import { appendixRefLabel, articleLabel, itemLabel, paragraphLabel, referenceTargetLabel, sectionLabel, subitemLabel, type ReferenceTarget } from "../document/numbering";
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
  RenderedSection,
  RenderedSubitem,
  RArticle,
  RItem,
  RParagraph,
  RSubitem,
  SInline,
  SubstitutedDoc,
} from "./types";
import { articlesOf } from "./walk";

// ───────────────────────────── 6. 번호 ─────────────────────────────

export function numberDocument(doc: SubstitutedDoc): NumberedDoc {
  const numbers = new Map<Id, NumberedNode>();
  let article = 0;
  let section = 0;
  const one = (a: RArticle<SInline>): void => {
    numbers.set(a.id, { n: ++article, label: articleLabel(article) });
    let paragraph = 0;
    let lastParagraph: Id | undefined;
    for (const p of a.children) {
      if (p.kind !== "paragraph") continue;
      numbers.set(p.id, { n: ++paragraph, label: paragraphLabel(paragraph) });
      lastParagraph = p.id;
      let item = 0;
      for (const it of p.items ?? []) {
        if (it.kind !== "item") continue;
        numbers.set(it.id, { n: ++item, label: itemLabel(item) });
        let subitem = 0;
        for (const s of it.subitems ?? []) {
          if (s.kind === "error") continue;
          numbers.set(s.id, { n: ++subitem, label: subitemLabel(subitem) });
        }
      }
    }
    // 항이 하나뿐인 조는 마커를 찍지 않는다 (ADR-0029 — 실물의 단항 조는 전부 번호 없음)
    if (paragraph === 1 && lastParagraph !== undefined) numbers.set(lastParagraph, { n: 1, label: "" });
  };
  for (const c of doc.children) {
    if (c.kind === "error") continue;
    if (c.kind === "section") {
      numbers.set(c.id, { n: ++section, label: sectionLabel(section) });
      for (const a of c.children) if (a.kind === "article") one(a);
    } else one(c);
  }
  return { doc, numbers };
}

// ───────────────────────────── 8. 별표 번호 (ADR-0030) ─────────────────────────────

/**
 * 상품 별표 목록 순서대로 번호 1..n. 참조되지 않은 별표도 번호를 차지한다.
 * 마스터에 없는 코드는 「(없는 별표)」로 번호만 남긴다 — 렌더가 참조 자리에서 오류를 낸다.
 */
export function collectAppendices(order: readonly Code[], master: readonly Appendix[]): BookletAppendix[] {
  const byCode = new Map(master.map((a) => [a.code, a]));
  return order.map((code, index) => ({ code, name: byCode.get(code)?.name ?? "(없는 별표)", number: index + 1 }));
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
  for (const a of d ? articlesOf(d.doc) : []) {
    const articleNumber = d!.numbers.get(a.id);
    if (!articleNumber) continue;
    const article = { id: a.id, n: articleNumber.n, title: a.title };
    out.set(a.id, { kind: "article", article });
    for (const p of a.children) {
      if (p.kind !== "paragraph") continue;
      const paragraphNumber = d!.numbers.get(p.id);
      if (!paragraphNumber) continue;
      const paragraph = { id: p.id, n: paragraphNumber.n };
      out.set(p.id, { kind: "paragraph", article, paragraph });
      for (const it of p.items ?? []) {
        if (it.kind !== "item") continue;
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
            // 별칭 — 생략된 특약 조(→ 보통약관 조) 또는 대치된 기본계약 조(→ 이 문서의 보통약관 조).
            const alias = this.env.aliases?.get(target.nodeId);
            if (alias) {
              const own = this.self.get(alias);
              if (own) {
                info = own;
              } else {
                info = this.general.get(alias);
                if (info) {
                  generalPrefix = true;
                  previous = undefined;
                }
              }
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
        if (!a || a.name === "(없는 별표)") {
          const message = a ? `별표 ${n.appendixCode} 이(가) 별표 마스터에 없습니다` : `별표 ${n.appendixCode} 이(가) 상품 별표 목록에 없습니다`;
          return this.error(n.id, { kind: "brokenRef", message, at: { ...n.at, refPath: n.appendixCode } });
        }
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
      ...(n.items ? { items: n.items.map((it) => (it.kind === "item" ? this.item(it) : it)) } : {}),
    };
  }

  article(a: RArticle<SInline>): RenderedArticle {
    return {
      kind: "article",
      id: a.id,
      ...this.number(a.id),
      title: a.title,
      ...(a.linkedArticleId !== undefined ? { linkedArticleId: a.linkedArticleId } : {}),
      // 정적 표·박스는 그대로 (ADR-0029)
      children: a.children.map((p) => (p.kind === "paragraph" ? this.paragraph(p) : p)),
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
      children: doc.children.map((c): RenderedArticle | RenderedSection | ErrorNode => {
        if (c.kind === "error") return c;
        if (c.kind === "section") {
          return { kind: "section", id: c.id, ...this.number(c.id), title: c.title, children: c.children.map((a) => (a.kind === "error" ? a : this.article(a))) };
        }
        return this.article(c);
      }),
    };
  }
}

export function renderDocument(numbered: NumberedDoc, env: RenderEnv): RenderOutcome {
  const r = new Renderer(numbered, env);
  const doc = r.render();
  return { doc, issues: locateIssues(r.issues, numbered) };
}
