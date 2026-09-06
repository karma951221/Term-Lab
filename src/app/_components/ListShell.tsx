/**
 * L1 조회 화면 셸 (디자인원칙 §2 L1) — sticky 필터바 + 표(children) + 하단 고정 페이저.
 *
 * 필터는 GET 폼이다 (서버 액션을 쓰지 않는다 — 리뷰 브리프가 필터를 searchParams 로 두라고 정함).
 * 페이저는 「총 N건 · p/P」 + 이전/다음 링크로, 현재 필터 쿼리를 그대로 물려 페이지만 바꾼다.
 * 목록이 비면(필터 무관 실제 0건) `empty` 를 표 대신 보여준다 (§9.3 상호성 — 빈 화면에 다음 행동을 준다).
 */
import Link from "next/link";
import type { ReactNode } from "react";

export interface ListShellProps {
  /** 화면 제목 요소 전체(예: `<h1 className="ts-h1">담보</h1>`) — 문서 목록처럼 h2 를 쓰는 화면도 있어 완전히 맡긴다. */
  heading?: ReactNode;
  /** 제목 아래 · 필터바 위 — 「+ 새로 만들기」류 링크. */
  toolbar?: ReactNode;
  /** 필터바 안에 놓일 입력·선택 필드들 (표 컬럼과 일치시킨다, §2 L1). 없으면 필터바 자체를 안 그린다. */
  filters?: ReactNode;
  /** 필터 적용 후 전체 건수. */
  total: number;
  /** 현재 페이지 (1부터). */
  page: number;
  pageSize: number;
  /** 페이지 링크를 만들 기준 경로. */
  basePath: string;
  /** 페이지 링크에 실어 보낼 현재 쿼리(필터 값) — page 파라미터 이름은 여기 넣지 않는다. */
  query?: Record<string, string | undefined>;
  /** page 쿼리 파라미터 이름 (문서 목록처럼 한 화면에 목록이 둘일 때 겹치지 않게). 기본 "page". */
  pageParam?: string;
  /**
   * 필터 적용 후 0건일 때 표 대신 보여줄 안내. 실제로 하나도 없는 경우엔 EmptyState(무엇인지+예시+행동),
   * 필터 탓에 0건인 경우엔 「이 조건엔 없습니다」 한 줄 — 호출부가 갈라 만들어 넘긴다.
   * `total > 0` 이면 이 값과 무관하게 `children`(표)을 그린다.
   */
  empty?: ReactNode;
  children: ReactNode;
}

export function ListShell({
  heading,
  toolbar,
  filters,
  total,
  page,
  pageSize,
  basePath,
  query = {},
  pageParam = "page",
  empty,
  children,
}: ListShellProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), pageCount);

  function pageHref(p: number): string {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v) params.set(k, v);
    }
    if (p > 1) params.set(pageParam, String(p));
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  return (
    <div className="ts-l1">
      {heading}
      {toolbar}
      {filters ? (
        <form method="get" className="ts-filterbar">
          {filters}
        </form>
      ) : null}
      {total === 0 ? empty : children}
      <div className="ts-pager">
        <span className="ts-count">
          총 <b>{total}</b>건 · {current}/{pageCount}
        </span>
        <span className="ts-pager-nav">
          {current > 1 ? (
            <Link href={pageHref(current - 1)}>이전</Link>
          ) : (
            <span className="ts-muted">이전</span>
          )}
          {current < pageCount ? (
            <Link href={pageHref(current + 1)}>다음</Link>
          ) : (
            <span className="ts-muted">다음</span>
          )}
        </span>
      </div>
    </div>
  );
}
