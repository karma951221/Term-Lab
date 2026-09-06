import Link from "next/link";

import { ColumnFilter, ListFilterBar, type ColumnFilterSpec } from "@/app/_components/ListFilters";
import { EmptyState } from "@/app/_components/EmptyState";
import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { IconPlus } from "@/app/_components/icons";
import { ListShell } from "@/app/_components/ListShell";
import { includesQuery, paginate } from "@/app/_lib/list";
import { usagesOf } from "@/domain/refs";
import { getServices } from "@/lib/services";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const FILTERS = [{ key: "usage", label: "사용처", options: [{ value: "yes", label: "있음" }, { value: "no", label: "없음" }] }] as const satisfies readonly ColumnFilterSpec[];

function todayInSeoul(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export default async function EnumListPage({ searchParams }: { searchParams: Promise<{ error?: string; q?: string; usage?: string; page?: string }> }) {
  const sp = await searchParams;
  const services = getServices();
  const [enums, graph] = await Promise.all([services.catalog.listEnums(), services.refs.graph()]);
  const q = (sp.q ?? "").trim();
  const usage = sp.usage ?? "";
  const withUsage = enums.map((item) => ({
    item,
    usageCount: usagesOf(graph, { kind: "enum", enumCode: item.code }, { via: ["type"] }).length,
  }));
  const filtered = withUsage.filter(({ item, usageCount }) => {
    if (!includesQuery(q, [item.code, item.label, ...item.values.map((value) => value.label)])) return false;
    if (usage === "yes" && usageCount === 0) return false;
    if (usage === "no" && usageCount > 0) return false;
    return true;
  });
  const { rows, total, page } = paginate(filtered, sp.page, PAGE_SIZE);
  const createHref = q ? `/types/enums/new?q=${encodeURIComponent(q)}` : "/types/enums/new";

  return (
    <div>
      <ErrorBanner message={sp.error} />
      <ListShell
        heading={<div className="ts-list-head"><h2 className="ts-list-title">선택지</h2><Link href={createHref} className="ts-iconbtn" title="새 선택지" aria-label="새 선택지"><IconPlus /></Link></div>}
        filters={<ListFilterBar placeholder="코드 · 표시명 · 값" filters={FILTERS} today={todayInSeoul()} />}
        interactiveFilters
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        basePath="/types/enums"
        query={{ q, usage }}
        empty={enums.length === 0 ? <EmptyState what="선택지는 선택형 구분자가 고르는 값 목록이다." example="심사유형: 일반심사 · 간편심사" actionHref="/types/enums/new" actionLabel="새 선택지" /> : <p className="ts-empty-what">이 조건에 맞는 선택지가 없습니다.</p>}
      >
        <table className="ts-table">
          <thead><tr><th className="col-code">코드</th><th className="col-flex">표시명</th><th className="col-values">값</th><th className="col-num">수</th><th className="col-fixed-sm"><ColumnFilter spec={FILTERS[0]} /></th></tr></thead>
          <tbody>{rows.map(({ item, usageCount }) => {
            const values = [...item.values].sort((a, b) => a.order - b.order);
            const shown = values.slice(0, 5).map((value) => value.label).join(" · ");
            const rest = values.length - 5;
            return <tr key={item.code}>
              <td className="col-code"><code>{item.code}</code></td>
              <td className="col-flex"><Link href={`/types/enums/${item.code}`}>{item.label}</Link></td>
              <td className="col-values">{shown || "—"}{rest > 0 ? ` … 외 ${rest}` : ""}</td>
              <td className="col-num">{values.length}</td>
              <td className="col-fixed-sm">{usageCount || "—"}</td>
            </tr>;
          })}</tbody>
        </table>
      </ListShell>
    </div>
  );
}
