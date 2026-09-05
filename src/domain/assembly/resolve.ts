/**
 * 2·3단계 — 조건 해소 + 공용조항 인라인화 (문서 한 벌을 한 문맥으로 실행).
 *
 * - 조건은 **밟은 자리만** 평가한다 (ADR-0016): 가지를 앞에서부터 보다 true 인 첫 가지(또는 else)를 택하고,
 *   택하지 않은 가지 안쪽은 들여다보지 않는다. 오류·미결이면 조건 노드 전체가 오류 마커가 된다 — 조립 문맥에
 *   미결이 남았다는 것은 값이 없다는 뜻이므로 원인에 맞는 Issue 로 바꾼다 (`explainUndetermined`).
 * - 공용조항 참조는 `resolveOptions`(오버라이드 > 마스터, ADR-0017) + `expandClause` 로 본문을 그 자리에 펼치고,
 *   펼친 본문의 조건·슬롯은 **사용처 문맥**으로 계속 해소한다 (늦은 바인딩, ADR-0010).
 *   옵션 미선택·무효 · 없는 공용조항은 오류 마커.
 * - 반복(forBlock · inlineFor)은 MVP 자리만 — 만나면 `structure` 오류 마커 (구현 P7).
 * - 슬롯·조 참조·별표 참조는 그대로 둔다 (4·7단계).
 *
 * 좌표: 문서 기본 좌표 + 조(id·조 명) + 노드 경로. 펼친 공용조항 안의 노드 id 는 `${참조노드id}/${원노드id}`.
 */

import type {
  Block as ClauseBlock,
  CondBlockNode as ClauseCondBlockNode,
  Inline as ClauseInline,
  ItemNode as ClauseItemNode,
  ParagraphNode as ClauseParagraphNode,
  SubitemNode as ClauseSubitemNode,
} from "../clause/nodes";
import { expandClause, resolveOptions } from "../clause/reference";
import type { Clause, OptionSelection } from "../clause/types";
import type { ArticleNode, ClauseBlockRefNode, CondBlockNode, DocumentNode, ForBlockNode, InlineNode, ItemNode, ParagraphNode, SubitemNode } from "../document/nodes";
import { evaluate, parse } from "../expression";
import type { Code, Coordinate, Id, Issue } from "../types";
import type { AssemblyContext } from "./context";
import type { ErrorNode, RArticle, RInline, RItem, RParagraph, ResolvedDoc, RSubitem } from "./types";

export interface ResolveEnv {
  clauses: ReadonlyMap<Code, Clause>;
  /** 공용조항 참조 노드 id → 옵션 오버라이드 (상품 또는 상품담보 스코프에서 이 문서에 해당하는 것). */
  overrides: ReadonlyMap<Id, OptionSelection>;
  /** 문서 기본 좌표 (document · ownerId · ownerName). */
  coordinate: Coordinate;
}

export interface ResolveOutcome {
  doc: ResolvedDoc;
  /** 문서 등장 순. */
  issues: Issue[];
}

// ───────────────────────────── 내부 ─────────────────────────────

/** 문면 노드와 공용조항 노드(부분집합 — articleRef 에 scope 없음)를 함께 다룬다. */
type AnyInline = InlineNode | ClauseInline;
type AnyCond = CondBlockNode | ClauseCondBlockNode;
type AnySubitem = ClauseSubitemNode | SubitemNode;
type AnyItem = ItemNode | ClauseItemNode;
type AnyParagraph = ParagraphNode | ClauseParagraphNode;
type AnyBlock = AnyParagraph | AnyCond | ClauseBlockRefNode | ForBlockNode | ClauseBlock | ItemNode | SubitemNode | ArticleNode;
/** 가지 — 블록·인라인·공용조항 쪽 모두 이 모양이다. children 은 자리에 맞게 캐스팅한다. */
interface Branch {
  id: Id;
  when?: string;
  children: readonly unknown[];
}

interface Frame {
  path: Id[];
  articleId?: Id;
  articleTitle?: string;
}

class Walker {
  readonly issues: Issue[] = [];
  constructor(
    private readonly ctx: AssemblyContext,
    private readonly env: ResolveEnv,
  ) {}

  at(f: Frame, id: Id): Coordinate {
    return {
      ...this.env.coordinate,
      ...(f.articleId !== undefined ? { articleId: f.articleId, articleTitle: f.articleTitle } : {}),
      nodePath: [...f.path, id],
    };
  }

  error(id: Id, issue: Issue): ErrorNode {
    this.issues.push(issue);
    return { kind: "error", id, issue };
  }

