/**
 * 폼 렌더러 — 「폼 = 구조체 = 구분자 하나」(ADR-0001).
 *
 * - model.ts      : buildForm · formReducer · toSubmission · zodSchemaFor (순수, React 없음)
 * - StructForm.tsx: 클라이언트 컴포넌트 — 6 타입을 타입별 매핑 하나로 그린다
 * - ValueList.tsx : 읽기 전용 뷰 — 완결성(미입력) 표시
 */
export * from "./model";
export * from "./StructForm";
export * from "./ValueList";
