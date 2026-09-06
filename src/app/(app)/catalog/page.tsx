import Link from "next/link";

import { ColumnFilter, ListFilterBar, type ColumnFilterSpec } from "@/app/_components/ListFilters";
import { EmptyState } from "@/app/_components/EmptyState";
import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { IconPlus } from "@/app/_components/icons";
import { ListShell } from "@/app/_components/ListShell";
import { KIND_LABEL, LEVEL_LABEL, label } from "@/app/_lib/labels";
import { includesQuery, paginate } from "@/app/_lib/list";
import type { DiscriminatorKind } from "@/domain/catalog/types";
import type { AttachLevel } from "@/domain/types";
import { getServices } from "@/lib/services";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const KINDS: readonly DiscriminatorKind[] = ["scalar", "struct", "const", "derived"];
const LEVELS: readonly AttachLevel[] = ["product", "plan", "coverage", "subCoverage", "benefit"];
const FILTERS = [
  { key: "kind", label: "종류", options: KINDS.map((value) => ({ value, label: KIND_LABEL[value] })) },
  { key: "level", label: "레벨", options: LEVELS.map((value) => ({ value, label: LEVEL_LABEL[value] })) },
  { key: "exposure", label: "노출", options: [{ value: "always", label: "무조건" }, { value: "optional", label: "선택" }] },
] as const satisfies readonly ColumnFilterSpec[];

interface SearchParams {
  error?: string;
  q?: string;
  kind?: string;
  level?: string;
  exposure?: string;
  page?: string;
}

function todayInSeoul(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export default async function CatalogListPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const defs = await getServices().catalog.list();
  const q = (sp.q ?? "").trim();
  const kind = sp.kind ?? "";
  const level = sp.level ?? "";
  const exposure = sp.exposure ?? "";
  const filtered = defs.filter((d) => {
    if (!includesQuery(q, [d.code, d.label])) return false;
    if (kind && d.kind !== kind) return false;
    if (level && (d.kind === "const" || d.level !== level)) return false;
    if (exposure) {
      if (d.kind !== "scalar" && d.kind !== "struct") return false;
      if ((exposure === "always") !== d.alwaysExposed) return false;
    }
    return true;
  });
  const { rows, total, page } = paginate(filtered, sp.page, PAGE_SIZE);
  const createParams = new URLSearchParams();
  if (kind) createParams.set("kind", kind);
  if (level) createParams.set("level", level);
  const createHref = `/catalog/new${createParams.size ? `?${createParams}` : ""}`;

  return (
    <div>
      <ErrorBanner message={sp.error} />
      <ListShell
        heading={
          <div className="ts-list-head">
            <h1 className="ts-h1">구분자</h1>
            <Link href={createHref} className="ts-iconbtn" title="새 구분자" aria-label="새 구분자"><IconPlus /></Link>
          </div>
        }
        filters={<ListFilterBar placeholder="코드 · 표시명" filters={FILTERS} today={todayInSeoul()} />}
        interactiveFilters
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        basePath="/catalog"
        query={{ q, kind, level, exposure }}
        empty={defs.length === 0 ? (
          <EmptyState what="구분자는 값의 정의 단위다 — 문면이 묻는 개념 하나에 구분자 하나를 짝짓는다." example="갱신여부(담보 레벨) · 고지유형(상품 레벨)" actionHref="/catalog/new" actionLabel="새 구분자 만들기" />
        ) : <p className="ts-empty-what">이 조건에 맞는 구분자가 없습니다.</p>}
      >
        <table className="ts-table">
          <thead><tr>
            <th className="col-code">코드</th>
            <th className="col-flex">표시명</th>
            <th className="col-fixed-sm"><ColumnFilter spec={FILTERS[0]} /></th>
            <th className="col-fixed-sm"><ColumnFilter spec={FILTERS[1]} /></th>
            <th className="col-fixed-sm"><ColumnFilter spec={FILTERS[2]} /></th>
          </tr></thead>
          <tbody>{rows.map((d) => (
            <tr key={d.code}>
              <td className="col-code"><code>{d.code}</code></td>
              <td className="col-flex"><Link href={`/catalog/${d.code}`}>{d.label}</Link></td>
              <td className="col-fixed-sm">{KIND_LABEL[d.kind]}</td>
              <td className="col-fixed-sm">{d.kind !== "const" ? label(LEVEL_LABEL, d.level) : "—"}</td>
              <td className="col-fixed-sm">{d.kind === "scalar" || d.kind === "struct" ? (d.alwaysExposed ? "무조건" : "선택") : "—"}</td>
            </tr>
          ))}</tbody>
        </table>
      </ListShell>
    </div>
  );
}
