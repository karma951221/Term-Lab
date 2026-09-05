/**
 * 세목 규칙 (ADR-0006 · 세목구성 시나리오) — 순수.
 *
 * - 세목유형 = **plan 레벨 구조체 구분자**. 유형 하나 = 구조체 하나 (고지유형 같은 상품 레벨 enum 은 아니다).
 * - 선택지 뼈대 `(축, 번호, 이름, 세목유형 참조, 유형 구조체 값)`. MVP 축은 종·형 두 개, 번호 필수 (D-P5-10).
 * - 한 유형은 한 축에만 · 여러 유형이 한 축에 가능 · 같은 축 번호 유일.
 * - 상품세목 = 명시 등록된 유효 조합 — 사용 중인 축마다 선택지 하나씩. 카테시안 아님. 중복 조합 거부 (D-P5-11).
 */
import type { Discriminator } from "../catalog/types";
import { type Id, type Issue, ok, reject, type Result } from "../types";
import { PLAN_AXES, PLAN_AXIS_LABEL, type NewPlanOption, type PlanAxis, type PlanOption, type ProductPlan } from "./types";

function issue(kind: Issue["kind"], message: string, refPath?: string): Issue {
  return { kind, message, at: refPath ? { refPath } : {} };
}

/** plan 레벨 구조체 구분자만 세목유형이 될 수 있다. */
export function validatePlanType(def: Discriminator | undefined): Issue[] {
  if (!def) return [issue("brokenRef", "세목유형으로 지정한 구분자가 없습니다")];
  if (def.kind !== "struct") return [issue("typeMismatch", `세목유형은 구조체 구분자여야 합니다 — ${def.label}(${def.code}) 은(는) ${def.kind}`, def.code)];
  if (def.level !== "plan") return [issue("typeMismatch", `세목유형은 세목(plan) 레벨 구조체여야 합니다 — ${def.label}(${def.code}) 은(는) ${def.level} 레벨`, def.code)];
  return [];
}

/**
 * 선택지 추가·수정 검증. `selfId` 는 수정 시 자기 자신(중복 검사 제외).
 * 유형 존재·종류 검사는 `validatePlanType` 이 따로 한다 (카탈로그 조회 필요).
 */
export function validateNewPlanOption(input: NewPlanOption, existing: readonly PlanOption[], selfId?: Id): Issue[] {
  const issues: Issue[] = [];
  const others = existing.filter((o) => o.id !== selfId);
  if (!(PLAN_AXES as readonly string[]).includes(input.axis)) {
    issues.push(issue("typeMismatch", `축은 종(type)·형(form) 중 하나여야 합니다 — 번호 없는 축은 MVP 밖`));
  }
  if (!Number.isInteger(input.number) || input.number < 1) {
    issues.push(issue("typeMismatch", "종·형 축의 번호는 1 이상의 정수여야 합니다 (번호 필수)"));
  }
  if (typeof input.name !== "string" || input.name.trim().length === 0) {
    issues.push(issue("typeMismatch", "선택지 이름은 비울 수 없습니다"));
  }
  if (others.some((o) => o.axis === input.axis && o.number === input.number)) {
    issues.push(issue("typeMismatch", `${PLAN_AXIS_LABEL[input.axis]} 축에 번호 ${input.number} 이(가) 이미 있습니다`));
  }
  const elsewhere = others.find((o) => o.planTypeCode === input.planTypeCode && o.axis !== input.axis);
  if (elsewhere) {
    issues.push(
      issue(
        "typeMismatch",
        `한 유형은 한 축에만 걸칠 수 있습니다 — ${input.planTypeCode} 은(는) 이미 ${PLAN_AXIS_LABEL[elsewhere.axis]} 축에 있습니다`,
        input.planTypeCode,
      ),
    );
  }
  return issues;
}

/** 문면 표기 — 번호 + 이름 병기: 제2종(보험료 납입면제형). */
export function planOptionLabel(option: Pick<PlanOption, "axis" | "number" | "name">): string {
  return `제${option.number}${PLAN_AXIS_LABEL[option.axis]}(${option.name})`;
}

/** 조합의 표시 — (제1종, 제1형). 중복 거부 메시지·목록용. */
export function planCombinationLabel(options: readonly PlanOption[]): string {
  return `(${sortByAxis(options)
    .map((o) => `제${o.number}${PLAN_AXIS_LABEL[o.axis]}`)
    .join(", ")})`;
}

export function sortByAxis<T extends { axis: PlanAxis }>(options: readonly T[]): T[] {
  return [...options].sort((a, b) => PLAN_AXES.indexOf(a.axis) - PLAN_AXES.indexOf(b.axis));
}

/** 조합의 정체성 키 — 선택지 id 집합 (순서 무관). */
export function planCombinationKey(optionIds: readonly Id[]): string {
  return [...optionIds].sort().join("+");
}

/**
 * 유효 조합 등록 검증 — 상품에서 사용 중인 축(선택지가 하나라도 있는 축)마다 정확히 하나.
 * 통과하면 축 순으로 정렬된 선택지를 돌려준다.
 */
export function validatePlanCombination(
  optionIds: readonly Id[],
  options: readonly PlanOption[],
  registered: readonly ProductPlan[],
): Result<PlanOption[]> {
  const issues: Issue[] = [];
  const byId = new Map(options.map((o) => [o.id, o]));
  const picked: PlanOption[] = [];
  for (const id of optionIds) {
    const o = byId.get(id);
    if (!o) issues.push(issue("brokenRef", `선택지 ${id} 이(가) 이 상품에 없습니다`));
    else picked.push(o);
  }
  const usedAxes = PLAN_AXES.filter((axis) => options.some((o) => o.axis === axis));
  if (usedAxes.length === 0) issues.push(issue("typeMismatch", "선택지가 없는 상품(0종 0형)에는 조합을 등록할 수 없습니다"));
  for (const axis of usedAxes) {
    const n = picked.filter((o) => o.axis === axis).length;
    if (n === 0) issues.push(issue("notEntered", `${PLAN_AXIS_LABEL[axis]} 축의 선택지를 골라야 합니다`));
    if (n > 1) issues.push(issue("typeMismatch", `${PLAN_AXIS_LABEL[axis]} 축에서는 하나만 고를 수 있습니다`));
  }
  if (issues.length > 0) return reject({ reason: "invalid", issues });
  const key = planCombinationKey(picked.map((o) => o.id));
  if (registered.some((p) => planCombinationKey(p.options.map((o) => o.id)) === key)) {
    return reject({ reason: "duplicate", what: `상품세목 조합 ${planCombinationLabel(picked)}` });
  }
  return ok(sortByAxis(picked));
}
