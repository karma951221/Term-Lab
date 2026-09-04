/**
 * 구분자 카탈로그 도메인 타입.
 *
 * 근거: docs/01_기획/구분자_기획.md 「정의의 구성 항목」 · ADR-0001 · ADR-0005 · ADR-0007.
 *
 * 종류(kind) 4가지:
 * - scalar  : 타입 하나(FieldType 6종)인 구분자. 예) 갱신여부(boolean) · 고지유형(enum)
 * - struct  : 폼 = 구조체 = 구분자 하나 (ADR-0001). 필드 목록을 직접 소유. 중첩 금지.
 * - const   : 값이 마스터 정의에 사는 구분자. MVP 는 string 만. 부착 레벨·노출여부 없음 (D-P1-13).
 * - derived : 파생 — 식이 데이터로 저장된다 (ADR-0007). 값 입력 없음 → 노출여부 없음.
 *
 * 코드는 시스템 채번·불변 — 생성 입력(New*)에는 code 필드가 없다 (타입으로 강제).
 */
import type { AttachLevel, Code, FieldType, Value } from "../types";

export type DiscriminatorKind = "scalar" | "struct" | "const" | "derived";

interface DiscriminatorBase {
  /** 자동 채번 코드 (`D0001`). 불변. */
  code: Code;
  /** 표시명. 언제든 변경 가능. */
  label: string;
  description: string;
}

export interface ScalarDiscriminator extends DiscriminatorBase {
  kind: "scalar";
  level: AttachLevel;
  /** 무조건 노출 — 그 레벨의 모든 실체에 값 자리가 생긴다. false 면 + 버튼으로 선택 부착. */
  alwaysExposed: boolean;
  type: FieldType;
  /** 기본값 — 폼 프리필 전용 (ADR-0004). */
  defaultValue?: Value;
}

export interface StructDiscriminator extends DiscriminatorBase {
  kind: "struct";
  level: AttachLevel;
  alwaysExposed: boolean;
  /** 폼 렌더 순서대로 (order 오름차순). */
  fields: FieldDef[];
}

export interface ConstDiscriminator extends DiscriminatorBase {
  kind: "const";
  /** MVP 는 string 만. */
  value: string;
}

export interface DerivedDiscriminator extends DiscriminatorBase {
  kind: "derived";
  /** 집계 범위 = 이 레벨의 실체 하위 트리 (ADR-0007). */
  level: AttachLevel;
  /** 식 원문 (코드 기반 경로). 파싱·검증은 expression 모듈. */
  expression: string;
}

export type Discriminator =
  | ScalarDiscriminator
  | StructDiscriminator
  | ConstDiscriminator
  | DerivedDiscriminator;

/** 구조체 필드. 코드는 구조체 안에서 유일 (`F01`). 참조 경로는 `D0001.F01`. */
export interface FieldDef {
  code: Code;
  label: string;
  type: FieldType;
  /** 기본값 — 폼 프리필 전용. */
  defaultValue?: Value;
  /** 폼 렌더 순서 (0부터). */
  order: number;
}

/** enum 정의 — enum 자체도 코드+표시명 (D-P1-7). */
export interface EnumDef {
  code: Code;
  label: string;
  /** 선택지 표시 순서대로. */
  values: EnumValueDef[];
}

export interface EnumValueDef {
  code: Code;
  label: string;
  order: number;
}

// ───────────────────────────── 생성 입력 (code 없음) ─────────────────────────────

export interface NewField {
  label: string;
  type: FieldType;
  defaultValue?: Value;
}

export interface NewScalar {
  kind: "scalar";
  label: string;
  level: AttachLevel;
  type: FieldType;
  alwaysExposed?: boolean;
  description?: string;
  defaultValue?: Value;
}

export interface NewStruct {
  kind: "struct";
  label: string;
  level: AttachLevel;
  fields?: NewField[];
  alwaysExposed?: boolean;
  description?: string;
}

export interface NewConst {
  kind: "const";
  label: string;
  value: string;
  description?: string;
}

export interface NewDerived {
  kind: "derived";
  label: string;
  level: AttachLevel;
  expression: string;
  description?: string;
}

export type NewDiscriminator = NewScalar | NewStruct | NewConst | NewDerived;

export interface NewEnumValue {
  label: string;
}

export interface NewEnum {
  label: string;
  values?: NewEnumValue[];
}

// ───────────────────────────── 조회 인터페이스 ─────────────────────────────

/** enum 코드 → 정의. 없으면 undefined. */
export type EnumLookup = (enumCode: Code) => EnumDef | undefined;

/** 값 자리 경로 — `D0001`(scalar) 또는 `D0002.F01`(구조체 필드). 식의 참조 경로와 같다. */
export type SlotPath = string;

/** 부착 레벨을 갖는 종류 (const 제외). */
export type LeveledDiscriminator = ScalarDiscriminator | StructDiscriminator | DerivedDiscriminator;

export function hasLevel(def: Discriminator): def is LeveledDiscriminator {
  return def.kind !== "const";
}

/** 값 자리를 갖는 종류 — scalar · struct. const·derived 는 입력 경로가 없다. */
export type ValuedDiscriminator = ScalarDiscriminator | StructDiscriminator;

export function isValued(def: Discriminator): def is ValuedDiscriminator {
  return def.kind === "scalar" || def.kind === "struct";
}
