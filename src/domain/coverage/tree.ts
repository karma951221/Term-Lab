/**
 * 담보 트리 편집 규칙 (순수) — 담보_기획 「트리 편집 규칙」 · 담보트리_시나리오 S1~S5.
 *
 * - 최소 구조 강제: 담보는 세부보장 1 이상, 세부보장은 급부 1 이상. 생성이 원자적이라(D-P2-1)
 *   하한이 깨진 트리는 저장소에 한 번도 존재하지 않는다. 마지막 하위 삭제는 `minimumStructure` 거부.
 * - 형제 간 이름 중복 금지. 담보명은 마스터 전역 (D-P2-2).
 * - 순서는 데이터 — 형제 배열 순서가 곧 order. 변경은 전체 id 를 새 순서로 (reorder*).
 * - 모든 함수는 원본을 바꾸지 않고 새 트리를 돌려준다. 값 행·부착의 연쇄 처리는 서비스 몫.
 */
import { type Id, type Issue, ok, reject, type Result } from "../types";
import type {
  Benefit,
  Coverage,
  CoverageNode,
  CoverageNodeLevel,
  CoverageNodeRef,
  NewCoverage,
  NewId,
  NewSubCoverage,
  SubCoverage,
} from "./types";

// ───────────────────────────── 공통 ─────────────────────────────

function invalid<T>(message: string): Result<T> {
  const issue: Issue = { kind: "typeMismatch", message, at: {} };
  return reject({ reason: "invalid", issues: [issue] });
}

function notFound<T>(what: string): Result<T> {
  return reject({ reason: "notFound", what });
}

function checkName(name: unknown, what: string): Result<string> {
  if (typeof name !== "string" || name.trim().length === 0) return invalid(`${what}은(는) 비울 수 없습니다`);
  return ok(name.trim());
}

/** 형제 이름 중복 — `selfId` 는 제외 (이름 변경 시 자기 자신). */
function siblingDuplicate<T>(
  siblings: readonly { id: Id; name: string }[],
  name: string,
  what: string,
  selfId?: Id,
): Result<T> | undefined {
  return siblings.some((s) => s.id !== selfId && s.name === name)
    ? reject({ reason: "duplicate", what: `${what} 「${name}」` })
    : undefined;
}

function renumber<T extends { order: number }>(items: readonly T[]): T[] {
  return items.map((x, i) => ({ ...x, order: i }));
}

// ───────────────────────────── 조회 ─────────────────────────────

export function findSubCoverage(tree: Coverage, subCoverageId: Id): SubCoverage | undefined {
  return tree.subCoverages.find((s) => s.id === subCoverageId);
}

export function findBenefit(
  tree: Coverage,
  benefitId: Id,
): { subCoverage: SubCoverage; benefit: Benefit } | undefined {
  for (const subCoverage of tree.subCoverages) {
    const benefit = subCoverage.benefits.find((b) => b.id === benefitId);
    if (benefit) return { subCoverage, benefit };
  }
  return undefined;
}

/** 담보·세부보장·급부 전 노드 — 깊이 우선, 형제 순서대로. */
export function nodesOf(tree: Coverage): CoverageNode[] {
  const root: CoverageNodeRef = { level: "coverage", id: tree.id };
  const out: CoverageNode[] = [{ ...root, name: tree.name, ancestors: [] }];
  for (const s of tree.subCoverages) {
    const subRef: CoverageNodeRef = { level: "subCoverage", id: s.id };
    out.push({ ...subRef, name: s.name, ancestors: [root] });
    for (const b of s.benefits) {
      out.push({ level: "benefit", id: b.id, name: b.name, ancestors: [root, subRef] });
    }
  }
  return out;
}

export function findNode(tree: Coverage, ref: CoverageNodeRef): CoverageNode | undefined {
  return nodesOf(tree).find((n) => n.level === ref.level && n.id === ref.id);
}

/** 사람이 읽을 노드 이름 — `담보 > 세부보장 > 급부`. */
export function nodeName(tree: Coverage, ref: CoverageNodeRef): string | undefined {
  const node = findNode(tree, ref);
  if (!node) return undefined;
  const names = node.ancestors.map((a) => findNode(tree, a)?.name ?? a.id);
  return [...names, node.name].join(" > ");
}

const LEVEL_DEPTH: Record<CoverageNodeLevel, number> = { coverage: 0, subCoverage: 1, benefit: 2 };

function isUnderOrSelf(node: CoverageNode, from: CoverageNodeRef): boolean {
  if (node.level === from.level && node.id === from.id) return true;
  return node.ancestors.some((a) => a.level === from.level && a.id === from.id);
}

/**
 * 「레벨 X 의 후손 실체 목록」 — 파생 집계 범위(ADR-0007 부착점 하위 트리)·반복 순회의 정본.
 * 자기 레벨을 물으면 [자기 자신], 위 레벨을 물으면 [] (후손이 아니다). 순서는 트리 순서.
 */
export function descendants(tree: Coverage, from: CoverageNodeRef, level: CoverageNodeLevel): CoverageNode[] {
  if (LEVEL_DEPTH[level] < LEVEL_DEPTH[from.level]) return [];
  return nodesOf(tree).filter((n) => n.level === level && isUnderOrSelf(n, from));
}

