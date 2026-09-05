/**
 * 담보 레벨 값 규칙 (순수) — 값 쓰기 검사 · 폼 프리필 · 완결성 조회.
 *
 * - 값 자리는 부착이 만든다: 정의가 실체 레벨에 부착돼 있어야 그 경로에 쓸 수 있다 (notAttached).
 * - 검증은 catalog `validateValue`. 파생·const 에는 직접 입력이 없다.
 * - 기본값은 `formPrefill` 로만 돌려준다 — 저장소로 자동 유입되는 경로는 없다 (ADR-0004).
 * - 완결성 조회 = 담보 하위 트리 전체(담보·세부보장·급부)의 **부착된** 자리 중 미입력 (D-P2-11).
 *   「실행 기반(실제 타는 분기)」 필터는 조립·문면이 있어야 하므로 `CompletenessFilter` 로 주입한다 (C2).
 */
import type { Discriminator, SlotPath, ValuedDiscriminator } from "../catalog";
import { isValued, missingSlots, prefill, validateValue, valueSlotsOf } from "../catalog";
import type { EnumLookup } from "../catalog";
import { type Code, type Coordinate, type Id, ok, reject, type Result, type Value, type ValueSlot } from "../types";
import type { AttachedCodes } from "./attachment";
import { attachedDefinitions, isAttached } from "./attachment";
import { nodeName, nodesOf } from "./tree";
import type { Coverage, CoverageNodeRef } from "./types";

// ───────────────────────────── 마스터 값 묶음 ─────────────────────────────

/** 담보 하위 트리의 값·부착 상태 — 키는 노드 id (uuid 라 레벨 간 충돌 없음). 없는 노드 = 값 없음·부착 없음. */
export interface MasterValues {
  slots: ReadonlyMap<Id, ReadonlyMap<SlotPath, ValueSlot>>;
  attached: ReadonlyMap<Id, AttachedCodes>;
}

const EMPTY_SLOTS: ReadonlyMap<SlotPath, ValueSlot> = new Map();
const EMPTY_CODES: AttachedCodes = new Set();

export function slotsOfNode(values: MasterValues, nodeId: Id): ReadonlyMap<SlotPath, ValueSlot> {
  return values.slots.get(nodeId) ?? EMPTY_SLOTS;
}

export function attachedOfNode(values: MasterValues, nodeId: Id): AttachedCodes {
  return values.attached.get(nodeId) ?? EMPTY_CODES;
}

// ───────────────────────────── 값 쓰기 검사 ─────────────────────────────

/**
 * 값 쓰기 전 검사. 통과하면 (정의, 필드코드) 를 돌려준다 — 저장소 writeSlot 의 인자.
 * 실체 레벨·부착 여부·경로·타입 순으로 본다.
 */
export function checkValueWrite(
  def: Discriminator,
  path: SlotPath,
  value: Value,
  owner: CoverageNodeRef,
  attached: AttachedCodes,
  enums: EnumLookup,
): Result<{ def: ValuedDiscriminator; fieldCode: Code | undefined }> {
  const at: Coordinate = { document: "coverageMaster", ownerId: owner.id, refPath: path };
  if (!isValued(def)) {
    return reject({
      reason: "invalid",
      issues: [{ kind: "typeMismatch", message: `${def.label}(${def.code}) 은(는) ${def.kind} 구분자라 직접 입력할 수 없습니다`, at }],
    });
  }
  if (def.level !== owner.level || !isAttached(def, attached)) {
    return reject({
      reason: "invalid",
      issues: [{ kind: "notAttached", message: `${def.label}(${def.code}) 이(가) 이 실체에 부착돼 있지 않아 값 자리가 없습니다`, at }],
    });
  }
  if (!valueSlotsOf(def).includes(path)) return reject({ reason: "notFound", what: `값 자리 ${path}` });
  const [, fieldCode] = path.split(".");
  const type = def.kind === "scalar" ? def.type : def.fields.find((f) => f.code === fieldCode)!.type;
  const issues = validateValue(type, value, enums, at);
  if (issues.length > 0) return reject({ reason: "invalid", issues });
  return ok({ def, fieldCode: fieldCode || undefined });
}

// ───────────────────────────── 프리필 ─────────────────────────────

/**
 * 폼 초기값 — 명시 값이 있으면 그 값, 없으면 기본값(있는 자리만). 미입력이고 기본값도 없으면 자리 없음.
 * 여기서 돌려준 기본값은 사람이 저장해야 명시 값이 된다.
 */
export function formPrefill(def: Discriminator, slots: ReadonlyMap<SlotPath, ValueSlot>): Record<SlotPath, Value> {
  const out = prefill(def);
  for (const path of valueSlotsOf(def)) {
    const slot = slots.get(path);
    if (slot?.entered) out[path] = slot.value;
  }
  return out;
}

// ───────────────────────────── 완결성 ─────────────────────────────

/** 미입력 자리 하나. */
export interface MissingSlot {
  owner: CoverageNodeRef;
  /** `담보 > 세부보장 > 급부` */
  ownerName: string;
  discriminatorCode: Code;
  label: string;
  path: SlotPath;
  at: Coordinate;
}

/**
 * 실행 기반 필터 — 「탑재분의 실제 타는 분기」 기준으로 좁힌다 (구분자_기획 완결성 조회 · ADR-0016).
 * 조립(C2)이 구현해 주입한다. 기본은 항등(부착 기반 전체).
 */
export type CompletenessFilter = (items: MissingSlot[], tree: Coverage) => MissingSlot[];

/** 부착 기반 완결성 조회 — 담보 하위 트리 전체의 부착된 자리 중 미입력. 트리 순서 · 부착 목록 순서. */
export function completeness(
  tree: Coverage,
  defs: readonly Discriminator[],
  values: MasterValues,
  filter: CompletenessFilter = (items) => items,
): MissingSlot[] {
  const out: MissingSlot[] = [];
  for (const node of nodesOf(tree)) {
    const slots = slotsOfNode(values, node.id);
    const ownerName = nodeName(tree, node) ?? node.name;
    for (const def of attachedDefinitions(node.level, defs, attachedOfNode(values, node.id))) {
      for (const path of missingSlots(def, (p) => slots.get(p))) {
        out.push({
          owner: { level: node.level, id: node.id },
          ownerName,
          discriminatorCode: def.code,
          label: def.label,
          path,
          at: { document: "coverageMaster", ownerId: tree.id, ownerName, refPath: path },
        });
      }
    }
  }
  return filter(out, tree);
}
