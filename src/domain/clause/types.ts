/**
 * 공용조항 도메인 타입.
 *
 * 근거: docs/01_기획/공용조항_기획.md · ADR-0008 (참조 + 옵션 + inline/block) ·
 * ADR-0010 (요구 구분자 자동 추출) · ADR-0017 (옵션 선택·오버라이드).
 *
 * - 코드는 시스템 채번·불변 (`C0001`). 옵션 `O01`, 선택지 `V01` 은 소속 안에서 유일.
 * - 본문은 모드에 따라 `Inline[]` 또는 `Block[]` — 판별 합집합으로 타입이 갈린다.
 * - 요구 구분자(`required`)는 저장할 때 식에서 계산해 함께 둔다 (선언 아님).
 */
import type { Code } from "../types";
import type { Block, Inline } from "./nodes";

export type ClauseMode = "inline" | "block";

/** 옵션 자리의 선택지 — 문구 수준의 대안 (ADR-0008 「옵션은 문구 수준 대안 전용」). */
export interface OptionValue {
  /** 옵션 안에서 유일 (`V01`). */
  code: Code;
  label: string;
  /** 이 선택지를 고르면 옵션 자리에 들어가는 문구. */
  body: Inline[];
  /** 선택 UI 표시 순서 (D-P3-6). */
  order: number;
}

/** 옵션 정의 — 본문의 `optionSlot` 이 가리키는 자리. 기본 선택지는 없다 (D-P3-7). */
export interface OptionDef {
  /** 공용조항 안에서 유일 (`O01`). */
  code: Code;
  label: string;
  /** 유효 옵션 집합. 2개 이상 (D-P3-4). */
  values: OptionValue[];
  order: number;
}

/** 요구 참조 — 본문·선택지 본문의 모든 식에서 자동 추출 (ADR-0010). */
export interface RequiredRefs {
  /** 구분자 코드 (등장 순, 중복 없음). 부착 검사의 단위. */
  discriminators: Code[];
  /** 담보속성 종류 코드 (ADR-0015). 탑재 문맥에서 확정된다. */
  attributes: Code[];
}

interface ClauseBase {
  code: Code;
  label: string;
  description: string;
  options: OptionDef[];
  required: RequiredRefs;
}

export interface InlineClause extends ClauseBase {
  mode: "inline";
  body: Inline[];
}

export interface BlockClause extends ClauseBase {
  mode: "block";
  body: Block[];
}

export type Clause = InlineClause | BlockClause;

/** 모드에 따른 본문 타입. */
export type BodyOf<M extends ClauseMode> = M extends "inline" ? Inline[] : Block[];

export type ClauseBody = Inline[] | Block[];

/** 사용처의 옵션 선택 — 옵션 코드 → 선택지 코드. */
export type OptionSelection = Record<Code, Code>;

// ───────────────────────────── 생성 입력 (code 없음) ─────────────────────────────

export interface NewOptionValue {
  label: string;
  body?: Inline[];
}

export interface NewOption {
  label: string;
  values: NewOptionValue[];
}

export interface NewClause {
  label: string;
  mode: ClauseMode;
  body?: ClauseBody;
  options?: NewOption[];
  description?: string;
}

/** 목록 화면용 요약 — 코드 · 표시명 · 모드 · 사용처 수. */
export interface ClauseSummary {
  code: Code;
  label: string;
  mode: ClauseMode;
  usageCount: number;
}
