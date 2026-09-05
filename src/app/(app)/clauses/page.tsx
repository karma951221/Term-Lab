import Link from "next/link";

import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { getServices } from "@/lib/services";

export const dynamic = "force-dynamic";

export default async function ClausesPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const summaries = await getServices().clause.summaries();

  return (
    <div>
      <h1 className="ts-h1">공용조항</h1>
      <ErrorBanner message={error} />
      <div className="ts-toolbar">
        <Link href="/clauses/new">+ 새 공용조항</Link>
      </div>
      <table className="ts-table">
        <thead>
          <tr>
            <th>코드</th>
            <th>표시명</th>
            <th>모드</th>
            <th>사용처 수</th>
          </tr>
        </thead>
        <tbody>
          {summaries.map((c) => (
            <tr key={c.code}>
              <td>
                <code>{c.code}</code>
              </td>
              <td>
                <Link href={`/clauses/${c.code}`}>{c.label}</Link>
              </td>
              <td>{c.mode}</td>
              <td>{c.usageCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {summaries.length === 0 && <p className="ts-muted">아직 공용조항이 없습니다.</p>}
    </div>
  );
}
