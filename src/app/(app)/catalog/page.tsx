import Link from "next/link";

import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { ATTACH_LEVEL_LABEL } from "@/domain/types";
import { getServices } from "@/lib/services";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = { scalar: "스칼라", struct: "구조체", const: "const", derived: "파생" };

export default async function CatalogListPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const defs = await getServices().catalog.list();

  return (
    <div>
      <h1 className="ts-h1">구분자</h1>
      <ErrorBanner message={error} />
      <div className="ts-toolbar">
        <Link href="/catalog/new">+ 새 구분자</Link>
        <Link href="/catalog/enums">enum 목록</Link>
      </div>
      <table className="ts-table">
        <thead>
          <tr>
            <th>코드</th>
            <th>표시명</th>
            <th>종류</th>
            <th>레벨</th>
            <th>노출</th>
          </tr>
        </thead>
        <tbody>
          {defs.map((d) => (
            <tr key={d.code}>
              <td>
                <code>{d.code}</code>
              </td>
              <td>
                <Link href={`/catalog/${d.code}`}>{d.label}</Link>
              </td>
              <td>{KIND_LABEL[d.kind]}</td>
              <td>{d.kind !== "const" ? ATTACH_LEVEL_LABEL[d.level] : "—"}</td>
              <td>{d.kind === "scalar" || d.kind === "struct" ? (d.alwaysExposed ? "무조건" : "선택") : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {defs.length === 0 && <p className="ts-muted">아직 구분자가 없습니다.</p>}
    </div>
  );
}
