/**
 * 1단계 — 문맥 구성. 상품담보(탑재 스냅샷)마다 식 언어의 `EvalContext` 를 만든다.
 *
 * B1 `coverage/evalContext.ts`(담보 마스터 문맥)와 같은 방식이되 재료가 다르다:
 *   - 담보·세부보장·급부 레벨 = **스냅샷 값** (owner: 상품담보 · 스냅샷 노드). 값 참조는 자기 레벨 또는 조상에서,
 *     집계 범위는 하위 트리 (ADR-0007). 선택적 노출은 스냅샷 부착분에서만 값 자리가 있다.
 *   - 상품 레벨 = 상품 값. const = 정의값. 파생 = 그 레벨 문맥에서 식 평가 (오류면 미입력 자리로 보고 — B1 과 같은 규약).
 *   - 담보속성 = 상품담보의 조합 (쓰면 값, 아니면 unused — ADR-0015).
 *   - 세목(plan) 레벨은 MVP 조립 범위 밖 → 미결 (조립이 `structure` 오류로 바꾼다).
 * 보통약관 문맥 = 상품 레벨 + **기본계약 상품담보의 담보 레벨** (ADR-0011). 기본계약이 없으면 담보 레벨 참조는
 * 미결로 두고 조립이 `noBaseContract` 오류로 바꾼다 (`explainUndetermined`).
 *
 * 실행이 읽은 값 자리는 `ReadRecord` 로 남긴다 — 조립 문맥 조회(D-P6-7)·실행 기반 완결성 필터의 재료.
 */

import type { Discriminator, SlotPath } from "../catalog/types";
import { slotPath } from "../catalog/values";
import { isAttached } from "../coverage/attachment";
import { descendants, findNode, nodeName, nodesOf } from "../coverage/tree";
import type { Coverage, CoverageNode, CoverageNodeLevel } from "../coverage/types";
import type { EvalContext, LookupResult, ValueRef } from "../expression";
import { evaluate, parse } from "../expression";
import { type AttachLevel, type Code, type Coordinate, entered, type Id, type Issue, NOT_ENTERED, type Value, type ValueSlot } from "../types";
import type { AssemblyCoverage, AssemblyInput, AssemblyProduct, ContextTrace, ReadRecord } from "./types";

// ───────────────────────────── 계약 ─────────────────────────────

/** 조립이 쓰는 문맥 — EvalContext + 미결의 원인 설명 + 실행 추적. */
export interface AssemblyContext {
  eval: EvalContext;
  /** 미결(`undetermined`)을 조립 오류로 바꾼다 — 원인에 맞는 Issue kind (noBaseContract · structure · brokenRef). */
  explainUndetermined(reason: string, at: Coordinate): Issue;
  /** 이 문맥이 값을 읽는 상품담보 (보통약관 문맥이면 기본계약). 없으면 undefined. */
  trace?: ContextTrace;
}

export interface AssemblyContexts {
  general: AssemblyContext;
  /** 상품담보 id → 문맥. */
  specials: ReadonlyMap<Id, AssemblyContext>;
  /** 상품담보별 실행 추적 (읽은 값 자리). */
  traces: ContextTrace[];
}

// ───────────────────────────── 내부 환경 ─────────────────────────────

const DEPTH: Record<CoverageNodeLevel, number> = { coverage: 0, subCoverage: 1, benefit: 2 };

function isTreeLevel(level: AttachLevel): level is CoverageNodeLevel {
  return level in DEPTH;
}

const MISSING: LookupResult = { kind: "missing" };
const BROKEN: LookupResult = { kind: "missing", issue: "brokenRef" };
const UNDETERMINED: LookupResult = { kind: "undetermined" };

function slotOf(value: Value): LookupResult {
  return { kind: "slot", slot: entered(value) };
}

interface Env {
  product: AssemblyProduct;
  catalog: ReadonlyMap<Code, Discriminator>;
  /** 스냅샷을 담보 트리 모양으로 (id = 상품담보 id · 스냅샷 노드 id). 없으면 담보 레벨을 모른다 (기본계약 없는 보통약관). */
  tree?: Coverage;
  values: ReadonlyMap<Id, ReadonlyMap<SlotPath, ValueSlot>>;
  attached: ReadonlyMap<Id, ReadonlySet<Code>>;
  attributes: ReadonlyMap<Code, Code>;
  /** owner id → 값 소유자 종류·마스터 id (추적용). */
  owners: ReadonlyMap<Id, { kind: ReadRecord["owner"]["kind"]; masterId: Id }>;
  trace?: ContextTrace;
  /** 평가 중인 파생 코드 — 순환 가드. */
  evaluating: ReadonlySet<Code>;
}