  /** 조건식 하나 — taken / notTaken / 오류. */
  condition(src: string, at: Coordinate): { kind: "taken" | "notTaken" } | { kind: "error"; issue: Issue } {
    const parsed = parse(src, at);
    if (!parsed.ok) {
      const issue: Issue =
        parsed.rejection.reason === "invalid" && parsed.rejection.issues[0] ? parsed.rejection.issues[0] : { kind: "syntax", message: "식을 읽을 수 없습니다", at };
      return { kind: "error", issue };
    }
    const r = evaluate(parsed.value, { ...this.ctx.eval, coordinate: at });
    if (r.kind === "error") return { kind: "error", issue: r.issue };
    if (r.kind === "undetermined") return { kind: "error", issue: this.ctx.explainUndetermined(r.reason, at) };
    if (typeof r.value !== "boolean") {
      return { kind: "error", issue: { kind: "typeMismatch", message: `조건식의 결과가 boolean 이 아닙니다 (${typeof r.value})`, at } };
    }
    return { kind: r.value ? "taken" : "notTaken" };
  }

  /** 가지 선택 — 택한 가지, 없음(모두 false · else 없음), 오류. 밟지 않은 가지는 평가하지 않는다. */
  select(branches: readonly Branch[], f: Frame, condId: Id): { kind: "branch"; branch: Branch } | { kind: "none" } | { kind: "error"; issue: Issue } {
    for (const br of branches) {
      if (br.when === undefined) return { kind: "branch", branch: br };
      const r = this.condition(br.when, this.at({ ...f, path: [...f.path, condId] }, br.id));
      if (r.kind === "error") return r;
      if (r.kind === "taken") return { kind: "branch", branch: br };
    }
    return { kind: "none" };
  }

  /** 공용조항 참조 → 펼친 본문 (옵션 해소 포함). 실패면 오류 마커. */
  expand(node: { id: Id; clauseCode: Code; options: OptionSelection }, mode: "inline" | "block", at: Coordinate): { ok: true; body: (ClauseInline | ClauseBlock)[] } | { ok: false; marker: ErrorNode } {
    const clause = this.env.clauses.get(node.clauseCode);
    if (!clause) return { ok: false, marker: this.error(node.id, { kind: "brokenRef", message: `공용조항 ${node.clauseCode} 이(가) 없습니다`, at }) };
    if (clause.mode !== mode) {
      return { ok: false, marker: this.error(node.id, { kind: "structure", message: `공용조항 ${node.clauseCode} 은(는) ${clause.mode} 모드라 ${mode} 자리에 올 수 없습니다`, at }) };
    }
    const { selection, issues } = resolveOptions(clause, node.options, this.env.overrides.get(node.id), at);
    if (issues.length > 0) {
      this.issues.push(...issues);
      return { ok: false, marker: { kind: "error", id: node.id, issue: issues[0] } };
    }
    const expanded = expandClause(clause, selection, node.id);
    if (!expanded.ok) {
      const issue: Issue = expanded.rejection.reason === "invalid" ? expanded.rejection.issues[0] : { kind: "optionInvalid", message: "공용조항을 펼칠 수 없습니다", at };
      return { ok: false, marker: this.error(node.id, { ...issue, at: { ...at, ...issue.at } }) };
    }
    return { ok: true, body: expanded.value as (ClauseInline | ClauseBlock)[] };
  }

  inlines(list: readonly AnyInline[], f: Frame): RInline[] {
    return list.flatMap((n) => this.inline(n, f));
  }

  inline(n: AnyInline, f: Frame): RInline[] {
    const at = this.at(f, n.id);
    switch (n.kind) {
      case "text":
        return [{ kind: "text", id: n.id, text: n.text }];
      case "slot":
        return [{ kind: "slot", id: n.id, ref: n.ref, at }];
      case "articleRef":
        return [{ kind: "articleRef", id: n.id, articleId: n.articleId, scope: "scope" in n ? n.scope : "general", at }];
      case "appendixRef":
        return [{ kind: "appendixRef", id: n.id, appendixCode: n.appendixCode, at }];
      case "inlineCond": {
        const r = this.select(n.branches, f, n.id);
        if (r.kind === "error") return [this.error(n.id, r.issue)];
        if (r.kind === "none") return [];
        return this.inlines(r.branch.children as AnyInline[], { ...f, path: [...f.path, n.id, r.branch.id] });
      }
      case "inlineFor":
        return [this.error(n.id, { kind: "structure", message: "인라인 반복은 아직 조립하지 않습니다 (P7)", at })];
      case "clauseInlineRef": {
        const r = this.expand(n, "inline", at);
        if (!r.ok) return [r.marker];
        return this.inlines(r.body as ClauseInline[], { ...f, path: [...f.path, n.id] });
      }
      case "optionSlot":
        // expandClause 가 이미 치환했으므로 여기 오면 정의 오류다
        return [this.error(n.id, { kind: "optionInvalid", message: `옵션 자리 ${n.optionCode} 이(가) 치환되지 않았습니다`, at })];
    }
  }

