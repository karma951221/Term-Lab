/**
 * 파괴적 변경의 영향(Impact) 계산 (구분자_기획 「변경·삭제 규칙」 · ADR-0019).
 *
 * 값 행은 카탈로그 밖(부착 실체를 소유한 영역)에 살고, 식·문면 사용처 역인덱스는 refs 영역(C1)이
 * 담당한다. 그래서 여기서는 **인터페이스(`ImpactSource`)만 정의하고 주입받는다**.
 * 기본 구현 `NO_VALUE_STORE` 는 값 행 0 · 참조 없음 — 값 저장소가 생기기 전의 자리.
 *
 * 카탈로그 안에서 계산할 수 있는 것은 여기서 계산한다:
 * - cascade: 구조체 삭제 → 필드들, enum 삭제 → 값들
 * - enum 을 참조하는 구분자·필드 (`enumReferences`)
 */
import type { Code, Coordinate, Impact } from "../types";
import type { Discriminator, EnumDef } from "./types";
import { slotPath } from "./values";

/** 영향을 받는 대상. */
export type ImpactTarget =
  /** 구분자 삭제 · scalar 타입 변경 — 그 구분자의 값 행 전부 */
  | { kind: "discriminator"; code: Code }
  /** 필드 삭제 · 필드 타입 변경 — 그 필드의 값 행 */
  | { kind: "field"; code: Code; fieldCode: Code }
  /** enum 값 삭제 — 그 값을 고른 값 행 */
  | { kind: "enumValue"; enumCode: Code; valueCode: Code }
  /** enum 삭제 — 그 enum 의 어떤 값이든 고른 값 행 */
  | { kind: "enum"; enumCode: Code };

/**
 * 값 저장소 · 참조 역인덱스가 구현하는 인터페이스.
 * - countValueRows / findBrokenRefs: 1차 호출(확인 요청)에 쓴다.
 * - purgeValueRows: confirm 후 실행 단계에서 값 행 연쇄 삭제.
 */
export interface ImpactSource {
  countValueRows(target: ImpactTarget): Promise<number>;
  findBrokenRefs(target: ImpactTarget): Promise<Coordinate[]>;
  purgeValueRows(target: ImpactTarget): Promise<void>;
}

/** 값 저장소가 아직 없을 때의 기본 구현. */
export const NO_VALUE_STORE: ImpactSource = {
  countValueRows: async () => 0,
  findBrokenRefs: async () => [],
  purgeValueRows: async () => {},
};

export interface ImpactExtras {
  /** 함께 삭제될 하위 실체 이름 (카탈로그가 아는 것). */
  cascade?: string[];
  /** 카탈로그 안에서 찾은 깨질 참조 (enum 참조 필드 등). */
  brokenRefs?: Coordinate[];
}

export async function computeImpact(
  target: ImpactTarget,
  source: ImpactSource,
  extras: ImpactExtras = {},
): Promise<Impact> {
  const [valueRowsLost, external] = await Promise.all([
    source.countValueRows(target),
    source.findBrokenRefs(target),
  ]);
  return {
    valueRowsLost,
    brokenRefs: [...(extras.brokenRefs ?? []), ...external],
    cascade: extras.cascade ?? [],
  };
}

/** 정의를 지울 때 함께 사라지는 하위 실체의 이름 목록. */
export function cascadeOf(def: Discriminator | EnumDef): string[] {
  if ("values" in def) return def.values.map((v) => `값 ${v.label}(${v.code})`);
  if (def.kind === "struct") return def.fields.map((f) => `필드 ${f.label}(${f.code})`);
  return [];
}

/** enum 을 타입으로 쓰는 구분자(scalar)·필드의 좌표. refPath = 값 자리 경로. */
export function enumReferences(enumCode: Code, defs: readonly Discriminator[]): Coordinate[] {
  const refs: Coordinate[] = [];
  for (const def of defs) {
    if (def.kind === "scalar") {
      if ("enumCode" in def.type && def.type.enumCode === enumCode) {
        refs.push({ refPath: slotPath(def.code), ownerName: def.label });
      }
    } else if (def.kind === "struct") {
      for (const f of def.fields) {
        if ("enumCode" in f.type && f.type.enumCode === enumCode) {
          refs.push({ refPath: slotPath(def.code, f.code), ownerName: `${def.label}.${f.label}` });
        }
      }
    }
  }
  return refs;
}
