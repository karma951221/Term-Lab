/**
 * 공용조항 코드 채번 규칙 (ADR-0005 — 시스템 채번 · 불변).
 *
 * 카탈로그 `codes.ts` 와 같은 접두 규칙이다. 카탈로그의 `CodeKind` 가 닫혀 있어
 * 공용조항 종류는 여기서 따로 정의하고, **순번 테이블(code_sequences)만 공유**한다.
 *
 * | 종류        | 접두 | 최소 자리수 | 순번 범위(scope)            | 예    |
 * |-------------|------|-------------|-----------------------------|-------|
 * | 공용조항    | C    | 4           | 전역 ("")                   | C0001 |
 * | 옵션 자리   | O    | 2           | 소속 공용조항 코드마다      | O01   |
 * | 옵션 선택지 | V    | 2           | `<공용조항코드>/<옵션코드>` | V01   |
 *
 * 순번은 1부터, 오르기만 한다 (삭제된 코드는 다시 태어나지 않는다).
 */
import type { Code } from "../types";

export type ClauseCodeKind = "clause" | "option" | "optionValue";

export const CLAUSE_CODE_PREFIX: Record<ClauseCodeKind, string> = {
  clause: "C",
  option: "O",
  optionValue: "V",
};

export const CLAUSE_CODE_MIN_WIDTH: Record<ClauseCodeKind, number> = {
  clause: 4,
  option: 2,
  optionValue: 2,
};

/** 순번의 출처 — 저장소가 구현한다 (code_sequences 의 kind 는 `clause` · `clauseOption` · `clauseOptionValue`). */
export type ClauseNextSeq = (kind: ClauseCodeKind, scope: string) => Promise<number> | number;

export function formatClauseCode(kind: ClauseCodeKind, seq: number): Code {
  if (!Number.isInteger(seq) || seq < 1) {
    throw new RangeError(`코드 순번은 1 이상의 정수여야 합니다: ${seq}`);
  }
  return CLAUSE_CODE_PREFIX[kind] + String(seq).padStart(CLAUSE_CODE_MIN_WIDTH[kind], "0");
}

/** 선택지 순번의 scope — 공용조항과 옵션을 합친 키. */
export function optionValueScope(clauseCode: Code, optionCode: Code): string {
  return `${clauseCode}/${optionCode}`;
}

export async function allocateClauseCode(kind: ClauseCodeKind, scope: string, nextSeq: ClauseNextSeq): Promise<Code> {
  return formatClauseCode(kind, await nextSeq(kind, scope));
}
