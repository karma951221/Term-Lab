/**
 * 공용조항 본문 노드 — 문면 노드 트리(ADR-0012 · 2차구현_계획 §3.3)의 **부분집합**.
 *
 * 공용조항 본문은 문면과 같은 노드 모델을 쓰되, 공용조항 안에서 쓸 수 있는 종류만 여기 둔다.
 * B3(document)·C2(assembly) 통합 시 노드 타입을 하나로 합칠 수 있도록 **타입은 이 파일 한 곳**에만 둔다.
 *
 * - inline 본문 = `Inline[]` (문장 안 문구).  block 본문 = `Block[]` (항 또는 항 목록).
 * - 인라인 종류: `text · slot · inlineCond · articleRef · appendixRef · optionSlot`.
 *   **공용조항 참조(clauseInlineRef · clauseBlockRef)는 없다** — 중첩 금지(MVP, ADR-0008).
 *   반복(forBlock · inlineFor)도 MVP 이후라 없다.
 * - 블록 종류: `paragraph(항) · condBlock(조건 블록)`. 조(article)는 항상 사용처 소유라 없다.
 * - 호(item)·목(subitem)은 항의 하위 목록으로 매달린다.
 * - 인라인 조건의 중첩은 금지, 블록 조건의 중첩은 허용 (문면_기획).
 * - 식(`slot.ref` · `when`)은 코드 기반 소스 문자열 — 파싱·추출은 expression 모듈.
 * - 노드 id 는 공용조항 하나 안(본문 + 모든 옵션 선택지 본문)에서 유일해야 한다 —
 *   인라인화(`expandClause`)가 `${참조노드id}/${원노드id}` 로 유일화하기 때문.
 *
 * DB·React import 금지 (순수층).
 */

import type { Code, Id } from "../types";

// ───────────────────────────── 인라인 ─────────────────────────────

/** 텍스트런. */
export interface TextNode {
  id: Id;
  kind: "text";
  text: string;
}

/** 값 치환 슬롯 — `ref` 는 식 참조 경로 문자열 (`D0001` · `D0002.F01` · `builtin.…` · `attr.…`). */
export interface SlotNode {
  id: Id;
  kind: "slot";
  ref: string;
}

/** 인라인 조건의 가지. `when` 이 없으면 else 가지 (마지막 가지에만 허용). */
export interface InlineBranch {
  id: Id;
  when?: string;
  /** 인라인 조건 안에는 다시 inlineCond 를 둘 수 없다 (검증으로 강제). */
  children: Inline[];
}

/** 인라인 조건 (if / elif / else). */
export interface InlineCondNode {
  id: Id;
  kind: "inlineCond";
  branches: InlineBranch[];
}

/** 조 참조 슬롯 — 조 id 를 저장하고 렌더 시 계산된 번호를 찍는다. */
export interface ArticleRefNode {
  id: Id;
  kind: "articleRef";
  articleId: Id;
}

/** 별표 참조 슬롯 — 별표 불변 코드. 번호는 책자별 계산값. */
export interface AppendixRefNode {
  id: Id;
  kind: "appendixRef";
  appendixCode: Code;
}

/** 옵션 자리 — 사용처가 고른 선택지(OptionValue)의 본문이 이 자리에 들어간다 (ADR-0017). */
export interface OptionSlotNode {
  id: Id;
  kind: "optionSlot";
  optionCode: Code;
}

export type Inline =
  | TextNode
  | SlotNode
  | InlineCondNode
  | ArticleRefNode
  | AppendixRefNode
  | OptionSlotNode;

export type InlineKind = Inline["kind"];

// ───────────────────────────── 블록 ─────────────────────────────

/** 목. */
export interface SubitemNode {
  id: Id;
  kind: "subitem";
  children: Inline[];
}

/** 호. */
export interface ItemNode {
  id: Id;
  kind: "item";
  children: Inline[];
  subitems?: SubitemNode[];
}

/** 항. */
export interface ParagraphNode {
  id: Id;
  kind: "paragraph";
  children: Inline[];
  items?: ItemNode[];
}

/** 블록 조건의 가지. `when` 이 없으면 else 가지 (마지막 가지에만 허용). */
export interface BlockBranch {
  id: Id;
  when?: string;
  /** 블록 조건은 중첩 허용 — 가지 안에 다시 condBlock 이 올 수 있다. */
  children: Block[];
}

/** 블록 조건 (if / elif / else) — 항 자리에 선다. */
export interface CondBlockNode {
  id: Id;
  kind: "condBlock";
  branches: BlockBranch[];
}

export type Block = ParagraphNode | CondBlockNode;

export type BlockKind = Block["kind"];

/** 공용조항 안에 나타날 수 있는 모든 노드. */
export type ClauseNode = Inline | Block | ItemNode | SubitemNode;

export type ClauseNodeKind = ClauseNode["kind"];

export const INLINE_KINDS: readonly InlineKind[] = [
  "text",
  "slot",
  "inlineCond",
  "articleRef",
  "appendixRef",
  "optionSlot",
];

export const BLOCK_KINDS: readonly BlockKind[] = ["paragraph", "condBlock"];
