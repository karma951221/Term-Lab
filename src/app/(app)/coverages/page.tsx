import Link from "next/link";

import { EmptyState } from "@/app/_components/EmptyState";
import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { ListShell } from "@/app/_components/ListShell";
import { getServices } from "@/lib/services";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default async function CoveragesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; q?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const summaries = await getServices().coverage.listSummaries();

  const q = (sp.q ?? "").trim();
  const filtered = q ? summaries.filter((c) => c.name.includes(q)) : summaries;
  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, Number(sp.page) || 1), pageCount);
  const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <ErrorBanner message={sp.error} />
      {/*
       * 디자인원칙 §2 L1 「담보 조회의 컬럼」은 코드·담보명·담보분류·상태·최종수정 5컬럼을 정했지만,
       * 담보 마스터 스키마(src/db/schema/coverage.ts)에는 코드도, 담보분류(담보 레벨 enum 구분자)도,
       * 상태(미사용/적용/확정, §2 L1 「담보 상태」)도 아직 없다 — 도메인에 없는 값을 화면이 지어내지
       * 않는다(작업지시). 그래서 지금 낼 수 있는 두 컬럼(담보명·최종수정)만 그린다.
       * 세부보장·급부 수는 설계가 목록 컬럼에서 뺐다 (판단에 안 쓰인다) — 제거했다.
       */}
      <ListShell
        heading={<h1 className="ts-h1">담보</h1>}
        toolbar={
          <div className="ts-toolbar">
            <Link href="/coverages/new">+ 새 담보</Link>
          </div>
        }
        filters={
          <label>
            검색
            <input type="text" name="q" defaultValue={q} placeholder="담보명" />
          </label>
        }
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        basePath="/coverages"
        query={{ q }}
        empty={
          summaries.length === 0 ? (
            <EmptyState
              what="담보는 재사용되는 보장 단위의 마스터다 — 문면 1벌과 세부보장 트리를 소유한다."
              example="일반상해사망보장, 수술비"
              actionHref="/coverages/new"
              actionLabel="새 담보 만들기"
            />
          ) : (
            <p className="ts-empty-what">이 조건에 맞는 담보가 없습니다.</p>
          )
        }
      >
        <table className="ts-table">
          <thead>
            <tr>
              <th className="col-flex">담보명</th>
              <th className="col-fixed-md">최종수정</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td className="col-flex">
                  <Link href={`/coverages/${c.id}`}>{c.name}</Link>
                </td>
                <td className="col-fixed-md ts-mono">{formatDate(c.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ListShell>
    </div>
  );
}
