/**
 * 탑재 규칙 (ADR-0002 · ADR-0015 · 담보속성탑재 S2·S4) — 순수.
 *
 * - 상품담보 = 담보 × 담보속성 값 조합. 조합 키가 유일성의 근거 — 같은 상품 안 중복 탑재 거부.
 * - 선택은 sparse — 사용한 종류만. 종류 order 순으로 정규화해 저장한다.
 * - 스냅샷 구조: 마스터 세부보장·급부 ↔ 스냅샷 노드 대응. `diffStructure` 가 트리와 노드를 대조해
 *   추가(빈 값)·삭제(값 행 연쇄)·이름/순서 갱신 목록을 낸다 (도메인모델 §5 구조 변경 규칙).
 */
import type { Code, Id, Issue } from "../types";
import type { AttributeKind, AttributeSelection, CoverageTree, SnapshotNode } from "./types";

// ───────────────────────────── 조합 ─────────────────────────────

/** 종류 order(없으면 코드) 순으로 정렬한 사본. */
export function normalizeSelections(selections: readonly AttributeSelection[], kinds: readonly AttributeKind[]): AttributeSelection[] {
  const orderOf = new Map(kinds.map((k) => [k.code, k.order]));
  return [...selections]
    .map((s) => ({ kindCode: s.kindCode, valueCode: s.valueCode }))
    .sort((a, b) => {
      const oa = orderOf.get(a.kindCode);
      const ob = orderOf.get(b.kindCode);
      if (oa !== undefined && ob !== undefined && oa !== ob) return oa - ob;
      if (oa === undefined && ob !== undefined) return 1;
      if (oa !== undefined && ob === undefined) return -1;
      return a.kindCode.localeCompare(b.kindCode);
    });
}

/** 유일성 키 — `담보id|A0001=V02,A0002=V01` (종류 코드 순, 순서 무관). */
export function combinationKey(coverageId: Id, selections: readonly AttributeSelection[]): string {
  const parts = [...selections].map((s) => `${s.kindCode}=${s.valueCode}`).sort();
  return `${coverageId}|${parts.join(",")}`;
}

/** 선택 검증 — 종류·값이 카탈로그에 있고, 같은 종류를 두 번 고르지 않았는가. */
export function validateSelections(selections: readonly AttributeSelection[], kinds: readonly AttributeKind[]): Issue[] {
  const issues: Issue[] = [];
  const seen = new Set<Code>();
  for (const s of selections) {
    if (seen.has(s.kindCode)) {
      issues.push({ kind: "typeMismatch", message: `담보속성 종류 ${s.kindCode} 을(를) 두 번 골랐습니다`, at: { refPath: s.kindCode } });
      continue;
    }
    seen.add(s.kindCode);
    const kind = kinds.find((k) => k.code === s.kindCode);
    if (!kind) {
      issues.push({ kind: "brokenRef", message: `담보속성 종류 ${s.kindCode} 이(가) 없습니다`, at: { refPath: s.kindCode } });
      continue;
    }
    if (!kind.values.some((v) => v.code === s.valueCode)) {
      issues.push({ kind: "brokenRef", message: `담보속성 ${kind.label}(${kind.code}) 에 유효값 ${s.valueCode} 이(가) 없습니다`, at: { refPath: `${s.kindCode}.${s.valueCode}` } });
    }
  }
  return issues;
}

// ───────────────────────────── 스냅샷 구조 대조 ─────────────────────────────

/** 추가할 스냅샷 노드 — 급부는 부모 **마스터** id 로 표기 (스냅샷 부모 id 는 저장 시 대응표로 푼다). */
export interface NodeToAdd {
  kind: "sub" | "benefit";
  masterNodeId: Id;
  parentMasterId?: Id;
  name: string;
  order: number;
}

export interface StructureDiff {
  /** 트리 순서(세부보장 → 그 급부들) 로. */
  add: NodeToAdd[];
  /** 마스터에서 사라진 노드 (값 행 연쇄 삭제 대상). */
  remove: SnapshotNode[];
  /** 이름·순서가 달라진 노드. */
  update: { id: Id; name: string; order: number }[];
}

export function diffStructure(tree: CoverageTree, nodes: readonly SnapshotNode[]): StructureDiff {
  const byMaster = new Map(nodes.map((n) => [n.masterNodeId, n]));
  const seen = new Set<Id>();
  const add: NodeToAdd[] = [];
  const update: StructureDiff["update"] = [];

  const visit = (kind: "sub" | "benefit", id: Id, name: string, order: number, parentMasterId?: Id) => {
    seen.add(id);
    const existing = byMaster.get(id);
    if (!existing) add.push({ kind, masterNodeId: id, parentMasterId, name, order });
    else if (existing.name !== name || existing.order !== order) update.push({ id: existing.id, name, order });
  };

  for (const sub of tree.subCoverages) {
    visit("sub", sub.id, sub.name, sub.order);
    for (const b of sub.benefits) visit("benefit", b.id, b.name, b.order, sub.id);
  }
  const remove = nodes.filter((n) => !seen.has(n.masterNodeId));
  return { add, remove, update };
}