const EMPTY_SLOTS: ReadonlyMap<SlotPath, ValueSlot> = new Map();
const EMPTY_CODES: ReadonlySet<Code> = new Set();

function record(env: Env, ownerId: Id, path: SlotPath, slot: ValueSlot | "missing"): void {
  const owner = env.owners.get(ownerId);
  if (!env.trace || !owner) return;
  const r = env.trace.reads;
  if (r.some((x) => x.owner.id === ownerId && x.path === path)) return;
  r.push({ owner: { kind: owner.kind, id: ownerId }, masterId: owner.masterId, path, slot });
}

/** 실체의 값 자리를 읽는다 (부착 검사 포함) — 읽은 자리를 추적에 남긴다. */
function readSlot(env: Env, ownerId: Id, def: Discriminator, path: SlotPath): LookupResult {
  const attached = env.attached.get(ownerId) ?? EMPTY_CODES;
  if (!isAttached(def, attached)) {
    record(env, ownerId, path, "missing");
    return MISSING;
  }
  const slot = (env.values.get(ownerId) ?? EMPTY_SLOTS).get(path) ?? NOT_ENTERED;
  record(env, ownerId, path, slot);
  return { kind: "slot", slot };
}

/** 자기 레벨이면 자기, 위 레벨이면 그 조상. 아래 레벨·트리 없음이면 undefined. */
function ancestorOrSelf(env: Env, node: CoverageNode | undefined, level: CoverageNodeLevel): CoverageNode | undefined {
  if (!env.tree || !node) return undefined;
  if (node.level === level) return node;
  const ref = node.ancestors.find((a) => a.level === level);
  return ref ? findNode(env.tree, ref) : undefined;
}

function lookupBuiltin(env: Env, node: CoverageNode | undefined, ref: ValueRef & { kind: "builtin" }): LookupResult {
  if (ref.prop !== "name") return BROKEN;
  if (ref.level === "product") return slotOf(env.product.name);
  if (!isTreeLevel(ref.level)) return UNDETERMINED;
  if (!env.tree) return UNDETERMINED; // 기본계약 없음
  const target = ancestorOrSelf(env, node, ref.level);
  return target ? slotOf(target.name) : MISSING;
}

function lookupDerived(env: Env, node: CoverageNode | undefined, def: Discriminator & { kind: "derived" }, coordinate: Coordinate): LookupResult {
  if (env.evaluating.has(def.code)) return BROKEN; // 순환 — 다단 파생은 MVP 밖
  const parsed = parse(def.expression);
  if (!parsed.ok) return BROKEN;
  const next: Env = { ...env, evaluating: new Set([...env.evaluating, def.code]) };
  let target: CoverageNode | undefined;
  if (def.level === "product") target = undefined;
  else if (!isTreeLevel(def.level)) return UNDETERMINED;
  else {
    if (!env.tree) return UNDETERMINED;
    target = ancestorOrSelf(env, node, def.level);
    if (!target) return MISSING;
  }
  const result = evaluate(parsed.value, contextFor(next, def.level === "product" ? node : target, coordinate));
  switch (result.kind) {
    case "value":
      return slotOf(result.value);
    case "undetermined":
      return UNDETERMINED;
    case "error":
      return { kind: "slot", slot: NOT_ENTERED }; // 파생 자리를 미입력으로 보고 (B1 규약)
  }
}

function lookupDiscriminator(env: Env, node: CoverageNode | undefined, ref: ValueRef & { kind: "discriminator" }, coordinate: Coordinate): LookupResult {
  const def = env.catalog.get(ref.code);
  if (!def) return BROKEN;
  switch (def.kind) {
    case "const":
      return ref.field === undefined ? slotOf(def.value) : BROKEN;
    case "derived":
      return ref.field === undefined ? lookupDerived(env, node, def, coordinate) : BROKEN;
    case "scalar":
      if (ref.field !== undefined) return BROKEN;
      break;
    case "struct":
      if (ref.field === undefined || !def.fields.some((f) => f.code === ref.field)) return BROKEN;
      break;
  }
  const path = slotPath(ref.code, ref.field);
  if (def.level === "product") return readSlot(env, env.product.id, def, path);
  if (!isTreeLevel(def.level)) return UNDETERMINED; // 세목 레벨 — P7
  if (!env.tree) return UNDETERMINED; // 기본계약 없음
  const target = ancestorOrSelf(env, node, def.level);
  if (!target) return MISSING;
  return readSlot(env, target.id, def, path);
}

