import { coordinateHref } from "./coordinateHref";
import { formatCoordinate } from "@/domain/coordinate";
import type { Issue } from "@/domain/types";

/** 심각도별 글리프 — 문자(⚠)가 아니라 그려서 currentColor 로 상속받는다 (디자인원칙 §1.6). */
function SeverityGlyph({ severity }: { severity: "error" | "warning" }) {
  if (severity === "warning") {
    return (
      <svg className="ts-icon" viewBox="0 0 14 14" aria-hidden="true">
        <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <line x1="7" y1="4" x2="7" y2="7.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="7" cy="10" r="0.9" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg className="ts-icon" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M7 1.5 L13 12.5 L1 12.5 Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <line x1="7" y1="5.5" x2="7" y2="9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="7" cy="10.8" r="0.9" fill="currentColor" />
    </svg>
  );
}

/**
 * 원천/결과 좌표와 이동 동작을 공유하는 오류 패널.
 * `total` 을 주면 「오류 N / 전체 M」처럼 분모를 함께 보여준다(디자인원칙 §9.6) — 없으면 분자만.
 */
export function IssueList({ issues, total }: { issues: readonly Issue[]; total?: number }) {
  if (issues.length === 0) return null;
  const errorCount = issues.filter((i) => i.severity !== "warning").length;
  return (
    <>
      {total !== undefined && (
        <p className="ts-count">
          오류 <b>{errorCount}</b> / 전체 {total}건
        </p>
      )}
      <ul className="ts-issues" role="alert">
        {issues.map((issue, i) => {
          const severity: "error" | "warning" = issue.severity === "warning" ? "warning" : "error";
          const href = coordinateHref(issue.source);
          return (
            <li key={i} className={severity === "warning" ? "ts-issue-warning" : undefined}>
              <SeverityGlyph severity={severity} />{" "}
              <span className="ts-issue-kind">
                [{severity === "warning" ? "warning" : "error"} · {issue.kind}]
              </span>{" "}
              {issue.message}
              {severity === "warning" && <span className="ts-muted"> · 완결성을 깨지 않는 경고</span>}
              <div className="ts-issue-at">결과: {formatCoordinate(issue.at)}</div>
              {issue.source && <div className="ts-issue-at">원천: {formatCoordinate(issue.source, { source: true })}</div>}
              {issue.at.nodePath?.at(-1) && <a href={`#node-${issue.at.nodePath.at(-1)}`}>미리보기에서 보기</a>}
              {href && (
                <>
                  {" "}
                  · <a href={href}>고치러 가기</a>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
