/**
 * 문면 노드 트리 — 저장 단위 (ADR-0012 · 2차구현_계획 §3.3 · 문면_기획 「저장 단위」).
 *
 * 문서 = 일반 노드 트리. 깊이·종류를 스키마에 고정하지 않고 **노드 종류별 허용 자식을 규칙 테이블**로 건다.
 * 노드는 세 부류다:
 *   - 구조   : document · article(조) · paragraph(항) · item(호) · subitem(목)
 *   - 블록 동적: condBlock(if/elif/else) · forBlock(자리만, 평가 P7) · clauseBlockRef(공용조항 block 참조)
 *   - 인라인  : text · slot · inlineCond · inlineFor(자리만) · articleRef · appendixRef · clauseInlineRef
 *
 * - 조의 메타는 조 명 · 조연결(`linkedArticleId`) 뿐. 번호는 저장하지 않는다 (계산값 — numbering.ts).
 * - 식이 들어가는 자리(`when` · `slot.ref`)는 코드 기반 소스 문자열 — 파싱·검사는 expression 모듈.
 * - 노드 id 는 트리 안에서 유일 (조건 가지 id 포함).
 * - B2 `src/domain/clause/nodes.ts` 와 같은 모양이다 (통합 시 하나로 합친다). 차이: articleRef 에 `scope`.
 *
 * DB·React import 금지 (순수층).
 */

import type { Code, Coordinate, Id, Issue } from "../types";

// ───────────────────────────── 인라인 ─────────────────────────────

/** 텍스트런. */
export interface TextNode {
  id: Id;
  kind: "text";
  text: string;
}

/** 값 치환 슬롯 — `ref` 는 값 참조 경로 (`D0001` · `D0002.F01` · `builtin.subCoverage.name`). 이름 슬롯은 없다. */
export interface SlotNode {
  id: Id;
  kind: "slot";
  ref: string;
}

/** 인라인 조건의 가지. `when` 없음 = else (마지막 가지에만, 최대 1개 — D-P4-11). */
export interface InlineBranch {
  id: Id;
  when?: string;
  children: InlineNode[];
}

/** 인라인 조건 (문장 중간 if/elif/else). 중첩 금지 (문면_기획). */
export interface InlineCondNode {
  id: Id;
  kind: "inlineCond";
  branches: InlineBranch[];
}

/** 인라인 반복 — 자리만 (구현 P7). `source` 는 순회 소스(`subCoverage` · `benefit`), `separator` 는 원소 구분 문자열 (D-P4-17). */
export interface InlineForNode {
  id: Id;
  kind: "inlineFor";
  source: string;
  alias?: string;
  children: InlineNode[];
  separator?: string;
}

/**
 * 조 참조 슬롯 — 조 id 를 저장하고 렌더 시 계산된 번호(+조 명)를 찍는다.
 * `self` = 같은 문서의 조, `general` = 대응 보통약관(D-P4-5)의 조 (담보약관에서만 — D-P4-20).
 */
export interface ArticleRefNode {
  id: Id;
  kind: "articleRef";
  articleId: Id;
  scope: "self" | "general";
}

/** 별표 참조 슬롯 — 별표 불변 코드만. 번호는 책자별 계산값 (조립). */
export interface AppendixRefNode {
  id: Id;
  kind: "appendixRef";
  appendixCode: Code;
}

/** 공용조항 inline 참조 — 옵션 선택은 사용처(이 문서) 소유 (ADR-0017). */
export interface ClauseInlineRefNode {
  id: Id;
  kind: "clauseInlineRef";
  clauseCode: Code;
  /** optionCode → 선택한 valueCode. 미선택 옵션은 키 없음. */
  options: Record<Code, Code>;
}

export type InlineNode =
  | TextNode
  | SlotNode
  | InlineCondNode
  | InlineForNode
  | ArticleRefNode
  | AppendixRefNode
  | ClauseInlineRefNode;

// ───────────────────────────── 블록 ─────────────────────────────

/** 목. */
export interface SubitemNode {
  id: Id;
  kind: "subitem";
  children: InlineNode[];
}

/** 호. 목은 `subitems` 목록에 (조건 블록도 그 자리에 설 수 있다). */
export interface ItemNode {
  id: Id;
  kind: "item";
  children: InlineNode[];
  subitems?: (SubitemNode | CondBlockNode)[];
}

