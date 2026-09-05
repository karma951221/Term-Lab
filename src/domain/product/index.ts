/**
 * 상품·탑재 도메인 (순수) — 담보속성 카탈로그 · 상품 · 세목 · 탑재 스냅샷 · 작명 · 기본계약 · 특약 그룹 · 완결성.
 *
 * - types.ts        : 도메인 타입 + 주입 인터페이스 (CoverageMasterSource · GeneralAttachmentCheck · OptionValidator …)
 * - attributes.ts   : 담보속성 종류·유효값·작명 규칙·순서 (코드 A0001 · V01)
 * - naming.ts       : default 상품담보명 (작명 문법 확정 주석)
 * - plans.ts        : 세목유형·선택지·유효 조합 규칙
 * - mount.ts        : 조합 키·선택 검증·스냅샷 구조 대조(diffStructure)
 * - groups.ts       : sortInGroup · 그룹 템플릿 검증
 * - completeness.ts : 노출 구분자 · 미입력 목록 · 기본계약 부착 검사
 */
export * from "./attributes";
export * from "./completeness";
export * from "./groups";
export * from "./mount";
export * from "./naming";
export * from "./plans";
export * from "./types";
