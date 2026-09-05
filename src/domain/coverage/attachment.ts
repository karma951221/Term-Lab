/**
 * 구분자 부착 규칙 (순수) — 담보_기획 「구분자 부착의 범위 — 노출여부」 · 담보값입력_시나리오 S1·S2.
 *
 * 부착 여부 = 정의의 `alwaysExposed` ∨ 선택적 부착 행 존재.
 * - 무조건 노출: 그 레벨 모든 실체에 자동 부착. 부착·해제 요청은 거부한다 (D-P2-9 — 관계 데이터가 없다).
 * - 선택적 노출: + 버튼으로 실체마다 부착. 부착 레벨과 실체 레벨이 같아야 한다.
 * - 파생·const 는 값 자리가 없어 부착 대상이 아니다 (자연히 비노출).
 *
 * 부착 해제의 파괴적 처리(사용처 검사 · 값 행 삭제)는 서비스가 `destructive()` + `UsageSource` 로 두른다.
 */
import type { Discriminator, ValuedDiscriminator } from "../catalog";
import { isValued } from "../catalog";
import { ATTACH_LEVEL_LABEL, type Code, type Issue, ok, reject, type Result } from "../types";
import type { CoverageNodeLevel } from "./types";

/** 실체에 선택적으로 부착된 구분자 코드 집합 (entity_attachments). */
export type AttachedCodes = ReadonlySet<Code>;

/** 이 정의가 실체에 부착돼 있는가 — 무조건 노출이면 항상 true. */
export function isAttached(def: Discriminator, attached: AttachedCodes): boolean {
  if (!isValued(def)) return false;
  return def.alwaysExposed || attached.has(def.code);
}

/** 이 레벨 실체의 부착 목록 — 무조건 노출 전부(먼저) + 부착된 선택적 노출. 값 자리가 있는 정의만. */
export function attachedDefinitions(
  level: CoverageNodeLevel,
  defs: readonly Discriminator[],
  attached: AttachedCodes,
): ValuedDiscriminator[] {
  const atLevel = defs.filter((d): d is ValuedDiscriminator => isValued(d) && d.level === level);
  return [...atLevel.filter((d) => d.alwaysExposed), ...atLevel.filter((d) => !d.alwaysExposed && attached.has(d.code))];
}

/** + 버튼 목록 — 이 레벨의 선택적 노출 구분자 중 미부착분. 무조건 노출은 없다 (이미 모두에 있음). */
export function attachableDefinitions(
  level: CoverageNodeLevel,
  defs: readonly Discriminator[],
  attached: AttachedCodes,
): ValuedDiscriminator[] {
  return defs.filter(
    (d): d is ValuedDiscriminator => isValued(d) && d.level === level && !d.alwaysExposed && !attached.has(d.code),
  );
}

function invalid<T>(kind: Issue["kind"], message: string, refPath: string): Result<T> {
  return reject({ reason: "invalid", issues: [{ kind, message, at: { refPath } }] });
}

/** 부착 가능 검사 — 값 자리 있는 정의 · 선택적 노출 · 레벨 일치 · 미부착. */
export function checkAttach(def: Discriminator, level: CoverageNodeLevel, attached: AttachedCodes): Result<ValuedDiscriminator> {
  if (!isValued(def)) {
    return invalid("typeMismatch", `${def.label}(${def.code}) 은(는) ${def.kind} 구분자라 값 자리가 없어 부착할 수 없습니다`, def.code);
  }
  if (def.alwaysExposed) {
    return invalid("typeMismatch", `${def.label}(${def.code}) 은(는) 무조건 노출 구분자라 부착 조작 대상이 아닙니다`, def.code);
  }
  if (def.level !== level) {
    return invalid(
      "typeMismatch",
      `${def.label}(${def.code}) 의 부착 레벨은 ${ATTACH_LEVEL_LABEL[def.level]} 인데 실체는 ${ATTACH_LEVEL_LABEL[level]} 입니다`,
      def.code,
    );
  }
  if (attached.has(def.code)) return reject({ reason: "duplicate", what: `부착 ${def.label}(${def.code})` });
  return ok(def);
}

/** 해제 가능 검사 — 무조건 노출은 거부, 부착돼 있어야 한다. */
export function checkDetach(def: Discriminator, level: CoverageNodeLevel, attached: AttachedCodes): Result<ValuedDiscriminator> {
  if (!isValued(def)) {
    return invalid("typeMismatch", `${def.label}(${def.code}) 은(는) ${def.kind} 구분자라 부착 관계가 없습니다`, def.code);
  }
  if (def.alwaysExposed) {
    return invalid("typeMismatch", `${def.label}(${def.code}) 은(는) 무조건 노출 구분자라 해제할 수 없습니다`, def.code);
  }
  if (def.level !== level || !attached.has(def.code)) {
    return reject({ reason: "notFound", what: `부착 ${def.label}(${def.code})` });
  }
  return ok(def);
}
