/**
 * 트리 편집 커맨드 — 전부 `(tree, command) → Result<tree>` 순수 함수. 입력 트리는 바꾸지 않는다.
 *
 * 구조 편집기(ADR-0012)의 조작이 그대로 커맨드다: 추가 · 삭제 · 이동 · 복제 · 텍스트/조 명 · 슬롯/참조 대상 ·
 * 조건 가지(추가·식·삭제·순서) · 반복 속성 · 조연결 · 공용조항 옵션.
 *
 * 검증 원칙:
 * - 커맨드는 **자기가 건드린 자리**만 검사한다 (허용 자식 · 중첩 · id 유일 · 가지 규칙 · 참조 대상 존재).
 *   문서 전체의 저장 검증은 `validateTree` + `validateExpressions` (서비스가 저장 직전에).
 * - 참조를 **추가하는 시점**에 대상 존재를 검증한다 (문면_기획 참조 무결성). 공용조항 옵션 미선택은
 *   추가 시점엔 통과, 저장 시점에 거부 (ADR-0017).
 * - 참조되는 조는 삭제할 수 없다 — 참조처 좌표를 제시한다 (D-P4-7). 같이 지워지는 참조는 무관.
 */

import { ok, reject } from "../types";
import type { Code, Id, Issue, Result } from "../types";
import type { IdSource } from "./builders";
import { randomIds } from "./builders";
import {
  allowedIn,
  branchesOf,
  checkNodeRefs,
  coordinateOf,
  indexTree,
  listOf,
  slotsOf,
  type ArticleRefNode,
  type BlockBranch,
  type BlockNode,
  type DocumentNode,
  type InlineBranch,
  type InlineNode,
  type Node,
  type NodeEntry,
  type SlotName,
  type TreeEnv,
  type TreeIndex,
} from "./nodes";

// ───────────────────────────── 커맨드 ─────────────────────────────

/** 삽입 자리 — 부모(노드 id 또는 가지 id) · 목록 자리 · 위치(없으면 끝). */
export interface Position {
  parentId: Id;
  slot?: SlotName;
  index?: number;
}

export type Command =
  | { type: "insert"; node: BlockNode | InlineNode; at: Position }
  | { type: "remove"; nodeId: Id }
  | { type: "move"; nodeId: Id; to: Position }
  /** 하위 트리 · 조연결 · 참조 대상을 그대로 복사한 사본을 원본 바로 뒤(또는 `at`)에 (D-P4-9). 노드 id 는 새로. */
  | { type: "duplicate"; nodeId: Id; at?: Position }
  | { type: "setText"; nodeId: Id; text: string }
  /** 조 명 또는 문서 제목. */
  | { type: "setTitle"; nodeId: Id; title: string }
  | { type: "setSlotRef"; nodeId: Id; ref: string }
  | { type: "setArticleRef"; nodeId: Id; articleId: Id; scope: ArticleRefNode["scope"] }
  | { type: "setAppendixRef"; nodeId: Id; appendixCode: Code }
  | { type: "setClauseOptions"; nodeId: Id; options: Record<Code, Code> }
  | { type: "setFor"; nodeId: Id; source?: string; alias?: string; separator?: string }
  | { type: "addBranch"; condId: Id; branch: BlockBranch | InlineBranch; index?: number }
  /** `when` 없음 = else 로 바꾼다. */
  | { type: "setWhen"; branchId: Id; when?: string }
  | { type: "removeBranch"; branchId: Id }
  | { type: "moveBranch"; branchId: Id; index: number }
  /** 조연결 설정(`linkedArticleId`) 또는 해제(undefined). */
  | { type: "link"; articleId: Id; linkedArticleId?: Id };

export interface ApplyOptions {
  env?: TreeEnv;
  /** 복제가 쓰는 새 id 공급원. 기본 uuid. */
  newId?: IdSource;
}

// ───────────────────────────── 헬퍼 ─────────────────────────────

function invalid<T>(issues: Issue[]): Result<T> {
  return reject({ reason: "invalid", issues });
}

