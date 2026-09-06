export interface PageSlice<T> {
  rows: T[];
  total: number;
  page: number;
  pageCount: number;
}

export function includesQuery(query: string, values: readonly string[]): boolean {
  const q = query.trim().toLocaleLowerCase("ko-KR");
  return q === "" || values.some((value) => value.toLocaleLowerCase("ko-KR").includes(q));
}

export function paginate<T>(items: readonly T[], requestedPage: string | number | undefined, pageSize: number): PageSlice<T> {
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const parsed = typeof requestedPage === "number" ? requestedPage : Number(requestedPage);
  const page = Math.min(Math.max(1, Number.isFinite(parsed) ? Math.trunc(parsed) : 1), pageCount);
  return { rows: items.slice((page - 1) * pageSize, page * pageSize), total, page, pageCount };
}

export function changedQuery(current: string, changes: Record<string, string | undefined>, pageParam = "page"): string {
  const params = new URLSearchParams(current);
  for (const [key, value] of Object.entries(changes)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  params.delete(pageParam);
  return params.toString();
}
