/**
 * 조립(assembly) 도메인 (순수) — 상품의 실제 값으로 책자 문서트리를 만든다 (조립_기획 · ADR-0016 · ADR-0014 · ADR-0011).
 *
 * - types.ts      : AssemblyInput · 중간 표현(ResolvedDoc · SubstitutedDoc · NumberedDoc) · Booklet · RenderedDoc
 * - context.ts    : 1. buildContexts — 상품담보 스냅샷 문맥 · 보통약관 문맥(기본계약)
 * - resolve.ts    : 2·3. resolveDocument — 조건 해소(밟은 자리만) + 공용조항 인라인화(오버라이드 > 마스터)
 * - substitute.ts : 4. substituteSlots — 값 슬롯 → 문자열 (포맷 규칙 임시)
 * - omission.ts   : 5. judgeOmission — 조연결 + 리터럴 비교 생략
 * - render.ts     : 6. numberDocument · 8. collectAppendices · 7. renderDocument(조·별표 참조 해소)
 * - booklet.ts    : assemble · assembleSpecial(상품담보 미리보기) · placeSpecials · executionBasedFilter
 * - fixture.ts    : 관통 1 축약 픽스처 (AssemblyInput)
 *
 * DB·React import 금지.
 */
export * from "./booklet";
export * from "./context";
export * from "./fixture";
export * from "./omission";
export * from "./render";
export * from "./resolve";
export * from "./substitute";
export * from "./types";
