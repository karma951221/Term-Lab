/**
 * 공용조항 도메인 (순수) — 정의 · 옵션 · 요구 구분자 · 참조 검사 · 인라인화.
 *
 * - nodes.ts       : 본문 노드 타입 (문면 노드 모델의 부분집합 — 통합 시 이 파일만 합친다)
 * - types.ts       : Clause · OptionDef · RequiredRefs · 생성 입력(New*, code 없음)
 * - codes.ts       : 코드 채번 규칙 (C0001 · O01 · V01)
 * - body.ts        : analyzeBody (허용 노드 규칙 · 식 파싱 · 요구 구분자 추출) · collectExpressions
 * - definitions.ts : 생성·변경·옵션·복제 규칙 (ClauseContext 주입)
 * - reference.ts   : 부착 검사 · 옵션 선택 검증 · 오버라이드 해소 · expandClause · 사용처 재검사
 */
export * from "./body";
export * from "./codes";
export * from "./definitions";
export * from "./nodes";
export * from "./reference";
export * from "./types";
