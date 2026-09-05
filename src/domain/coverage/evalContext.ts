/**
 * 담보 마스터 평가 문맥 — 담보 트리 + 마스터 값으로 식 언어의 `EvalContext` 를 만든다.
 *
 * 쓰는 곳: B3 문면 사전평가(담보약관 편집 화면의 톤다운·미결), C2 조립(상품 문맥이 이 위에 담보속성·상품 값을 얹는다),
 * 완결성 조회의 실행 기반 필터.
 *
 * 규칙 (ADR-0007 · ADR-0011 · ADR-0013 · 담보_기획 「이름의 정체」):
 * - 값 참조는 **자기 레벨 또는 조상**에서 읽는다 (급부 문맥이 담보 값을 읽는 것은 자연스럽다).
 *   아래 레벨 자리를 집계 없이 직접 읽으면 값 자리 없음(notAttached).
 * - 집계 범위 = 이 노드의 하위 트리 (`descendants`). 자기 레벨이면 [자기], 위 레벨이면 [그 조상].
 * - 내장 경로 `builtin.<레벨>.name` = 뼈대 이름.
 * - const = 정의의 값. 파생 = 그 레벨 문맥에서 식을 평가한 값 — 입력 미입력 등으로 오류가 나면
 *   파생 자리 자체를 「미입력」으로 보고한다 (LookupResult 에 오류 변형이 없다 — 좌표는 파생 경로).
 * - 담보속성(attr) · 상품/세목 레벨 참조는 마스터 문맥에서 **미결(undetermined)** — 조립 때 결정.
 * - 선택적 노출 구분자는 부착된 실체에서만 값 자리가 있다.
 */
import type { Discriminator } from "../catalog";
import { slotPath } from "../catalog";
import type { EvalContext, LookupResult, ValueRef } from "../expression";
import { evaluate, parse } from "../expression";
import { type AttachLevel, type Code, entered, NOT_ENTERED, type Value } from "../types";
import { isAttached } from "./attachment";
import { descendants, findNode, nodeName, nodesOf } from "./tree";
import type { Coverage, CoverageNode, CoverageNodeLevel, CoverageNodeRef } from "./types";
import { attachedOfNode, slotsOfNode, type MasterValues } from "./values";

/** 카탈로그 조회 — 문맥이 정의를 찾는 창구. */
export interface MasterCatalog {
  find(code: Code): Discriminator | undefined;
}

export function masterCatalog(defs: readonly Discriminator[]): MasterCatalog {
  const byCode = new Map(defs.map((d) => [d.code, d]));
  return { find: (code) => byCode.get(code) };
}

const DEPTH: Record<CoverageNodeLevel, number> = { coverage: 0, subCoverage: 1, benefit: 2 };

function isTreeLevel(level: AttachLevel): level is CoverageNodeLevel {
  return level in DEPTH;
}

const MISSING: LookupResult = { kind: "missing" };
const BROKEN: LookupResult = { kind: "missing", issue: "brokenRef" };
const UNDETERMINED: LookupResult = { kind: "undetermined" };

interface Env {
  tree: Coverage;
  values: MasterValues;
  catalog: MasterCatalog;
  /** 평가 중인 파생 코드 — 순환 가드 */
  evaluating: Set<Code>;
}

/** 자기 레벨이면 자기, 위 레벨이면 그 조상. 아래 레벨이면 undefined. */
function ancestorOrSelf(env: Env, node: CoverageNode, level: CoverageNodeLevel): CoverageNode | undefined {
  if (node.level === level) return node;
  const ref = node.ancestors.find((a) => a.level === level);
  return ref ? findNode(env.tree, ref) : undefined;
}

function slotOf(value: Value): LookupResult {
  return { kind: "slot", slot: entered(value) };
}

function lookupBuiltin(env: Env, node: CoverageNode, ref: ValueRef & { kind: "builtin" }): LookupResult {
  if (!isTreeLevel(ref.level)) return UNDETERMINED;
  if (ref.prop !== "name") return BROKEN;
  const target = ancestorOrSelf(env, node, ref.level);
  return target ? slotOf(target.name) : MISSING;
}

