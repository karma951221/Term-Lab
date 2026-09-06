import Link from "next/link";

import { EmptyState } from "@/app/_components/EmptyState";
import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { ListShell } from "@/app/_components/ListShell";
import { KIND_LABEL, LEVEL_LABEL, label } from "@/app/_lib/labels";
import type { AttachLevel } from "@/domain/types";
import type { DiscriminatorKind } from "@/domain/catalog/types";
import { getServices } from "@/lib/services";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const KINDS: readonly DiscriminatorKind[] = ["scalar", "struct", "const", "derived"];
const LEVELS: readonly AttachLevel[] = ["product", "plan", "coverage", "subCoverage", "benefit"];

export default async function CatalogListPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; q?: string; kind?: string; level?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const defs = await getServices().catalog.list();

  const q = (sp.q ?? "").trim();
  const kind = sp.kind ?? "";
  const level = sp.level ?? "";
  const filtered = defs.filter((d) => {
    if (q && !d.code.toLowerCase().includes(q.toLowerCase()) && !d.label.includes(q)) return false;
    if (kind && d.kind !== kind) return false;
    if (level && (d.kind === "const" || d.level !== level)) return false;
    return true;
  });
  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, Number(sp.page) || 1), pageCount);
  const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <ErrorBanner message={sp.error} />
      <ListShell
        heading={<h1 className="ts-h1">구분자</h1>}
        toolbar={
          <div className="ts-toolbar">
            <Link href="/catalog/new">+ 새 구분자</Link>
            <Link href="/catalog/enums">enum 목록</Link>
          </div>
        }
        filters={
          <>
            <label>
              검색
              <input type="text" name="q" defaultValue={q} placeholder="코드 · 표시명" />
            </label>
            <label>
              종류
              <select name="kind" defaultValue={kind}>
                <option value="">전체</option>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              레벨
              <select name="level" defaultValue={level}>
                <option value="">전체</option>
                {LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {label(LEVEL_LABEL, l)}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="ts-filterbar-spacer">
              적용
            </button>
          </>
        }
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        basePath="/catalog"
        query={{ q, kind, level }}
        empty={
          defs.length === 0 ? (
            <EmptyState
              what="구분자는 값의 정의 단위다 — 문면이 묻는 개념 하나에 구분자 하나를 짝짓는다."
              example="갱신여부(담보 레벨) · 고지유형(상품 레벨)"
              actionHref="/catalog/new"
              actionLabel="새 구분자 만들기"
            />
          ) : (
            <p className="ts-empty-what">이 조건에 맞는 구분자가 없습니다.</p>
          )
        }
      >
        <table className="ts-table">
          <thead>
            <tr>
              <th className="col-code">코드</th>
              <th className="col-flex">표시명</th>
              <th className="col-fixed-sm">종류</th>
              <th className="col-fixed-sm">레벨</th>
              <th className="col-fixed-sm">노출</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.code}>
                <td className="col-code">
                  <code>{d.code}</code>
                </td>
                <td className="col-flex">
                  <Link href={`/catalog/${d.code}`}>{d.label}</Link>
                </td>
                <td className="col-fixed-sm">{KIND_LABEL[d.kind]}</td>
                <td className="col-fixed-sm">{d.kind !== "const" ? label(LEVEL_LABEL, d.level) : "—"}</td>
                <td className="col-fixed-sm">{d.kind === "scalar" || d.kind === "struct" ? (d.alwaysExposed ? "무조건" : "선택") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ListShell>
    </div>
  );
}
