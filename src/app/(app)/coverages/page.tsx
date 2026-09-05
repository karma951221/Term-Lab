import Link from "next/link";

import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { getServices } from "@/lib/services";

export const dynamic = "force-dynamic";

export default async function CoveragesPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const coverages = await getServices().coverage.list();

  return (
    <div>
      <h1 className="ts-h1">담보</h1>
      <ErrorBanner message={error} />
      <div className="ts-toolbar">
        <Link href="/coverages/new">+ 새 담보</Link>
      </div>
      <table className="ts-table">
        <thead>
          <tr>
            <th>담보명</th>
            <th>세부보장 수</th>
            <th>문면</th>
          </tr>
        </thead>
        <tbody>
          {coverages.map((c) => (
            <tr key={c.id}>
              <td>
                <Link href={`/coverages/${c.id}`}>{c.name}</Link>
              </td>
              <td>{c.subCoverages.length}</td>
              <td>{c.documentId ? <Link href={`/documents/${c.documentId}`}>있음</Link> : <span className="ts-muted">없음</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {coverages.length === 0 && <p className="ts-muted">아직 담보가 없습니다.</p>}
    </div>
  );
}