  subitem(n: AnySubitem, f: Frame): RSubitem<RInline> {
    return { kind: "subitem", id: n.id, children: this.inlines(n.children, { ...f, path: [...f.path, n.id] }) };
  }

  subitems(list: readonly (AnySubitem | AnyCond)[], f: Frame): (RSubitem<RInline> | ErrorNode)[] {
    return list.flatMap((n) => {
      if (n.kind === "subitem") return [this.subitem(n, f)];
      const r = this.select(n.branches, f, n.id);
      if (r.kind === "error") return [this.error(n.id, r.issue)];
      if (r.kind === "none") return [];
      return this.subitems(r.branch.children as (AnySubitem | AnyCond)[], { ...f, path: [...f.path, n.id, r.branch.id] });
    });
  }

  item(n: AnyItem, f: Frame): RItem<RInline> {
    const inner = { ...f, path: [...f.path, n.id] };
    return {
      kind: "item",
      id: n.id,
      children: this.inlines(n.children, inner),
      ...(n.subitems ? { subitems: this.subitems(n.subitems, inner) } : {}),
    };
  }

  items(list: readonly (AnyItem | AnyCond)[], f: Frame): (RItem<RInline> | ErrorNode)[] {
    return list.flatMap((n) => {
      if (n.kind === "item") return [this.item(n, f)];
      const r = this.select(n.branches, f, n.id);
      if (r.kind === "error") return [this.error(n.id, r.issue)];
      if (r.kind === "none") return [];
      return this.items(r.branch.children as (AnyItem | AnyCond)[], { ...f, path: [...f.path, n.id, r.branch.id] });
    });
  }

  paragraph(n: AnyParagraph, f: Frame): RParagraph<RInline> {
    const inner = { ...f, path: [...f.path, n.id] };
    return {
      kind: "paragraph",
      id: n.id,
      children: this.inlines(n.children, inner),
      ...(n.items ? { items: this.items(n.items, inner) } : {}),
    };
  }

  /** 조 안의 블록 자리 — 항 · 조건 블록 · 공용조항 block 참조 · 반복 블록. */
  blocks(list: readonly AnyBlock[], f: Frame): (RParagraph<RInline> | ErrorNode)[] {
    return list.flatMap((n): (RParagraph<RInline> | ErrorNode)[] => {
      const at = this.at(f, n.id);
      switch (n.kind) {
        case "paragraph":
          return [this.paragraph(n, f)];
        case "condBlock": {
          const r = this.select(n.branches, f, n.id);
          if (r.kind === "error") return [this.error(n.id, r.issue)];
          if (r.kind === "none") return [];
          return this.blocks(r.branch.children as AnyBlock[], { ...f, path: [...f.path, n.id, r.branch.id] });
        }
        case "clauseBlockRef": {
          const r = this.expand(n, "block", at);
          if (!r.ok) return [r.marker];
          return this.blocks(r.body as ClauseBlock[], { ...f, path: [...f.path, n.id] });
        }
        case "forBlock":
          return [this.error(n.id, { kind: "structure", message: "블록 반복은 아직 조립하지 않습니다 (P7)", at })];
        default: {
          const bad = n as { kind: string; id: Id };
          return [this.error(bad.id, { kind: "structure", message: `${bad.kind} 은(는) 조 안에 올 수 없습니다`, at })];
        }
      }
    });
  }

  articles(list: DocumentNode["children"], f: Frame): (RArticle<RInline> | ErrorNode)[] {
    return list.flatMap((n): (RArticle<RInline> | ErrorNode)[] => {
      if (n.kind === "article") {
        const inner: Frame = { path: [...f.path, n.id], articleId: n.id, articleTitle: n.title };
        return [
          {
            kind: "article",
            id: n.id,
            title: n.title,
            ...(n.linkedArticleId !== undefined ? { linkedArticleId: n.linkedArticleId } : {}),
            children: this.blocks(n.children, inner),
          },
        ];
      }
      const r = this.select(n.branches, f, n.id);
      if (r.kind === "error") return [this.error(n.id, r.issue)];
      if (r.kind === "none") return [];
      return this.articles(r.branch.children as DocumentNode["children"], { ...f, path: [...f.path, n.id, r.branch.id] });
    });
  }
}

/** 문서 한 벌을 문맥으로 실행 — 조건 해소 + 공용조항 인라인화. 슬롯·참조는 남는다. */
export function resolveDocument(doc: DocumentNode, ctx: AssemblyContext, env: ResolveEnv): ResolveOutcome {
  const w = new Walker(ctx, env);
  const children = w.articles(doc.children, { path: [doc.id] });
  return { doc: { kind: "document", id: doc.id, title: doc.title, children }, issues: w.issues };
}
