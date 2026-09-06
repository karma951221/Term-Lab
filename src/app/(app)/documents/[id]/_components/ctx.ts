/**
 * L3 저작 화면이 렌더에 쓰는 읽기 전용 문맥 — 페이지가 한 번 만들어 목차·본문·우측 패널이 나눠 쓴다.
 * 규칙 없음. 표시명 해소(공용조항·별표·조 참조)와 링크 만들기만 한다.
 */
import type { BranchEvaluation, NodeNumber, ReferenceTarget, SlotEvaluation } from "@/domain/document";
import type { Code, Id } from "@/domain/types";

export type DocMode = "read" | "edit";

/** 현재 쿼리를 유지한 채 일부만 바꾸는 링크. `undefined` 를 주면 그 파라미터를 지운다. */
export type LinkTo = (patch: Record<string, string | undefined>) => string;

export interface DocCtx {
  documentId: Id;
  docKind: "special" | "general";
  mode: DocMode;
  /** 우측 패널에 실린 노드 또는 가지 id (편집 모드). */
  selectedId?: Id;
  numbers: ReadonlyMap<Id, NodeNumber>;
  /** 사전평가 결과 — 있으면 안 탄 가지를 톤다운한다. */
  branchEval?: ReadonlyMap<Id, BranchEvaluation>;
  slotEval?: ReadonlyMap<Id, SlotEvaluation>;
  /** 별표 코드 → 이름. */
  appendixName: ReadonlyMap<Code, string>;
  /** 공용조항 코드 → 표시명. */
  clauseLabel: ReadonlyMap<Code, string>;
  /** 공용조항 옵션 선택 → 「소멸 사유: 사망」. */
  optionText: (clauseCode: Code, options: Record<Code, Code>) => string;
  references: { self: ReadonlyMap<Id, ReferenceTarget>; general: ReadonlyMap<Id, ReferenceTarget> };
  linkTo: LinkTo;
}

/** 조건식 칩 글자 — 읽기 모드는 길면 자르고 전체는 tooltip 으로 준다 (디자인원칙 §2 L3). */
export function chipText(when: string | undefined, mode: DocMode): { text: string; full: string } {
  const full = when ?? "그 밖의 경우 (else)";
  if (mode === "edit" || full.length <= 56) return { text: full, full };
  return { text: `${full.slice(0, 56)}…`, full };
}

/** 서버 액션이 저장 뒤 이 화면(모드·선택 자리 포함)으로 돌아오게 하는 숨은 필드. */
export function returnToValue(ctx: { linkTo: LinkTo }): string {
  return ctx.linkTo({});
}
