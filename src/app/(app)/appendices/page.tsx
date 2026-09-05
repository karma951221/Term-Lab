import Link from "next/link";

import { Confirm } from "@/app/_components/Confirm";
import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { previewOutcome } from "@/app/_lib/rejection";
import { currentActor, getServices } from "@/lib/services";

import { createAppendixAction, removeAppendixAction, renameAppendixAction, setAppendixDescriptionAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function AppendicesPage({ searchParams }: { searchParams: Promise<{ error?: string; del?: string }> }) {
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

  return (
    <div>
      <h1 className="ts-h1">별표</h1>
      <ErrorBanner message={sp.error} />

      <form action={createAppendixAction} className="ts-form">
        <h2 className="ts-form-title">새 별표</h2>
        <label className="ts-field">
          <span>코드 (유저 입력 · 등록 후 불변)</span>
          <input type="text" name="code" required />
        </label>
        <label className="ts-field">
          <span>이름</span>
          <input type="text" name="name" required />
        </label>
        <label className="ts-field">
          <span>설명</span>
          <textarea name="description" rows={2} />
        </label>
        <div className="ts-form-actions">
          <button type="submit">생성</button>
        </div>
      </form>

      <table className="ts-table">
        <thead>
          <tr>
            <th>코드</th>
            <th>이름</th>
            <th>설명</th>
            <th>삭제</th>
          </tr>
        </thead>
        <tbody>
          {list.map((a) => (
            <tr key={a.code}>
              <td>
                <code>{a.code}</code>
              </td>
              <td>
                <form action={renameAppendixAction.bind(null, a.code)} style={{ display: "flex", gap: 4 }}>
                  <input type="text" name="name" defaultValue={a.name} />
                  <button type="submit">저장</button>
                </form>
              </td>
              <td>
                <form action={setAppendixDescriptionAction.bind(null, a.code)} style={{ display: "flex", gap: 4 }}>
                  <input type="text" name="description" defaultValue={a.description} />
                  <button type="submit">저장</button>
                </form>
              </td>
              <td>{sp.del === a.code ? deleteNode : <Link href={`?del=${a.code}`}>삭제…</Link>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {list.length === 0 && <p className="ts-muted">아직 별표가 없습니다.</p>}
    </div>
  );
}
