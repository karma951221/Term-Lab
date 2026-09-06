import Link from "next/link";

import { EmptyState } from "@/app/_components/EmptyState";
import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { ListShell } from "@/app/_components/ListShell";
import { GlyphUnused } from "@/app/_components/icons";
import { MODE_LABEL } from "@/app/_lib/labels";
import type { ClauseMode } from "@/domain/clause/types";
import { getServices } from "@/lib/services";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const MODES: readonly ClauseMode[] = ["inline", "block"];

export default async function ClausesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; q?: string; mode?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const summaries = await getServices().clause.summaries();

  const q = (sp.q ?? "").trim();
  const mode = sp.mode ?? "";
  const filtered = summaries.filter((c) => {
    if (q && !c.code.toLowerCase().includes(q.toLowerCase()) && !c.label.includes(q)) return false;
    if (mode && c.mode !== mode) return false;
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
        heading={<h1 className="ts-h1">공용조항</h1>}
        toolbar={
          <div className="ts-toolbar">
            <Link href="/clauses/new">+ 새 공용조항</Link>
          </div>
        }
        filters={
          <>
            <label>
              검색
              <input type="text" name="q" defaultValue={q} placeholder="코드 · 표시명" />
            </label>
            <label>
              모드
              <select name="mode" defaultValue={mode}>
                <option value="">전체</option>
                {MODES.map((m) => (
                  <option key={m} value={m}>
                    {MODE_LABEL[m]}
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
        basePath="/clauses"
        query={{ q, mode }}
        empty={
          summaries.length === 0 ? (
            <EmptyState
              what="공용조항은 여러 담보약관이 공통으로 가져다 쓰는 문구 템플릿이다."
              example="특별약관의 소멸, 준용규정"
              actionHref="/clauses/new"
              actionLabel="새 공용조항 만들기"
            />
          ) : (
            <p className="ts-empty-what">이 조건에 맞는 공용조항이 없습니다.</p>
          )
        }
      >
        <table className="ts-table">
          <thead>
            <tr>
              <th className="col-code">코드</th>
              <th className="col-flex">표시명</th>
              <th className="col-fixed-sm">모드</th>
              <th className="col-fixed-md">사용처</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.code}>
                <td className="col-code">
                  <code>{c.code}</code>
                </td>
                <td className="col-flex">
                  <Link href={`/clauses/${c.code}`}>{c.label}</Link>
                </td>
                <td className="col-fixed-sm">{MODE_LABEL[c.mode]}</td>
                <td className="col-fixed-md">
                  {c.usageCount === 0 ? (
                    <span className="ts-badge missing">
                      <GlyphUnused title="사용처 없음" /> 미사용
                    </span>
                  ) : (
                    <Link href={`/relations?kind=clause&code=${c.code}`} title={`${c.label}(${c.code})의 사용처 ${c.usageCount}건 보기`}>
                      사용처 {c.usageCount}건
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ListShell>
    </div>
  );
}