/** 항. 호는 `items` 목록에. */
export interface ParagraphNode {
  id: Id;
  kind: "paragraph";
  children: InlineNode[];
  items?: (ItemNode | CondBlockNode)[];
}

/** 블록 조건의 가지. */
export interface BlockBranch {
  id: Id;
  when?: string;
  children: BlockNode[];
}

/**
 * 블록 조건 — 구조 노드가 서는 자리에 대신 선다 (조 자리면 조 단위 on/off).
 * 가지 안에 올 수 있는 종류 = 이 블록이 서 있는 자리의 허용 집합 (투명). 중첩 허용.
 */
export interface CondBlockNode {
  id: Id;
  kind: "condBlock";
  branches: BlockBranch[];
}

/** 블록 반복 — 자리만 (P7). 항 이하 구조 노드를 품는다. 중첩 금지 (D-P4-16). */
export interface ForBlockNode {
  id: Id;
  kind: "forBlock";
  source: string;
  alias?: string;
  children: BlockNode[];
}

/** 공용조항 block 참조 — 항 자리에 선다 (항 또는 항 목록). 조 제목 포함 block 은 없다. */
export interface ClauseBlockRefNode {
  id: Id;
  kind: "clauseBlockRef";
  clauseCode: Code;
  options: Record<Code, Code>;
}

/** 조. 메타는 조 명 · 조연결뿐. */
export interface ArticleNode {
  id: Id;
  kind: "article";
  title: string;
  /** 조연결 — 대응 보통약관 조 id (담보약관에서만, 조당 최대 1개 — D-P4-21·22). */
  linkedArticleId?: Id;
  children: BlockNode[];
}

export type BlockNode =
  | ArticleNode
  | ParagraphNode
  | ItemNode
  | SubitemNode
  | CondBlockNode
  | ForBlockNode
  | ClauseBlockRefNode;

/** 문서 루트. 자식은 조 또는 조 자리의 조건 블록. */
export interface DocumentNode {
  id: Id;
  kind: "document";
  title: string;
  children: (ArticleNode | CondBlockNode)[];
}

export type Node = DocumentNode | BlockNode | InlineNode;
export type NodeKind = Node["kind"];

// ───────────────────────────── 허용 자식 규칙 ─────────────────────────────

const INLINE: readonly NodeKind[] = ["text", "slot", "inlineCond", "inlineFor", "articleRef", "appendixRef", "clauseInlineRef"];

/**
 * 종류별 `children` 자리의 허용 자식. 규칙의 확장(그룹 노드·표)은 여기만 고친다 (ADR-0012).
 * - condBlock 은 **투명** — 서 있는 자리의 허용 집합을 가지에 물려준다 (여기 값은 쓰이지 않는다).
 * - 인라인 조건 안에 인라인 조건 없음, 반복 안에 반복 없음 (인라인 반복 안에는 인라인 조건도 두지 않는다).
 */
export const allowedChildren: Record<NodeKind, readonly NodeKind[]> = {
  document: ["article", "condBlock"],
  article: ["paragraph", "condBlock", "clauseBlockRef", "forBlock"],
  paragraph: INLINE,
  item: INLINE,
  subitem: INLINE,
  condBlock: [],
  forBlock: ["paragraph", "condBlock", "clauseBlockRef"],
  clauseBlockRef: [],
  text: [],
  slot: [],
  inlineCond: INLINE.filter((k) => k !== "inlineCond"),
  inlineFor: INLINE.filter((k) => k !== "inlineFor" && k !== "inlineCond"),
  articleRef: [],
  appendixRef: [],
  clauseInlineRef: [],
};

/** 두 번째 목록 자리 — 항의 호 목록 · 호의 목 목록. 조건 블록도 그 자리에 설 수 있다. */
export const allowedListChildren = {
  "paragraph.items": ["item", "condBlock"],
  "item.subitems": ["subitem", "condBlock"],
} as const satisfies Record<string, readonly NodeKind[]>;

export type SlotName = "children" | "items" | "subitems";

/** 노드 종류가 가진 목록 자리들 (순서 = 렌더 순서). */
export function slotsOf(kind: NodeKind): readonly SlotName[] {
  switch (kind) {
    case "paragraph":
      return ["children", "items"];
    case "item":
      return ["children", "subitems"];
    case "condBlock":
    case "inlineCond":
    case "clauseBlockRef":
    case "text":
    case "slot":
    case "articleRef":
    case "appendixRef":
    case "clauseInlineRef":
      return [];
    default:
      return ["children"];
  }
}

