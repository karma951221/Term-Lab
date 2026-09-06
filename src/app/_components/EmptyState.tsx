/**
 * 빈 목록 안내 (디자인원칙 §9.3 상호성 · 리뷰 #20) — 「무엇인지 + 예시 + 다음 행동」 3요소.
 * 필터로 0건이 된 경우에는 쓰지 않는다 — 그건 「이 조건엔 없습니다」이지 「아직 없습니다」가 아니다.
 */
import Link from "next/link";

export interface EmptyStateProps {
  /** 이 실체가 무엇인지 한 문장 (용어사전 정의). */
  what: string;
  /** 예시. 「예: 」 접두는 컴포넌트가 붙인다. */
  example: string;
  actionHref: string;
  actionLabel: string;
}

export function EmptyState({ what, example, actionHref, actionLabel }: EmptyStateProps) {
  return (
    <div className="ts-empty">
      <p className="ts-empty-what">{what}</p>
      <p className="ts-empty-example">예: {example}</p>
      <p className="ts-empty-action">
        <Link href={actionHref}>{actionLabel}</Link>
      </p>
    </div>
  );
}