/** 노드를 지우면 함께 사라지는 하위 실체의 이름 (Impact.cascade). 자기 자신은 제외. */
export function cascadeNames(tree: Coverage, ref: CoverageNodeRef): string[] {
  const label: Record<CoverageNodeLevel, string> = { coverage: "담보", subCoverage: "세부보장", benefit: "급부" };
  return nodesOf(tree)
    .filter((n) => !(n.level === ref.level && n.id === ref.id) && isUnderOrSelf(n, ref))
    .map((n) => `${label[n.level]} ${n.name}`);
}

// ───────────────────────────── 생성 ─────────────────────────────

function newBenefit(name: string, order: number, newId: NewId): Benefit {
  return { id: newId(), name, order };
}

function newSubCoverage(input: NewSubCoverage, order: number, newId: NewId): SubCoverage {
  return {
    id: newId(),
    name: input.name,
    order,
    benefits: [newBenefit(input.benefitName ?? input.name, 0, newId)],
  };
}

/**
 * 담보 생성 — 세부보장 1·급부 1 을 함께 만든다 (D-P2-1). `existingNames` 는 마스터의 담보명 전부.
 */
export function createCoverageTree(
  input: NewCoverage,
  newId: NewId,
  existingNames: readonly string[],
): Result<Coverage> {
  const name = checkName(input.name, "담보명");
  if (!name.ok) return name as Result<Coverage>;
  if (existingNames.includes(name.value)) return reject({ reason: "duplicate", what: `담보명 「${name.value}」` });

  const subName = checkName(input.subCoverageName ?? name.value, "세부보장명");
  if (!subName.ok) return subName as Result<Coverage>;
  const benefitName = checkName(input.benefitName ?? name.value, "급부명");
  if (!benefitName.ok) return benefitName as Result<Coverage>;

  return ok({
    id: newId(),
    name: name.value,
    description: input.description ?? "",
    subCoverages: [newSubCoverage({ name: subName.value, benefitName: benefitName.value }, 0, newId)],
  });
}

/** 세부보장 추가 — 급부 1 을 함께 만들고 형제 맨 뒤에 붙는다. 비파괴. */
export function addSubCoverage(tree: Coverage, input: NewSubCoverage, newId: NewId): Result<Coverage> {
  const name = checkName(input.name, "세부보장명");
  if (!name.ok) return name as Result<Coverage>;
  const dup = siblingDuplicate<Coverage>(tree.subCoverages, name.value, "세부보장명");
  if (dup) return dup;
  const benefitName = checkName(input.benefitName ?? name.value, "급부명");
  if (!benefitName.ok) return benefitName as Result<Coverage>;
  const sub = newSubCoverage({ name: name.value, benefitName: benefitName.value }, tree.subCoverages.length, newId);
  return ok({ ...tree, subCoverages: [...tree.subCoverages, sub] });
}

/** 급부 추가 — 세부보장의 형제 맨 뒤. 비파괴. */
export function addBenefit(tree: Coverage, subCoverageId: Id, benefitName: string, newId: NewId): Result<Coverage> {
  const sub = findSubCoverage(tree, subCoverageId);
  if (!sub) return notFound(`세부보장 ${subCoverageId}`);
  const name = checkName(benefitName, "급부명");
  if (!name.ok) return name as Result<Coverage>;
  const dup = siblingDuplicate<Coverage>(sub.benefits, name.value, "급부명");
  if (dup) return dup;
  const next: SubCoverage = { ...sub, benefits: [...sub.benefits, newBenefit(name.value, sub.benefits.length, newId)] };
  return ok(replaceSubCoverage(tree, next));
}

function replaceSubCoverage(tree: Coverage, next: SubCoverage): Coverage {
  return { ...tree, subCoverages: tree.subCoverages.map((s) => (s.id === next.id ? next : s)) };
}

// ───────────────────────────── 이름 · 설명 (뼈대 속성 — 비파괴) ─────────────────────────────

/** 담보명 변경 — 탑재분이 있어도 허용 (D-P2-3). `existingNames` 는 자기 이름을 포함해도 된다. */
export function renameCoverage(tree: Coverage, name: string, existingNames: readonly string[]): Result<Coverage> {
  const checked = checkName(name, "담보명");
  if (!checked.ok) return checked as Result<Coverage>;
  if (checked.value !== tree.name && existingNames.includes(checked.value)) {
    return reject({ reason: "duplicate", what: `담보명 「${checked.value}」` });
  }
  return ok({ ...tree, name: checked.value });
}

export function setCoverageDescription(tree: Coverage, description: string): Result<Coverage> {
  return ok({ ...tree, description });
}

/** 문면 문서 연결 자리 — 문서 자체는 B3 소유. undefined 면 연결 해제. */
export function setCoverageDocument(tree: Coverage, documentId: Id | undefined): Result<Coverage> {
  const { documentId: _dropped, ...rest } = tree;
  void _dropped;
  return ok(documentId === undefined ? rest : { ...rest, documentId });
}