/** 참조가 사는 레벨. const 는 레벨이 없다(undefined = 자기 자신). 없는 정의는 null. */
function levelOfRef(env: Env, ref: ValueRef): AttachLevel | undefined | null {
  if (ref.kind === "builtin") return ref.level;
  const def = env.catalog.get(ref.code);
  if (!def) return null;
  return def.kind === "const" ? undefined : def.level;
}

function contextFor(env: Env, node: CoverageNode | undefined, coordinate: Coordinate): EvalContext {
  return {
    coordinate,
    lookup: (ref) => (ref.kind === "builtin" ? lookupBuiltin(env, node, ref) : lookupDiscriminator(env, node, ref, coordinate)),
    attribute: (code) => {
      const value = env.attributes.get(code);
      return value === undefined ? { kind: "unused" } : { kind: "value", value };
    },
    children: (ref) => {
      const level = levelOfRef(env, ref);
      if (level === null || level === undefined || level === "product") return [contextFor(env, node, coordinate)];
      if (!isTreeLevel(level)) return undefined; // 세목 — P7
      if (!env.tree) return undefined; // 기본계약 없음
      if (!node) return undefined;
      if (DEPTH[level] < DEPTH[node.level]) {
        const up = ancestorOrSelf(env, node, level);
        return up ? [contextFor(env, up, coordinate)] : undefined;
      }
      return descendants(env.tree, node, level).map((n) => contextFor(env, n, coordinate));
    },
  };
}

/** 미결의 원인 — 참조 레벨로 가른다. */
function explain(env: Env, reason: string, at: Coordinate): Issue {
  const here = { ...at, refPath: reason };
  const level = levelOfPath(env, reason);
  if (level === "plan") {
    return { kind: "structure", message: `세목 레벨 참조 ${reason} 은(는) MVP 조립에서 해소하지 않습니다 (P7)`, at: here };
  }
  if (!env.tree && level !== undefined && isTreeLevel(level)) {
    return { kind: "noBaseContract", message: `기본계약이 지정되지 않아 담보 레벨 참조 ${reason} 을(를) 해소할 수 없습니다`, at: here };
  }
  return { kind: "brokenRef", message: `참조 ${reason} 을(를) 해소할 수 없습니다`, at: here };
}

/** 경로 문자열(refPath)의 레벨. `builtin.<레벨>.…` · `attr.…`(undefined) · 구분자 코드. */
function levelOfPath(env: Env, path: string): AttachLevel | undefined {
  if (path.startsWith("builtin.")) return path.split(".")[1] as AttachLevel;
  if (path.startsWith("attr.")) return undefined;
  const def = env.catalog.get(path.split(".")[0]);
  return def && def.kind !== "const" ? def.level : undefined;
}

// ───────────────────────────── 스냅샷 → 트리 ─────────────────────────────

/** 스냅샷 노드 트리를 B1 담보 트리 모양으로 — id 는 스냅샷 쪽(상품담보 id · 노드 id). */
export function snapshotTree(c: AssemblyCoverage): Coverage {
  const s = c.snapshot;
  return {
    id: s.id,
    name: s.coverageName,
    description: "",
    subCoverages: [...s.subCoverages]
      .sort((a, b) => a.order - b.order)
      .map((sub) => ({
        id: sub.id,
        name: sub.name,
        order: sub.order,
        benefits: [...sub.benefits].sort((a, b) => a.order - b.order).map((b) => ({ id: b.id, name: b.name, order: b.order })),
      })),
  };
}