function structure<T>(message: string, nodePath: Id[]): Result<T> {
  return invalid([{ kind: "structure", message, at: { nodePath } }]);
}

function notFound<T>(what: string): Result<T> {
  return reject({ reason: "notFound", what });
}

/** 하위 트리의 모든 id (노드 + 가지). */
function idsIn(node: Node): Set<Id> {
  const out = new Set<Id>();
  const walk = (n: Node) => {
    out.add(n.id);
    const brs = branchesOf(n);
    if (brs) {
      for (const br of brs) {
        out.add(br.id);
        (br.children as Node[]).forEach(walk);
      }
      return;
    }
    for (const slot of slotsOf(n.kind)) listOf(n, slot)?.forEach(walk);
  };
  walk(node);
  return out;
}

/** 하위 트리의 노드들 (자기 포함, 전위 순). */
function nodesIn(node: Node): Node[] {
  const out: Node[] = [];
  const walk = (n: Node) => {
    out.push(n);
    const brs = branchesOf(n);
    if (brs) {
      for (const br of brs) (br.children as Node[]).forEach(walk);
      return;
    }
    for (const slot of slotsOf(n.kind)) listOf(n, slot)?.forEach(walk);
  };
  walk(node);
  return out;
}

interface Container {
  list: Node[];
  allowed: readonly Node["kind"][];
  path: Id[];
}

/** 자리(Position)의 목록을 찾는다. 항의 items 같은 선택 목록은 없으면 만든다. */
function containerOf(ix: TreeIndex, pos: Position): Result<Container> {
  const slot = pos.slot ?? "children";
  const br = ix.branches.get(pos.parentId);
  if (br) {
    if (slot !== "children") return structure(`가지에는 ${slot} 자리가 없습니다`, br.path);
    return ok({ list: br.branch.children as Node[], allowed: br.allowed, path: br.path });
  }
  const e = ix.nodes.get(pos.parentId);
  if (!e) return notFound(`노드 ${pos.parentId}`);
  const allowed = allowedIn(e.node.kind, slot);
  if (allowed === undefined) return structure(`${e.node.kind} 에는 ${slot} 자리가 없습니다`, e.path);
  let list = listOf(e.node, slot);
  if (!list) {
    list = [];
    (e.node as unknown as Record<string, unknown>)[slot] = list;
  }
  return ok({ list, allowed, path: e.path });
}

/** 색인의 규칙 위반 중 주어진 id 들을 경로에 품은 것만 — 「이 커맨드가 건드린 자리」의 위반. */
function issuesTouching(ix: TreeIndex, ids: ReadonlySet<Id>): Issue[] {
  return ix.issues.filter((i) => i.at.nodePath?.some((id) => ids.has(id)));
}

/** 하위 트리 안 참조 노드들의 대상 검증 (추가 시점). */
function refIssuesIn(ix: TreeIndex, root: Node, env: TreeEnv): Issue[] {
  const out: Issue[] = [];
  for (const n of nodesIn(root)) {
    const e = ix.nodes.get(n.id);
    if (e) out.push(...checkNodeRefs(e, ix, env, false));
  }
  return out;
}

/** 삽입·이동 뒤 공통 검사 — 건드린 자리의 구조 위반 + 참조 대상. */
function verifyPlaced(doc: DocumentNode, node: Node, env: TreeEnv): Result<DocumentNode> {
  const ix = indexTree(doc, env.coordinate);
  const issues = [...issuesTouching(ix, idsIn(node)), ...refIssuesIn(ix, node, env)];
  return issues.length > 0 ? invalid(issues) : ok(doc);
}

/** 삭제될 조를 밖에서 가리키는 조 참조 슬롯 (D-P4-7). */
function danglingRefs(ix: TreeIndex, removed: ReadonlySet<Id>, env: TreeEnv): Issue[] {
  const out: Issue[] = [];
  for (const e of ix.nodes.values()) {
    const n = e.node;
    if (n.kind !== "articleRef" || n.scope !== "self" || removed.has(n.id) || !removed.has(n.articleId)) continue;
    out.push({
      kind: "brokenRef",
      message: `조 ${n.articleId} 를 가리키는 조 참조 슬롯이 남아 있습니다`,
      at: coordinateOf(ix, e, env.coordinate),
    });
  }
  return out;
}

