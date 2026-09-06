/**
 * 화면 라벨 맵 — 도메인 enum 리터럴을 한글로. 영문 값이 화면에 새지 않게 여기만 통과시킨다
 * (디자인원칙 §9 · 리뷰 #64). 도메인 타입이 늘면 여기도 늘린다 (satisfies 로 누락을 잡는다).
 */
import type { AttachLevel, FieldTypeKind } from "@/domain/types";
import type { DiscriminatorKind } from "@/domain/catalog/types";
import type { ClauseMode } from "@/domain/clause/types";
import type { CoverageNodeLevel } from "@/domain/coverage/types";

export const KIND_LABEL = {
  scalar: "단일값",
  struct: "폼",
  const: "상수",
  derived: "파생",
} as const satisfies Record<DiscriminatorKind, string>;

export const LEVEL_LABEL = {
  product: "상품",
  plan: "세목",
  coverage: "담보",
  subCoverage: "세부보장",
  benefit: "급부",
} as const satisfies Record<AttachLevel, string>;

export const NODE_LEVEL_LABEL = {
  coverage: "담보",
  subCoverage: "세부보장",
  benefit: "급부",
} as const satisfies Record<CoverageNodeLevel, string>;

export const TYPE_LABEL = {
  string: "문자열",
  number: "숫자",
  boolean: "예/아니오",
  date: "날짜",
  enum: "선택형",
  "list<enum>": "선택형(복수)",
} as const satisfies Record<FieldTypeKind, string>;

export const MODE_LABEL = {
  inline: "문장 안",
  block: "조 단위",
} as const satisfies Record<ClauseMode, string>;

export const DOC_KIND_LABEL = {
  general: "보통약관",
  special: "특별약관",
} as const;

export const ROLE_LABEL = { admin: "관리자", editor: "편집자" } as const;

/** 맵에 없는 값이 오면 원문을 그대로 돌려준다 — 조용히 빈칸이 되는 것보다 낫다. */
export function label<K extends string>(map: Record<K, string>, value: string): string {
  return (map as Record<string, string>)[value] ?? value;
}