function ownersOf(c: AssemblyCoverage, product: AssemblyProduct): Map<Id, { kind: ReadRecord["owner"]["kind"]; masterId: Id }> {
  const out = new Map<Id, { kind: ReadRecord["owner"]["kind"]; masterId: Id }>();
  out.set(product.id, { kind: "product", masterId: product.id });
  out.set(c.snapshot.id, { kind: "productCoverage", masterId: c.snapshot.coverageId });
  for (const sub of c.snapshot.subCoverages) {
    out.set(sub.id, { kind: "productSubCoverage", masterId: sub.masterNodeId });
    for (const b of sub.benefits) out.set(b.id, { kind: "productBenefit", masterId: b.masterNodeId });
  }
  return out;
}

// ───────────────────────────── 진입점 ─────────────────────────────

export function specialCoordinate(c: AssemblyCoverage): Coordinate {
  return { document: "special", ownerId: c.snapshot.id, ownerName: c.snapshot.name };
}

export function generalCoordinate(product: AssemblyProduct): Coordinate {
  return { document: "general", ownerId: product.generalDocumentId ?? product.general?.id ?? product.id, ownerName: product.general?.title ?? product.name };
}

function envOf(input: AssemblyInput, catalog: ReadonlyMap<Code, Discriminator>, c: AssemblyCoverage | undefined, trace: ContextTrace | undefined): Env {
  const product = input.product;
  const values = new Map<Id, ReadonlyMap<SlotPath, ValueSlot>>(c ? c.values : []);
  values.set(product.id, product.values);
  const attached = new Map<Id, ReadonlySet<Code>>(c ? c.attached : []);
  attached.set(product.id, product.attached);
  return {
    product,
    catalog,
    tree: c ? snapshotTree(c) : undefined,
    values,
    attached,
    attributes: new Map(c ? c.snapshot.attributes.map((a) => [a.kindCode, a.valueCode]) : []),
    owners: c ? ownersOf(c, product) : new Map([[product.id, { kind: "product" as const, masterId: product.id }]]),
    trace,
    evaluating: new Set(),
  };
}

function contextOf(env: Env, coordinate: Coordinate): AssemblyContext {
  const root = env.tree ? nodesOf(env.tree)[0] : undefined;
  return {
    eval: contextFor(env, root, coordinate),
    explainUndetermined: (reason, at) => explain(env, reason, at),
    trace: env.trace,
  };
}

/** 상품담보 하나의 문맥 (좌표 = 그 특약). */
export function specialContext(input: AssemblyInput, c: AssemblyCoverage, trace?: ContextTrace): AssemblyContext {
  const catalog = new Map(input.catalog.map((d) => [d.code, d]));
  return contextOf(envOf(input, catalog, c, trace), specialCoordinate(c));
}

/** 임의 스냅샷 노드의 문맥 — 반복문 본문용(P7). 트리에 없으면 undefined. */
export function snapshotNodeContext(input: AssemblyInput, c: AssemblyCoverage, nodeId: Id): EvalContext | undefined {
  const catalog = new Map(input.catalog.map((d) => [d.code, d]));
  const env = envOf(input, catalog, c, undefined);
  const node = env.tree ? nodesOf(env.tree).find((n) => n.id === nodeId) : undefined;
  return node ? contextFor(env, node, { ...specialCoordinate(c), ownerName: nodeName(env.tree!, node) }) : undefined;
}

/** 전 상품담보 + 보통약관 문맥. 보통약관은 기본계약 상품담보의 환경을 좌표만 바꿔 쓴다 (읽은 값은 기본계약 추적에 실린다). */
export function buildContexts(input: AssemblyInput): AssemblyContexts {
  const catalog = new Map(input.catalog.map((d) => [d.code, d]));
  const specials = new Map<Id, AssemblyContext>();
  const traces: ContextTrace[] = [];
  const envs = new Map<Id, Env>();
  for (const c of input.coverages) {
    const trace: ContextTrace = { productCoverageId: c.snapshot.id, productCoverageName: c.snapshot.name, coverageId: c.snapshot.coverageId, reads: [] };
    traces.push(trace);
    const env = envOf(input, catalog, c, trace);
    envs.set(c.snapshot.id, env);
    specials.set(c.snapshot.id, contextOf(env, specialCoordinate(c)));
  }
  const base = input.product.baseContractId !== undefined ? envs.get(input.product.baseContractId) : undefined;
  const general = contextOf(base ?? envOf(input, catalog, undefined, undefined), generalCoordinate(input.product));
  return { general, specials, traces };
}
