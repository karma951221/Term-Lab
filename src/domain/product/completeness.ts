/**
 * 완결성 · 부착 검사 — 순수.
 *
 * - 노출된 구분자 = 그 레벨의 무조건 노출 정의 ∪ 선택 부착 (담보_기획 노출여부).
 * - 상품담보 완결성 = 스냅샷 실체(상품담보 · 세부보장 · 급부)마다 노출된 구분자의 미입력 자리.
 *   실행 기반 필터(실제 밟는 분기만)는 조립(C2)이 이 목록 위에 얹는다.
 * - 기본계약 부착 검사(ADR-0011): 보통약관이 요구하는 담보 레벨 참조가 기본계약 스냅샷에 노출돼 있는가.
 *   실패는 거부가 아니라 `notAttached` 이슈 목록 (D-P5-13).
 */
import type { Discriminator, ValuedDiscriminator } from "../catalog/types";
import { isValued } from "../catalog/types";
import { missingSlots, type SlotReader } from "../catalog/values";
import type { AttachLevel, Code, Issue } from "../types";
import type { MissingSlot, RequiredCoverageRef } from "./types";

/** 레벨에 노출된 값 있는 구분자 (코드 순). */
export function exposedDiscriminators(level: AttachLevel, defs: readonly Discriminator[], attached: readonly Code[]): ValuedDiscriminator[] {
  const set = new Set(attached);
  return defs
    .filter(isValued)
    .filter((d) => d.level === level && (d.alwaysExposed || set.has(d.code)))
    .sort((a, b) => a.code.localeCompare(b.code));
}

export function missingSlotsOf(
  owner: MissingSlot["owner"],
  ownerName: string,
  level: AttachLevel,
  defs: readonly Discriminator[],
  attached: readonly Code[],
  read: SlotReader,
): MissingSlot[] {
  const out: MissingSlot[] = [];
  for (const def of exposedDiscriminators(level, defs, attached)) {
    for (const path of missingSlots(def, read)) out.push({ owner, ownerName, level, path });
  }
  return out;
}

/** 미입력 목록 → 조립 오류 패널 표기 (kind notEntered). */
export function missingToIssues(missing: readonly MissingSlot[], productCoverageId?: string): Issue[] {
  return missing.map((m) => ({
    kind: "notEntered",
    message: `${m.ownerName} 의 ${m.path} 이(가) 미입력입니다`,
    at: { document: m.owner.kind === "product" ? "product" : "special", ownerId: productCoverageId ?? m.owner.id, ownerName: m.ownerName, refPath: m.path },
  }));
}

/** 기본계약 스냅샷의 레벨별 노출 구분자 코드. */
export interface ExposedByLevel {
  coverage: readonly Code[];
  subCoverage: readonly Code[];
  benefit: readonly Code[];
}

export function checkGeneralAttachment(
  required: readonly RequiredCoverageRef[],
  exposed: ExposedByLevel,
  baseContract: { id: string; name: string },
): Issue[] {
  const issues: Issue[] = [];
  for (const ref of required) {
    if (exposed[ref.level].includes(ref.discriminatorCode)) continue;
    issues.push({
      kind: "notAttached",
      message: `보통약관이 요구하는 ${ref.level} 레벨 구분자 ${ref.discriminatorCode} 이(가) 기본계약 「${baseContract.name}」 에 부착돼 있지 않습니다`,
      at: { document: "general", ...ref.at, ownerId: baseContract.id, ownerName: baseContract.name, refPath: ref.discriminatorCode },
    });
  }
  return issues;
}
