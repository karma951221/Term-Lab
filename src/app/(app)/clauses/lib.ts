/** 공용조항 서버 액션의 입력 파싱 — 순수 함수. `*.test.ts` 로 검증. */
import type { ClauseBody } from "@/domain/clause";

export function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

/**
 * 본문 JSON 텍스트영역 → ClauseBody. 구조 편집기는 문면 편집기와 같은 컴포넌트를 재사용하는 대신
 * (D2 최소형) JSON 텍스트로 받는다 — 검증은 도메인(createClause·setBody)이 한다, 여기는 파싱만.
 */
export function parseClauseBody(json: string): ClauseBody | undefined {
  const trimmed = json.trim();
  if (trimmed === "") return [];
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return Array.isArray(parsed) ? (parsed as ClauseBody) : undefined;
  } catch {
    return undefined;
  }
}