/** (부모 종류, 자리) 의 허용 자식. 부모가 그 자리를 갖지 않으면 undefined. */
export function allowedIn(parentKind: NodeKind, slot: SlotName): readonly NodeKind[] | undefined {
  if (slot === "children") return slotsOf(parentKind).includes("children") ? allowedChildren[parentKind] : undefined;
  if (slot === "items") return parentKind === "paragraph" ? allowedListChildren["paragraph.items"] : undefined;
  return parentKind === "item" ? allowedListChildren["item.subitems"] : undefined;
}

/** 노드의 목록 자리를 읽는다 (없으면 undefined). 가지는 별도. */
export function listOf(node: Node, slot: SlotName): Node[] | undefined {
  switch (slot) {
    case "children":
      return "children" in node ? (node.children as Node[]) : undefined;
    case "items":
      return node.kind === "paragraph" ? (node.items as Node[] | undefined) : undefined;
    case "subitems":
      return node.kind === "item" ? (node.subitems as Node[] | undefined) : undefined;
  }
}

/** 조건 노드(블록·인라인)의 가지 목록. */
export function branchesOf(node: Node): (BlockBranch | InlineBranch)[] | undefined {
  return node.kind === "condBlock" || node.kind === "inlineCond" ? node.branches : undefined;
}

// ───────────────────────────── 색인 ─────────────────────────────

export interface NodeEntry {
  node: Node;
  /** 부모 노드 id 또는 가지 id. 루트는 없음. */
  parentId?: Id;
  slot: SlotName;
  index: number;
  /** 루트부터 자기까지의 id 경로 (가지 id 포함) — Coordinate.nodePath. */
  path: Id[];
  /** 가장 가까운 조 (자기 자신 포함). */
  articleId?: Id;
  /** 이 노드가 실제로 서 있는 자리의 허용 집합 (조건 블록의 투명성을 반영). */
  allowed: readonly NodeKind[];
  /** 조상 중 인라인 조건 · 반복이 있는가 (중첩 금지 검사용). */
  inInlineCond: boolean;
  inFor: boolean;
}

export interface BranchEntry {
  branch: BlockBranch | InlineBranch;
  /** 소유 조건 노드 id. */
  ownerId: Id;
  index: number;
  path: Id[];
  articleId?: Id;
  allowed: readonly NodeKind[];
}

export interface TreeIndex {
  nodes: Map<Id, NodeEntry>;
  branches: Map<Id, BranchEntry>;
  /** 두 번 이상 등장한 id (첫 등장만 색인에 남는다). */
  duplicates: Id[];
  /** 규칙 위반(허용 자식 · 중첩) — 색인하면서 발견한 것. */
  issues: Issue[];
}

interface Frame {
  parentId?: Id;
  slot: SlotName;
  index: number;
  path: Id[];
  articleId?: Id;
  allowed: readonly NodeKind[];
  inInlineCond: boolean;
  inFor: boolean;
}