function lookupDerived(env: Env, node: CoverageNode, def: Discriminator & { kind: "derived" }): LookupResult {
  if (!isTreeLevel(def.level)) return UNDETERMINED;
  const target = ancestorOrSelf(env, node, def.level);
  if (!target) return MISSING;
  if (env.evaluating.has(def.code)) return BROKEN; // 순환 — 다단 파생은 MVP 밖
  const parsed = parse(def.expression);
  if (!parsed.ok) return BROKEN;
  const next: Env = { ...env, evaluating: new Set([...env.evaluating, def.code]) };
  const result = evaluate(parsed.value, contextFor(next, target));
  switch (result.kind) {
    case "value":
      return slotOf(result.value);
    case "undetermined":
      return UNDETERMINED;
    case "error":
      return { kind: "slot", slot: NOT_ENTERED };
  }
}

function lookupDiscriminator(env: Env, node: CoverageNode, ref: ValueRef & { kind: "discriminator" }): LookupResult {
  const def = env.catalog.find(ref.code);
  if (!def) return BROKEN;
  switch (def.kind) {
    case "const":
      return ref.field === undefined ? slotOf(def.value) : BROKEN;
    case "derived":
      return ref.field === undefined ? lookupDerived(env, node, def) : BROKEN;
    case "scalar":
      if (ref.field !== undefined) return BROKEN;
      break;
    case "struct":
      if (ref.field === undefined || !def.fields.some((f) => f.code === ref.field)) return BROKEN;
      break;
  }
  if (!isTreeLevel(def.level)) return UNDETERMINED;
  const target = ancestorOrSelf(env, node, def.level);
  if (!target) return MISSING;
  if (!isAttached(def, attachedOfNode(env.values, target.id))) return MISSING;
  const slot = slotsOfNode(env.values, target.id).get(slotPath(ref.code, ref.field));
  return { kind: "slot", slot: slot ?? NOT_ENTERED };
}

/** 참조가 사는 레벨. const 는 레벨이 없다(undefined = 자기 자신). 없는 정의는 null. */
function levelOfRef(env: Env, ref: ValueRef): AttachLevel | undefined | null {
  if (ref.kind === "builtin") return ref.level;
  const def = env.catalog.find(ref.code);
  if (!def) return null;
  return def.kind === "const" ? undefined : def.level;
}

function contextFor(env: Env, node: CoverageNode): EvalContext {
  return {
    coordinate: { document: "coverageMaster", ownerId: env.tree.id, ownerName: nodeName(env.tree, node) ?? node.name },
    lookup: (ref) => (ref.kind === "builtin" ? lookupBuiltin(env, node, ref) : lookupDiscriminator(env, node, ref)),
    attribute: () => ({ kind: "undetermined" }),
    children: (ref) => {
      const level = levelOfRef(env, ref);
      if (level === null) return [contextFor(env, node)]; // 없는 정의 — lookup 이 brokenRef 를 낸다
      if (level === undefined) return [contextFor(env, node)];
      if (!isTreeLevel(level)) return undefined;
      if (DEPTH[level] < DEPTH[node.level]) {
        const up = ancestorOrSelf(env, node, level);
        return up ? [contextFor(env, up)] : undefined;
      }
      return descendants(env.tree, node, level).map((n) => contextFor(env, n));
    },
  };
}

/** 담보 노드의 문맥 — 담보약관 사전평가의 기본 문맥. */
export function masterEvalContext(tree: Coverage, values: MasterValues, catalog: MasterCatalog): EvalContext {
  const root = nodesOf(tree)[0];
  return contextFor({ tree, values, catalog, evaluating: new Set() }, root);
}

/** 임의 노드(세부보장·급부)의 문맥 — 반복문 본문·세부보장 단위 조건식용. 트리에 없으면 undefined. */
export function nodeEvalContext(
  tree: Coverage,
  node: CoverageNodeRef,
  values: MasterValues,
  catalog: MasterCatalog,
): EvalContext | undefined {
  const found = findNode(tree, node);
  return found ? contextFor({ tree, values, catalog, evaluating: new Set() }, found) : undefined;
}
