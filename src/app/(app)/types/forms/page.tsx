import Link from "next/link";

import { ColumnFilter, ListFilterBar, type ColumnFilterSpec } from "@/app/_components/ListFilters";
import { EmptyState } from "@/app/_components/EmptyState";
import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { IconPlus } from "@/app/_components/icons";
import { ListShell } from "@/app/_components/ListShell";
import { LEVEL_LABEL } from "@/app/_lib/labels";
import { includesQuery, paginate } from "@/app/_lib/list";
import { usagesOf } from "@/domain/refs";
import { ATTACH_LEVELS } from "@/domain/types";
import { getServices } from "@/lib/services";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 50;
const FILTERS = [
  { key: "level", label: "레벨", options: ATTACH_LEVELS.map((value) => ({ value, label: LEVEL_LABEL[value] })) },
  { key: "exposure", label: "노출", options: [{ value: "always", label: "무조건" }, { value: "optional", label: "선택" }] },
  { key: "usage", label: "사용처", options: [{ value: "yes", label: "있음" }, { value: "no", label: "없음" }] },
] as const satisfies readonly ColumnFilterSpec[];

function todayInSeoul(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export default async function FormListPage({ searchParams }: { searchParams: Promise<{ error?: string; q?: string; level?: string; exposure?: string; usage?: string; page?: string }> }) {
  const sp = await searchParams;
  const services = getServices();
  const [defs, graph] = await Promise.all([services.catalog.list(), services.refs.graph()]);
  const forms = defs.filter((def) => def.kind === "struct");
  const q = (sp.q ?? "").trim();
  const rowsWithUsage = forms.map((item) => ({ item, usageCount: usagesOf(graph, { kind: "discriminator", code: item.code }).length }));
  const filtered = rowsWithUsage.filter(({ item, usageCount }) => {
    if (!includesQuery(q, [item.code, item.label, ...item.fields.map((field) => field.label)])) return false;
    if (sp.level && item.level !== sp.level) return false;
    if (sp.exposure && ((sp.exposure === "always") !== item.alwaysExposed)) return false;
    if (sp.usage === "yes" && usageCount === 0) return false;
    if (sp.usage === "no" && usageCount > 0) return false;
    return true;
  });
  const { rows, total, page } = paginate(filtered, sp.page, PAGE_SIZE);
  const createParams = new URLSearchParams();
  if (q) createParams.set("q", q);
  if (sp.level) createParams.set("level", sp.level);
  const createHref = `/types/forms/new${createParams.size ? `?${createParams}` : ""}`;
  return <div>
    <ErrorBanner message={sp.error} />
    <ListShell
      heading={<div className="ts-list-head"><h2 className="ts-list-title">폼</h2><Link href={createHref} className="ts-iconbtn" title="새 폼" aria-label="새 폼"><IconPlus /></Link></div>}
      filters={<ListFilterBar placeholder="코드 · 표시명 · 필드" filters={FILTERS} today={todayInSeoul()} />}
      interactiveFilters total={total} page={page} pageSize={PAGE_SIZE} basePath="/types/forms"
      query={{ q, level: sp.level, exposure: sp.exposure, usage: sp.usage }}
      empty={forms.length === 0 ? <EmptyState what="폼은 값 여러 개를 한 번에 묻는 구분자다." example="납입면제: 면책여부 · 면제사유" actionHref="/types/forms/new" actionLabel="새 폼" /> : <p className="ts-empty-what">이 조건에 맞는 폼이 없습니다.</p>}
    >
      <table className="ts-table"><thead><tr><th className="col-code">코드</th><th className="col-flex">표시명</th><th className="col-fixed-sm"><ColumnFilter spec={FILTERS[0]} /></th><th className="col-fixed-sm"><ColumnFilter spec={FILTERS[1]} /></th><th className="col-num">필드</th><th className="col-fixed-sm"><ColumnFilter spec={FILTERS[2]} /></th></tr></thead>
      <tbody>{rows.map(({ item, usageCount }) => <tr key={item.code}><td className="col-code"><code>{item.code}</code></td><td className="col-flex"><Link href={`/types/forms/${item.code}`}>{item.label}</Link></td><td>{LEVEL_LABEL[item.level]}</td><td>{item.alwaysExposed ? "무조건" : "선택"}</td><td className="col-num">{item.fields.length}</td><td>{usageCount || "—"}</td></tr>)}</tbody></table>
    </ListShell>
  </div>;
}