export function renameSubCoverage(tree: Coverage, subCoverageId: Id, name: string): Result<Coverage> {
  const sub = findSubCoverage(tree, subCoverageId);
  if (!sub) return notFound(`세부보장 ${subCoverageId}`);
  const checked = checkName(name, "세부보장명");
  if (!checked.ok) return checked as Result<Coverage>;
  const dup = siblingDuplicate<Coverage>(tree.subCoverages, checked.value, "세부보장명", sub.id);
  if (dup) return dup;
  return ok(replaceSubCoverage(tree, { ...sub, name: checked.value }));
}

export function renameBenefit(tree: Coverage, subCoverageId: Id, benefitId: Id, name: string): Result<Coverage> {
  const sub = findSubCoverage(tree, subCoverageId);
  if (!sub) return notFound(`세부보장 ${subCoverageId}`);
  const benefit = sub.benefits.find((b) => b.id === benefitId);
  if (!benefit) return notFound(`급부 ${benefitId}`);
  const checked = checkName(name, "급부명");
  if (!checked.ok) return checked as Result<Coverage>;
  const dup = siblingDuplicate<Coverage>(sub.benefits, checked.value, "급부명", benefit.id);
  if (dup) return dup;
  return ok(
    replaceSubCoverage(tree, {
      ...sub,
      benefits: sub.benefits.map((b) => (b.id === benefitId ? { ...b, name: checked.value } : b)),
    }),
  );
}

// ───────────────────────────── 순서 ─────────────────────────────

function reorder<T extends { id: Id; order: number }>(items: readonly T[], order: readonly Id[], what: string): Result<T[]> {
  const have = items.map((x) => x.id).sort();
  const want = [...order].sort();
  if (have.length !== want.length || have.some((id, i) => id !== want[i])) {
    return invalid(`${what} 순서에는 모든 형제 id 가 한 번씩 있어야 합니다`);
  }
  const byId = new Map(items.map((x) => [x.id, x]));
  return ok(renumber(order.map((id) => byId.get(id)!)));
}

/** 세부보장 순서 변경 — 전체 id 를 새 순서로. 문면 수록·반복 순회 순서가 그대로 따라간다. */
export function reorderSubCoverages(tree: Coverage, order: readonly Id[]): Result<Coverage> {
  const r = reorder(tree.subCoverages, order, "세부보장");
  if (!r.ok) return r as Result<Coverage>;
  return ok({ ...tree, subCoverages: r.value });
}

export function reorderBenefits(tree: Coverage, subCoverageId: Id, order: readonly Id[]): Result<Coverage> {
  const sub = findSubCoverage(tree, subCoverageId);
  if (!sub) return notFound(`세부보장 ${subCoverageId}`);
  const r = reorder(sub.benefits, order, "급부");
  if (!r.ok) return r as Result<Coverage>;
  return ok(replaceSubCoverage(tree, { ...sub, benefits: r.value }));
}

// ───────────────────────────── 삭제 (트리 쪽 결과 — 파괴적 처리는 서비스) ─────────────────────────────

/** 세부보장 삭제 — 마지막 세부보장이면 `minimumStructure`. 남은 형제의 order 를 다시 매긴다. */
export function removeSubCoverage(tree: Coverage, subCoverageId: Id): Result<Coverage> {
  const sub = findSubCoverage(tree, subCoverageId);
  if (!sub) return notFound(`세부보장 ${subCoverageId}`);
  if (tree.subCoverages.length <= 1) {
    return reject({ reason: "minimumStructure", what: `담보 「${tree.name}」의 마지막 세부보장` });
  }
  return ok({ ...tree, subCoverages: renumber(tree.subCoverages.filter((s) => s.id !== subCoverageId)) });
}

/** 급부 삭제 — 세부보장의 마지막 급부면 `minimumStructure`. */
export function removeBenefit(tree: Coverage, subCoverageId: Id, benefitId: Id): Result<Coverage> {
  const sub = findSubCoverage(tree, subCoverageId);
  if (!sub) return notFound(`세부보장 ${subCoverageId}`);
  if (!sub.benefits.some((b) => b.id === benefitId)) return notFound(`급부 ${benefitId}`);
  if (sub.benefits.length <= 1) {
    return reject({ reason: "minimumStructure", what: `세부보장 「${sub.name}」의 마지막 급부` });
  }
  return ok(replaceSubCoverage(tree, { ...sub, benefits: renumber(sub.benefits.filter((b) => b.id !== benefitId)) }));
}

/** 노드 삭제의 트리 쪽 결과 — 지시자로 분기. 담보 자체 삭제는 트리가 없어지므로 여기 없다. */
export function removeNode(tree: Coverage, ref: CoverageNodeRef): Result<Coverage> {
  switch (ref.level) {
    case "coverage":
      return invalid("담보 자체의 삭제는 트리 편집이 아닙니다");
    case "subCoverage":
      return removeSubCoverage(tree, ref.id);
    case "benefit": {
      const hit = findBenefit(tree, ref.id);
      if (!hit) return notFound(`급부 ${ref.id}`);
      return removeBenefit(tree, hit.subCoverage.id, ref.id);
    }
  }
}
