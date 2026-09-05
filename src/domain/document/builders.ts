/**
 * 노드 빌더 — id 공급원을 주입받아 노드를 만든다. 테스트·시드·화면이 쓴다.
 * 기본 id 는 uuid (`crypto.randomUUID`). 테스트는 `sequentialIds()` 로 결정적 id 를 쓴다.
 */

import type { Code, Id } from "../types";
import type {
  AppendixRefNode,
  ArticleNode,
  ArticleRefNode,
  BlockBranch,
  BlockNode,
  ClauseBlockRefNode,
  ClauseInlineRefNode,
  CondBlockNode,
  DocumentNode,
  ForBlockNode,
  InlineBranch,
  InlineCondNode,
  InlineForNode,
  InlineNode,
  ItemNode,
  ParagraphNode,
  SlotNode,
  SubitemNode,
  TextNode,
} from "./nodes";

export type IdSource = () => Id;

export const randomIds: IdSource = () => globalThis.crypto.randomUUID();

/** `${prefix}1`, `${prefix}2`, … 결정적 id. */
export function sequentialIds(prefix = "n"): IdSource {
  let n = 0;
  return () => `${prefix}${++n}`;
}

export function nodeBuilders(newId: IdSource = randomIds) {
  return {
    document: (title: string, children: DocumentNode["children"] = []): DocumentNode => ({ id: newId(), kind: "document", title, children }),
    article: (title: string, children: BlockNode[] = [], opts: { linkedArticleId?: Id } = {}): ArticleNode => ({
      id: newId(),
      kind: "article",
      title,
      ...(opts.linkedArticleId !== undefined ? { linkedArticleId: opts.linkedArticleId } : {}),
      children,
    }),
    paragraph: (children: InlineNode[] = [], items?: ParagraphNode["items"]): ParagraphNode => ({
      id: newId(),
      kind: "paragraph",
      children,
      ...(items !== undefined ? { items } : {}),
    }),
    item: (children: InlineNode[] = [], subitems?: ItemNode["subitems"]): ItemNode => ({
      id: newId(),
      kind: "item",
      children,
      ...(subitems !== undefined ? { subitems } : {}),
    }),
    subitem: (children: InlineNode[] = []): SubitemNode => ({ id: newId(), kind: "subitem", children }),
    text: (text: string): TextNode => ({ id: newId(), kind: "text", text }),
    slot: (ref: string): SlotNode => ({ id: newId(), kind: "slot", ref }),
    condBlock: (branches: BlockBranch[]): CondBlockNode => ({ id: newId(), kind: "condBlock", branches }),
    branch: (when: string | undefined, children: BlockNode[] = []): BlockBranch => ({
      id: newId(),
      ...(when !== undefined ? { when } : {}),
      children,
    }),
    inlineCond: (branches: InlineBranch[]): InlineCondNode => ({ id: newId(), kind: "inlineCond", branches }),
    inlineBranch: (when: string | undefined, children: InlineNode[] = []): InlineBranch => ({
      id: newId(),
      ...(when !== undefined ? { when } : {}),
      children,
    }),
    forBlock: (source: string, children: BlockNode[] = [], alias?: string): ForBlockNode => ({
      id: newId(),
      kind: "forBlock",
      source,
      ...(alias !== undefined ? { alias } : {}),
      children,
    }),
    inlineFor: (source: string, children: InlineNode[] = [], opts: { alias?: string; separator?: string } = {}): InlineForNode => ({
      id: newId(),
      kind: "inlineFor",
      source,
      ...(opts.alias !== undefined ? { alias: opts.alias } : {}),
      children,
      ...(opts.separator !== undefined ? { separator: opts.separator } : {}),
    }),
    articleRef: (articleId: Id, scope: ArticleRefNode["scope"] = "self"): ArticleRefNode => ({ id: newId(), kind: "articleRef", articleId, scope }),
    appendixRef: (appendixCode: Code): AppendixRefNode => ({ id: newId(), kind: "appendixRef", appendixCode }),
    clauseBlock: (clauseCode: Code, options: Record<Code, Code> = {}): ClauseBlockRefNode => ({ id: newId(), kind: "clauseBlockRef", clauseCode, options }),
    clauseInline: (clauseCode: Code, options: Record<Code, Code> = {}): ClauseInlineRefNode => ({ id: newId(), kind: "clauseInlineRef", clauseCode, options }),
  };
}

export type NodeBuilders = ReturnType<typeof nodeBuilders>;