/** 트리를 한 번 훑어 노드·가지 색인과 구조 규칙 위반을 만든다. */
export function indexTree(doc: DocumentNode, base: Coordinate = {}): TreeIndex {
  const nodes = new Map<Id, NodeEntry>();
  const branches = new Map<Id, BranchEntry>();
  const duplicates: Id[] = [];
  const issues: Issue[] = [];
  const titles = new Map<Id, string>();

  const at = (path: Id[], articleId: Id | undefined): Coordinate => ({
    ...base,
    ...(articleId !== undefined ? { articleId, articleTitle: titles.get(articleId) } : {}),
    nodePath: path,
  });
  const structure = (message: string, path: Id[], articleId?: Id) => {
    issues.push({ kind: "structure", message, at: at(path, articleId) });
  };

  const seen = (id: Id, path: Id[], articleId: Id | undefined): boolean => {
    if (nodes.has(id) || branches.has(id)) {
      if (!duplicates.includes(id)) duplicates.push(id);
      structure(`노드 id ${id} 가 트리 안에 두 번 나옵니다`, path, articleId);
      return true;
    }
    return false;
  };

  const visit = (node: Node, f: Frame): void => {
    const path = [...f.path, node.id];
    const articleId = node.kind === "article" ? node.id : f.articleId;
    if (node.kind === "article") titles.set(node.id, node.title);
    if (seen(node.id, path, articleId)) return;

    if (f.parentId !== undefined && !f.allowed.includes(node.kind)) {
      const parentKind = nodes.get(f.parentId)?.node.kind ?? "condBlock";
      structure(`${parentKind} 의 ${f.slot} 자리에 ${node.kind} 은(는) 올 수 없습니다`, path, articleId);
    }
    if (node.kind === "inlineCond" && f.inInlineCond) {
      structure("인라인 조건 안에 인라인 조건을 둘 수 없습니다 — 항을 쪼개 블록 조건으로 푸세요", path, articleId);
    }
    if ((node.kind === "forBlock" || node.kind === "inlineFor") && f.inFor) {
      structure("반복 안에 반복을 둘 수 없습니다 (MVP)", path, articleId);
    }

    nodes.set(node.id, {
      node,
      parentId: f.parentId,
      slot: f.slot,
      index: f.index,
      path,
      articleId,
      allowed: f.allowed,
      inInlineCond: f.inInlineCond,
      inFor: f.inFor,
    });

    const inInlineCond = f.inInlineCond || node.kind === "inlineCond";
    const inFor = f.inFor || node.kind === "forBlock" || node.kind === "inlineFor";

    const brs = branchesOf(node);
    if (brs !== undefined) {
      if (brs.length === 0) structure("조건 노드에는 가지가 하나 이상 있어야 합니다", path, articleId);
      brs.forEach((br, i) => {
        const bpath = [...path, br.id];
        if (seen(br.id, bpath, articleId)) return;
        if (br.when === undefined && i !== brs.length - 1) {
          structure("else 가지는 마지막에만 올 수 있습니다", path, articleId);
        }
        branches.set(br.id, { branch: br, ownerId: node.id, index: i, path: bpath, articleId, allowed: f.allowed });
        // 가지 안의 허용 집합 = 조건 노드가 서 있는 자리의 허용 집합 (투명)
        (br.children as Node[]).forEach((child, ci) =>
          visit(child, { parentId: br.id, slot: "children", index: ci, path: bpath, articleId, allowed: f.allowed, inInlineCond, inFor }),
        );
      });
      return;
    }

    for (const slot of slotsOf(node.kind)) {
      const list = listOf(node, slot);
      if (!list) continue;
      const allowed = allowedIn(node.kind, slot) ?? [];
      list.forEach((child, ci) =>
        visit(child, { parentId: node.id, slot, index: ci, path, articleId, allowed, inInlineCond, inFor }),
      );
    }
  };

  visit(doc, { slot: "children", index: 0, path: [], allowed: ["document"], inInlineCond: false, inFor: false });
  return { nodes, branches, duplicates, issues };
}

// ───────────────────────────── 검증 ─────────────────────────────

/**
 * 공용조항 게이트 — B2(clause) 가 구현해 주입한다. 없으면 전부 통과.
 * - clauseExists    : 코드가 정의돼 있는가 (없으면 참조 추가 실패 → brokenRef)
 * - requiredCodes   : 그 공용조항이 읽는 요구 구분자 (ADR-0010 부착 검사 재료)
 * - validateOptions : 선택 옵션 검사 — 미선택 `optionUnselected`(저장 시점만 거부, ADR-0017) · 집합 밖 `optionInvalid`
 */
export interface ClauseGate {
  clauseExists(code: Code): boolean;
  requiredCodes(code: Code): Code[];
  validateOptions(code: Code, options: Record<Code, Code>): Issue[];
}

export const PERMISSIVE_GATE: ClauseGate = {
  clauseExists: () => true,
  requiredCodes: () => [],
  validateOptions: () => [],
};

/** 검증 환경 — 문서 밖의 사실. 주지 않은 항목은 검사하지 않는다. */
export interface TreeEnv {
  /** 문서 종류. general 이면 조연결·보통약관 조 참조가 금지된다 (D-P4-20·22). */
  kind?: "special" | "general";
  /** 대응 보통약관(D-P4-5)의 조 id 집합. 조연결·`scope:'general'` 참조의 대상 검증. */
  generalArticleIds?: ReadonlySet<Id>;
  appendixExists?: (code: Code) => boolean;
  clauseGate?: ClauseGate;
  /** 이슈 좌표의 기본값 (document · ownerId 등). */
  coordinate?: Coordinate;
}