/** else 는 마지막에 최대 1개 (D-P4-11). */
function elseRule(branches: (BlockBranch | InlineBranch)[], path: Id[]): Result<void> {
  const elseAt = branches.findIndex((b) => b.when === undefined);
  if (elseAt !== -1 && elseAt !== branches.length - 1) return structure("else 가지는 마지막에만 올 수 있습니다", path);
  if (branches.filter((b) => b.when === undefined).length > 1) return structure("else 가지는 하나만 둘 수 있습니다", path);
  return ok(undefined);
}

function entryOf(ix: TreeIndex, id: Id): Result<NodeEntry> {
  const e = ix.nodes.get(id);
  return e ? ok(e) : notFound(`노드 ${id}`);
}

/** 하위 트리를 새 id 로 복사한다. 사본 안의 자기 조 참조는 사본의 조를 가리킨다. 조연결·보통약관 참조는 그대로. */
function cloneSubtree<T extends Node>(root: T, newId: IdSource): T {
  const copy = structuredClone(root);
  const map = new Map<Id, Id>();
  const relabel = (n: Node) => {
    const id = newId();
    map.set(n.id, id);
    n.id = id;
    const brs = branchesOf(n);
    if (brs) {
      for (const br of brs) {
        const bid = newId();
        map.set(br.id, bid);
        br.id = bid;
        (br.children as Node[]).forEach(relabel);
      }
      return;
    }
    for (const slot of slotsOf(n.kind)) listOf(n, slot)?.forEach(relabel);
  };
  relabel(copy);
  for (const n of nodesIn(copy)) {
    if (n.kind === "articleRef" && n.scope === "self") {
      const mapped = map.get(n.articleId);
      if (mapped !== undefined) n.articleId = mapped;
    }
  }
  return copy;
}

/** 문서 복제 (D-P4-4) — 모든 id 새로, 내부 조 참조는 따라간다. */
export function cloneTree(doc: DocumentNode, newId: IdSource = randomIds, title?: string): DocumentNode {
  const copy = cloneSubtree(doc, newId);
  return title === undefined ? copy : { ...copy, title };
}

// ───────────────────────────── 적용 ─────────────────────────────

export function applyCommands(doc: DocumentNode, commands: readonly Command[], opts: ApplyOptions = {}): Result<DocumentNode> {
  let cur = doc;
  for (const cmd of commands) {
    const r = applyCommand(cur, cmd, opts);
    if (!r.ok) return r;
    cur = r.value;
  }
  return ok(cur);
}

