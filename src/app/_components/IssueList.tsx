import type { Issue } from "@/domain/types";

/** Issue 목록 — 좌표(refPath·조·경로)가 있으면 함께 보여준다. 규칙 문구는 서비스가 준 message 그대로. */
export function IssueList({ issues }: { issues: readonly Issue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="ts-issues" role="alert">
      {issues.map((issue, i) => (
        <li key={i}>
          <span className="ts-issue-kind">[{issue.kind}]</span> {issue.message}
          {issue.at.refPath && <code className="ts-issue-path"> · {issue.at.refPath}</code>}
          {issue.at.articleTitle && <span className="ts-issue-at"> · {issue.at.articleTitle}</span>}
          {issue.at.ownerName && <span className="ts-issue-at"> · {issue.at.ownerName}</span>}
        </li>
      ))}
    </ul>
  );
}
