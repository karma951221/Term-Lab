import { formatCoordinate } from "@/domain/coordinate";
import type { Issue } from "@/domain/types";

function sourceHref(issue: Issue): string | undefined {
  const source = issue.source;
  if (!source?.ownerId) return undefined;
  const node = source.nodePath?.at(-1) ?? source.articleId;
  if (source.document === "general" || source.document === "coverageMaster") return `/documents/${source.ownerId}${node ? `?node=${node}` : ""}`;
  if (source.document === "clause") return `/clauses/${source.ownerId}${node ? `?node=${node}` : ""}`;
  if (source.document === "product") {
    const coverageId = source.nodePath?.[0];
    return coverageId ? `/products/${source.ownerId}/coverages/${coverageId}` : `/products/${source.ownerId}`;
  }
  return undefined;
}

/** 원천/결과 좌표와 이동 동작을 공유하는 오류 패널. */
export function IssueList({ issues }: { issues: readonly Issue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="ts-issues" role="alert">
      {issues.map((issue, i) => (
        <li key={i} className={issue.severity === "warning" ? "ts-issue-warning" : undefined}>
          <span className="ts-issue-kind">[{issue.severity === "warning" ? "warning" : "error"} · {issue.kind}]</span> {issue.message}
          {issue.severity === "warning" && <span className="ts-muted"> · 완결성을 깨지 않는 경고</span>}
          <div className="ts-issue-at">결과: {formatCoordinate(issue.at)}</div>
          {issue.source && <div className="ts-issue-at">원천: {formatCoordinate(issue.source, { source: true })}</div>}
          {issue.at.nodePath?.at(-1) && <a href={`#node-${issue.at.nodePath.at(-1)}`}>미리보기에서 보기</a>}
          {sourceHref(issue) && <> · <a href={sourceHref(issue)}>고치러 가기</a></>}
        </li>
      ))}
    </ul>
  );
}
