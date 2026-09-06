"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { IconClose, IconSearch } from "./icons";
import { changedQuery } from "../_lib/list";

export interface FilterOption {
  value: string;
  label: string;
}

export interface ColumnFilterSpec {
  key: string;
  label: string;
  options: readonly FilterOption[];
}

function useListQuery() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const replace = useCallback((changes: Record<string, string | undefined>) => {
    const query = changedQuery(searchParams.toString(), changes);
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);
  return { searchParams, replace };
}

export function ListFilterBar({
  placeholder,
  filters,
  today,
}: {
  placeholder: string;
  filters: readonly ColumnFilterSpec[];
  today: string;
}) {
  const { searchParams, replace } = useListQuery();
  const urlQuery = searchParams.get("q") ?? "";
  const composing = useRef(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);
  const schedule = (value: string) => {
    window.clearTimeout(timer.current);
    if (value === urlQuery) return;
    timer.current = window.setTimeout(() => replace({ q: value.trim() || undefined }), 300);
  };

  const active = filters.flatMap((filter) => {
    const value = searchParams.get(filter.key);
    const option = filter.options.find((item) => item.value === value);
    return option ? [{ filter, option }] : [];
  });

  return (
    <div className="ts-filterbar-stack">
      <div className="ts-filterbar">
        <label className="ts-searchbox">
          <IconSearch />
          <span className="sr-only">검색</span>
          <input
            type="search"
            key={urlQuery}
            defaultValue={urlQuery}
            placeholder={placeholder}
            onChange={(event) => {
              if (!composing.current) schedule(event.target.value);
            }}
            onCompositionStart={() => {
              composing.current = true;
              window.clearTimeout(timer.current);
            }}
            onCompositionEnd={(event) => {
              composing.current = false;
              schedule(event.currentTarget.value);
            }}
          />
        </label>
        <span className="ts-filterbar-spacer" />
        {active.length > 1 ? (
          <button type="button" className="ts-filter-clear" onClick={() => replace(Object.fromEntries(filters.map((f) => [f.key, undefined])))}>
            모두 지우기
          </button>
        ) : null}
        <label title="이력 기능 준비 중">
          기준일
          <input type="date" value={today} disabled aria-label="기준일 · 이력 기능 준비 중" />
        </label>
        <label title="이력 기능 준비 중">
          <input type="checkbox" disabled aria-label="미확정 포함 · 이력 기능 준비 중" /> 미확정 포함
        </label>
      </div>
      {active.length > 0 ? (
        <div className="ts-chips" aria-label="적용된 필터">
          {active.map(({ filter, option }) => (
            <span className="ts-chip" key={filter.key}>
              {filter.label}: {option.label}
              <button type="button" title={`${filter.label} 필터 해제`} aria-label={`${filter.label} 필터 해제`} onClick={() => replace({ [filter.key]: undefined })}>
                <IconClose />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ColumnFilter({ spec }: { spec: ColumnFilterSpec }) {
  const { searchParams, replace } = useListQuery();
  const details = useRef<HTMLDetailsElement>(null);
  const active = Boolean(searchParams.get(spec.key));
  return (
    <details className="ts-colfilter" ref={details}>
      <summary aria-label={`${spec.label} 필터`}>{spec.label} {active ? "▼" : "▾"}</summary>
      <div className="ts-colfilter-popover">
        {spec.options.map((option) => (
          <button
            type="button"
            key={option.value}
            aria-pressed={searchParams.get(spec.key) === option.value}
            onClick={() => {
              replace({ [spec.key]: option.value });
              details.current?.removeAttribute("open");
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
    </details>
  );
}