export function applyCommand(doc: DocumentNode, cmd: Command, opts: ApplyOptions = {}): Result<DocumentNode> {
  const env = opts.env ?? {};
  const work = structuredClone(doc);
  const ix = indexTree(work, env.coordinate);

  switch (cmd.type) {
    case "insert": {
      const c = containerOf(ix, cmd.at);
      if (!c.ok) return c;
      if (!c.value.allowed.includes(cmd.node.kind)) {
        return structure(`이 자리에 ${cmd.node.kind} 은(는) 올 수 없습니다 (허용: ${c.value.allowed.join(" · ")})`, [...c.value.path]);
      }
      const node = structuredClone(cmd.node);
      c.value.list.splice(clampIndex(cmd.at.index, c.value.list.length), 0, node);
      return verifyPlaced(work, node, env);
    }

    case "remove": {
      const e = entryOf(ix, cmd.nodeId);
      if (!e.ok) return e;
      if (e.value.parentId === undefined) return structure("문서 루트는 삭제할 수 없습니다", e.value.path);
      const dangling = danglingRefs(ix, idsIn(e.value.node), env);
      if (dangling.length > 0) return invalid(dangling);
      detach(ix, e.value);
      return ok(work);
    }

    case "move": {
      const e = entryOf(ix, cmd.nodeId);
      if (!e.ok) return e;
      if (e.value.parentId === undefined) return structure("문서 루트는 옮길 수 없습니다", e.value.path);
      const subtree = idsIn(e.value.node);
      if (subtree.has(cmd.to.parentId)) return structure("노드를 자기 하위로 옮길 수 없습니다", e.value.path);
      const c = containerOf(ix, cmd.to);
      if (!c.ok) return c;
      if (!c.value.allowed.includes(e.value.node.kind)) {
        return structure(`이 자리에 ${e.value.node.kind} 은(는) 올 수 없습니다 (허용: ${c.value.allowed.join(" · ")})`, [...c.value.path]);
      }
      detach(ix, e.value);
      c.value.list.splice(clampIndex(cmd.to.index, c.value.list.length), 0, e.value.node);
      return verifyPlaced(work, e.value.node, env);
    }

    case "duplicate": {
      const e = entryOf(ix, cmd.nodeId);
      if (!e.ok) return e;
      if (e.value.parentId === undefined) return structure("문서 루트는 복제할 수 없습니다 (문서 복제는 서비스 몫)", e.value.path);
      const copy = cloneSubtree(e.value.node, opts.newId ?? randomIds);
      const at: Position = cmd.at ?? { parentId: e.value.parentId, slot: e.value.slot, index: e.value.index + 1 };
      const c = containerOf(ix, at);
      if (!c.ok) return c;
      if (!c.value.allowed.includes(copy.kind)) return structure(`이 자리에 ${copy.kind} 은(는) 올 수 없습니다`, [...c.value.path]);
      c.value.list.splice(clampIndex(at.index, c.value.list.length), 0, copy);
      return verifyPlaced(work, copy, env);
    }

    case "setText": {
      const e = entryOf(ix, cmd.nodeId);
      if (!e.ok) return e;
      if (e.value.node.kind !== "text") return structure("텍스트런이 아닙니다", e.value.path);
      e.value.node.text = cmd.text;
      return ok(work);
    }

    case "setTitle": {
      const e = entryOf(ix, cmd.nodeId);
      if (!e.ok) return e;
      if (e.value.node.kind !== "article" && e.value.node.kind !== "document") return structure("조 명은 조에만, 제목은 문서에만 둘 수 있습니다", e.value.path);
      e.value.node.title = cmd.title;
      return ok(work);
    }

    case "setSlotRef": {
      const e = entryOf(ix, cmd.nodeId);
      if (!e.ok) return e;
      if (e.value.node.kind !== "slot") return structure("슬롯이 아닙니다", e.value.path);
      e.value.node.ref = cmd.ref;
      return ok(work);
    }

    case "setArticleRef":
    case "setAppendixRef":
    case "setClauseOptions": {
      const e = entryOf(ix, cmd.nodeId);
      if (!e.ok) return e;
      const n = e.value.node;
      if (cmd.type === "setArticleRef") {
        if (n.kind !== "articleRef") return structure("조 참조 슬롯이 아닙니다", e.value.path);
        n.articleId = cmd.articleId;
        n.scope = cmd.scope;
      } else if (cmd.type === "setAppendixRef") {
        if (n.kind !== "appendixRef") return structure("별표 참조 슬롯이 아닙니다", e.value.path);
        n.appendixCode = cmd.appendixCode;
      } else {
        if (n.kind !== "clauseBlockRef" && n.kind !== "clauseInlineRef") return structure("공용조항 참조가 아닙니다", e.value.path);
        n.options = { ...cmd.options };
      }
      const issues = checkNodeRefs(e.value, ix, env, false);
      return issues.length > 0 ? invalid(issues) : ok(work);
    }

    case "setFor": {
      const e = entryOf(ix, cmd.nodeId);
      if (!e.ok) return e;
      const n = e.value.node;
      if (n.kind !== "forBlock" && n.kind !== "inlineFor") return structure("반복 노드가 아닙니다", e.value.path);
      if (cmd.source !== undefined) n.source = cmd.source;
      if (cmd.alias !== undefined) n.alias = cmd.alias;
      if (cmd.separator !== undefined && n.kind === "inlineFor") n.separator = cmd.separator;
      return ok(work);
    }

    case "addBranch": {
      const e = entryOf(ix, cmd.condId);
      if (!e.ok) return e;
      const brs = branchesOf(e.value.node);
      if (!brs) return structure("조건 노드가 아닙니다", e.value.path);
      const branch = structuredClone(cmd.branch);
      brs.splice(clampIndex(cmd.index, brs.length), 0, branch as BlockBranch & InlineBranch);
      const rule = elseRule(brs, e.value.path);
      if (!rule.ok) return rule;
      const after = indexTree(work, env.coordinate);
      const ids = new Set<Id>([branch.id]);
      (branch.children as Node[]).forEach((c) => idsIn(c).forEach((id) => ids.add(id)));
      const issues = issuesTouching(after, ids);
      for (const child of branch.children as Node[]) issues.push(...refIssuesIn(after, child, env));
      return issues.length > 0 ? invalid(issues) : ok(work);
    }

    case "setWhen": {
      const b = ix.branches.get(cmd.branchId);
      if (!b) return notFound(`가지 ${cmd.branchId}`);
      if (cmd.when === undefined) delete b.branch.when;
      else b.branch.when = cmd.when;
      const owner = ix.nodes.get(b.ownerId)!;
      const rule = elseRule(branchesOf(owner.node)!, owner.path);
      return rule.ok ? ok(work) : rule;
    }

    case "removeBranch": {
      const b = ix.branches.get(cmd.branchId);
      if (!b) return notFound(`가지 ${cmd.branchId}`);
      const owner = ix.nodes.get(b.ownerId)!;
      const brs = branchesOf(owner.node)!;
      if (brs.length <= 1) return reject({ reason: "minimumStructure", what: "마지막 남은 조건 가지 — 조건 노드를 삭제하세요" });
      const removed = new Set<Id>([b.branch.id]);
      (b.branch.children as Node[]).forEach((c) => idsIn(c).forEach((id) => removed.add(id)));
      const dangling = danglingRefs(ix, removed, env);
      if (dangling.length > 0) return invalid(dangling);
      brs.splice(b.index, 1);
      return ok(work);
    }

    case "moveBranch": {
      const b = ix.branches.get(cmd.branchId);
      if (!b) return notFound(`가지 ${cmd.branchId}`);
      const owner = ix.nodes.get(b.ownerId)!;
      const brs = branchesOf(owner.node)!;
      brs.splice(b.index, 1);
      brs.splice(clampIndex(cmd.index, brs.length), 0, b.branch as BlockBranch & InlineBranch);
      const rule = elseRule(brs, owner.path);
      return rule.ok ? ok(work) : rule;
    }

    case "link": {
      const e = entryOf(ix, cmd.articleId);
      if (!e.ok) return e;
      if (e.value.node.kind !== "article") return structure("조연결은 조에만 둘 수 있습니다", e.value.path);
      if (cmd.linkedArticleId === undefined) delete e.value.node.linkedArticleId;
      else e.value.node.linkedArticleId = cmd.linkedArticleId;
      const issues = checkNodeRefs(e.value, ix, env, false);
      return issues.length > 0 ? invalid(issues) : ok(work);
    }
  }
}

function clampIndex(index: number | undefined, length: number): number {
  if (index === undefined) return length;
  return Math.max(0, Math.min(index, length));
}

/** 노드를 부모 목록에서 뗀다 (색인 기준). */
function detach(ix: TreeIndex, e: NodeEntry): void {
  const parentBranch = ix.branches.get(e.parentId!);
  const list = parentBranch ? (parentBranch.branch.children as Node[]) : listOf(ix.nodes.get(e.parentId!)!.node, e.slot)!;
  const i = list.indexOf(e.node);
  list.splice(i, 1);
}