/**
 * 저장 시점 구조 검증 — 허용 자식 · 인라인 조건/반복 중첩 · id 중복 · 가지 규칙 · 참조 대상 존재 · 공용조항 게이트.
 * 식의 문법·타입은 `validateExpressions` (expressions.ts) 가 따로 본다.
 */
export function validateTree(doc: DocumentNode, env: TreeEnv = {}): Issue[] {
  const base = env.coordinate ?? {};
  const ix = indexTree(doc, base);
  const issues = [...ix.issues];

  if (doc.kind !== "document") {
    issues.push({ kind: "structure", message: "루트는 document 노드여야 합니다", at: { ...base, nodePath: [doc.id] } });
  }

  for (const e of ix.nodes.values()) issues.push(...checkNodeRefs(e, ix, env, true));
  return issues;
}

/** 색인 항목의 좌표 (문서 기본 좌표 + 조 + 노드 경로). */
export function coordinateOf(ix: TreeIndex, e: { path: Id[]; articleId?: Id }, base: Coordinate = {}): Coordinate {
  return {
    ...base,
    ...(e.articleId !== undefined
      ? { articleId: e.articleId, articleTitle: (ix.nodes.get(e.articleId)?.node as ArticleNode | undefined)?.title }
      : {}),
    nodePath: e.path,
  };
}

/**
 * 노드 하나의 참조 검사 — 조연결 · 조 참조 · 별표 참조 · 공용조항 참조.
 * 참조 추가 시점(`atSave=false`)과 저장 시점(`atSave=true`) 이 같은 함수를 쓴다 (문면_기획 「참조 무결성」 두 겹).
 */
export function checkNodeRefs(e: NodeEntry, ix: TreeIndex, env: TreeEnv, atSave: boolean): Issue[] {
  const n = e.node;
  const at = coordinateOf(ix, e, env.coordinate);
  const gate = env.clauseGate ?? PERMISSIVE_GATE;
  const one = (kind: Issue["kind"], message: string): Issue[] => [{ kind, message, at }];
  switch (n.kind) {
    case "article":
      if (n.linkedArticleId === undefined) return [];
      if (env.kind === "general") return one("structure", "보통약관 문서의 조에는 조연결을 둘 수 없습니다");
      if (env.generalArticleIds && !env.generalArticleIds.has(n.linkedArticleId)) {
        return one("brokenRef", `조연결 대상 조 ${n.linkedArticleId} 가 대응 보통약관에 없습니다`);
      }
      return [];
    case "articleRef":
      if (n.scope === "self") {
        return ix.nodes.get(n.articleId)?.node.kind === "article" ? [] : one("brokenRef", `조 참조 대상 ${n.articleId} 가 이 문서에 없습니다`);
      }
      if (env.kind === "general") return one("structure", "보통약관 문서에서는 보통약관 조 참조를 쓸 수 없습니다");
      if (env.generalArticleIds && !env.generalArticleIds.has(n.articleId)) {
        return one("brokenRef", `보통약관 조 참조 대상 ${n.articleId} 가 대응 보통약관에 없습니다`);
      }
      return [];
    case "appendixRef":
      return env.appendixExists && !env.appendixExists(n.appendixCode) ? one("brokenRef", `별표 ${n.appendixCode} 가 별표 마스터에 없습니다`) : [];
    case "clauseBlockRef":
    case "clauseInlineRef":
      return checkClauseRef(n, gate, at, atSave);
    default:
      return [];
  }
}

/**
 * 공용조항 참조 검사. `atSave` 가 false 면(참조 추가 시점) 옵션 미선택은 거르지 않는다 (ADR-0017).
 */
export function checkClauseRef(
  node: ClauseBlockRefNode | ClauseInlineRefNode,
  gate: ClauseGate,
  at: Coordinate,
  atSave: boolean,
): Issue[] {
  if (!gate.clauseExists(node.clauseCode)) {
    return [{ kind: "brokenRef", message: `공용조항 ${node.clauseCode} 가 없습니다`, at }];
  }
  return gate
    .validateOptions(node.clauseCode, node.options)
    .filter((i) => atSave || i.kind !== "optionUnselected")
    .map((i) => ({ ...i, at: { ...at, ...i.at } }));
}
