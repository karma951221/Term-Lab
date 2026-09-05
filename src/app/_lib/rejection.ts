/**
 * `Rejection` → 사람이 읽을 문장 (순수 함수 — React 없음. `*.test.ts` 로 검증).
 *
 * 규칙(검증·거부)은 화면에 두지 않는다 — 서비스가 돌려주는 Rejection 을 그대로 문장으로 바꿀 뿐이다.
 * `needsConfirmation` 은 문장 하나로 뭉개지 않고 Impact 를 그대로 실어 돌려준다 — 화면이 확인 폼(§`Confirm.tsx`)을
 * 그 위에 그린다.
 */
import type { Impact, Issue, Rejection, Result } from "@/domain/types";

export interface RejectionView {
  /** 한 줄 요약 문장. */
  message: string;
  /** invalid 일 때만 — 필드별 사유 목록. */
  issues?: Issue[];
  /** needsConfirmation 일 때만 — 확인 폼이 그릴 영향 범위. */
  impact?: Impact;
}

const ROLE_LABEL: Record<string, string> = { admin: "관리자", editor: "편집자" };

export function describeRejection(r: Rejection): RejectionView {
  switch (r.reason) {
    case "forbidden":
      return { message: `${ROLE_LABEL[r.role] ?? r.role}만 할 수 있는 작업입니다 — 관리자만 실행할 수 있습니다 (${r.action}).` };
    case "duplicate":
      return { message: `이미 있습니다 — ${r.what}` };
    case "minimumStructure":
      return { message: `최소 구조를 위반합니다 — ${r.what}` };
    case "notFound":
      return { message: `찾을 수 없습니다 — ${r.what}` };
    case "invalid":
      return { message: r.issues.length === 1 ? r.issues[0].message : `${r.issues.length}건의 문제가 있습니다.`, issues: r.issues };
    case "needsConfirmation":
      return { message: "되돌릴 수 없는 작업입니다 — 아래 영향을 확인하고 실행하세요.", impact: r.impact };
  }
}

/** 얕은 헬퍼 — Result 가 실패면 문장을, 성공이면 undefined 를. 서버 액션의 상태 표시에 쓴다. */
export function rejectionMessage<T>(r: { ok: true; value: T } | { ok: false; rejection: Rejection }): string | undefined {
  return r.ok ? undefined : describeRejection(r.rejection).message;
}

/** 실패 시 되돌아갈 경로에 `?error=` 를 실은 문자열. 서버 액션이 `redirect()` 할 때 쓴다. */
export function errorRedirectPath(path: string, message: string): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}error=${encodeURIComponent(message)}`;
}

/**
 * 파괴적 액션 「미리보기」 — 페이지가 `confirm` 없이 서비스를 호출해 Impact 를 얻을 때 쓴다
 * (그 호출 자체는 읽기 전용 — `destructive()` 는 confirm 없으면 precheck+computeImpact 만 하고 끝난다).
 */
export type PreviewOutcome<T> = { kind: "ok"; value: T } | { kind: "confirm"; impact: Impact } | { kind: "error"; message: string };

export function previewOutcome<T>(r: Result<T>): PreviewOutcome<T> {
  if (r.ok) return { kind: "ok", value: r.value };
  if (r.rejection.reason === "needsConfirmation") return { kind: "confirm", impact: r.rejection.impact };
  return { kind: "error", message: describeRejection(r.rejection).message };
}
