import Link from "next/link";

import { Confirm } from "@/app/_components/Confirm";
import { EmptyState } from "@/app/_components/EmptyState";
import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { ListShell } from "@/app/_components/ListShell";
import { previewOutcome } from "@/app/_lib/rejection";
import { currentActor, getServices } from "@/lib/services";

import { createAppendixAction, removeAppendixAction, renameAppendixAction, setAppendixDescriptionAction } from "./actions";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 50;

export default async function AppendicesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; del?: string; q?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const services = getServices();
  const list = await services.document.listAppendices();
  const actor = await currentActor();

  let deleteNode = null;
  if (sp.del) {
    const outcome = previewOutcome(await services.document.removeAppendix(actor, sp.del));
    deleteNode =
      outcome.kind === "confirm" ? (
        <Confirm impact={outcome.impact} action={removeAppendixAction.bind(null, sp.del)} />
      ) : outcome.kind === "error" ? (
        <p className="ts-error-banner">{outcome.message}</p>
      ) : null;
  }

  const q = (sp.q ?? "").trim();
  const filtered = q ? list.filter((a) => a.code.toLowerCase().includes(q.toLowerCase()) || a.name.includes(q)) : list;
  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, Number(sp.page) || 1), pageCount);
  const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <h1 className="ts-h1">별표</h1>
      <ErrorBanner message={sp.error} />

      <form id="create-appendix-form" action={createAppendixAction} className="ts-form">
        <h2 className="ts-form-title">새 별표</h2>
        <div className="ts-form-row">
          <label className="ts-form-label" htmlFor="appx-code">
            코드 (유저 입력 · 등록 후 불변)
          </label>
          <div className="ts-form-control">
            <input id="appx-code" type="text" name="code" required />
          </div>
        </div>
        <div className="ts-form-row">
          <label className="ts-form-label" htmlFor="appx-name">
            이름
          </label>
          <div className="ts-form-control">
            <input id="appx-name" type="text" name="name" required />
          </div>
        </div>
        <div className="ts-form-row">
          <label className="ts-form-label" htmlFor="appx-desc">
            설명
          </label>
          <div className="ts-form-control">
            <textarea id="appx-desc" name="description" rows={2} />
          </div>
        </div>
        <div className="ts-form-actions">
          <button type="submit" className="primary">
            생성
          </button>
        </div>
      </form>

      <ListShell
        filters={
          <label>
            검색
            <input type="text" name="q" defaultValue={q} placeholder="코드 · 이름" />
          </label>
        }
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        basePath="/appendices"
        query={{ q }}
        empty={
          list.length === 0 ? (
            <EmptyState
              what="별표는 책자가 참조한 표·서식을 모아 마지막에 수록하는 독립 마스터다."
              example="장해분류표"
              actionHref="#create-appendix-form"
              actionLabel="위 양식에서 새 별표 만들기"
            />
          ) : (
            <p className="ts-empty-what">이 조건에 맞는 별표가 없습니다.</p>
          )
        }
      >
        <table className="ts-table">
          <thead>
            <tr>
              <th className="col-code">코드</th>
              <th className="col-fixed-md">이름</th>
              <th className="col-flex">설명</th>
              <th className="col-fixed-sm">삭제</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.code}>
                <td className="col-code">
                  <code>{a.code}</code>
                </td>
                <td className="col-fixed-md">
                  <form action={renameAppendixAction.bind(null, a.code)} style={{ display: "flex", gap: 4 }}>
                    <input type="text" name="name" defaultValue={a.name} style={{ minWidth: 0, flex: 1 }} />
                    <button type="submit">저장</button>
                  </form>
                </td>
                <td className="col-flex">
                  <form action={setAppendixDescriptionAction.bind(null, a.code)} style={{ display: "flex", gap: 4 }}>
                    <input type="text" name="description" defaultValue={a.description} style={{ minWidth: 0, flex: 1 }} />
                    <button type="submit">저장</button>
                  </form>
                </td>
                <td className="col-fixed-sm">{sp.del === a.code ? deleteNode : <Link href={`?del=${a.code}`}>삭제…</Link>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ListShell>
    </div>
  );
}
