/**
 * 구분자 카탈로그 도메인 (순수) — 정의 · 구조체 · enum · const · 파생 · 값 규칙 · 영향.
 *
 * - types.ts       : Discriminator 4종 · FieldDef · EnumDef · 생성 입력(New*, code 없음)
 * - codes.ts       : 코드 채번 규칙 (D0001 · F01 · E0001 · V01)
 * - values.ts      : validateValue · 값 자리(SlotPath) · prefill · missingSlots
 * - definitions.ts : 생성·변경 규칙 (CatalogContext 주입)
 * - impact.ts      : ImpactTarget · ImpactSource(주입) · computeImpact · cascadeOf · enumReferences
 */
export * from "./codes";
export * from "./definitions";
export * from "./impact";
export * from "./types";
export * from "./values";
