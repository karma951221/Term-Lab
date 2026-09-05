import Link from "next/link";

import { Confirm } from "@/app/_components/Confirm";
import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { IssueList } from "@/app/_components/IssueList";
import { previewOutcome } from "@/app/_lib/rejection";
import { currentActor, getServices } from "@/lib/services";

import {
  addOptionAction,
  addOptionValueAction,
  removeAction,
  renameAction,
  renameOptionAction,
  renameOptionValueAction,
  setBodyAction,
  setDescriptionAction,
} from "../actions";

export const dynamic = "force-dynamic";

export default async function ClauseDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ error?: string; del?: string }>;
}) {
  const { code } = await params;
  const sp = await searchParams;
  const services = getServices();
  const clause = await services.clause.get(code);
  if (!clause) {
    return (
      <div>
        <h1 className="ts-h1">공용조항 {code}</h1>
        <p className="ts-error-banner">찾을 수 없습니다.</p>
      </div>
    );
  }
  const actor = await currentActor();
  const usages = await services.clause.usages(code);
  const recheck = await services.clause.recheck(code);

  let deleteNode = null;
  if (sp.del === "1") {
    const outcome = previewOutcome(await services.clause.remove(actor, code));
    deleteNode =
      outcome.kind === "confirm" ? (
        <Confirm impact={outcome.impact} action={removeAction.bind(null, code)} />
      ) : outcome.kind === "error" ? (
        <p className="ts-error-banner">{outcome.message}</p>
      ) : null;
  }

  return (
    <div>
      <h1 className="ts-h1">
        {clause.label} <code className="ts-muted">{clause.code}</code>
      </h1>
      <ErrorBanner message={sp.error} />
      <p>모드: {clause.mode}</p>

      <h2 className="ts-h2">기본 정보</h2>
      <form action={renameAction.bind(null, code)} className="ts-form">
        <label className="ts-field">
          <span>표시명</span>
          <input type="text" name="label" defaultValue={clause.label} required />
        </label>
        <div className="ts-form-actions">
          <button type="submit">저장</button>
        </div>
      </form>
      <form action={setDescriptionAction.bind(null, code)} className="ts-form">
        <label className="ts-field">
          <span>설명</span>
          <textarea name="description" rows={2} defaultValue={clause.description} />
        </label>
        <div className="ts-form-actions">
          <button type="submit">저장</button>
        </div>
      </form>

      <h2 className="ts-h2">본문</h2>
      <form action={setBodyAction.bind(null, code)} className="ts-form">
        <label className="ts-field">
          <span>본문 JSON</span>
          <textarea name="body" className="ts-json" defaultValue={JSON.stringify(clause.body, null, 2)} />
        </label>
        <div className="ts-form-actions">
          <button type="submit">저장 (요구 구분자 재추출 · 사용처 재검사)</button>
        </div>
      </form>

      <h2 className="ts-h2">요구 구분자</h2>
      <p>{clause.required.discriminators.length > 0 ? clause.required.discriminators.join(", ") : "없음"}</p>

      <h2 className="ts-h2">옵션</h2>
      {clause.options.map((o) => (
        <div key={o.code} className="ts-panel">
          <form action={renameOptionAction.bind(null, code, o.code)} style={{ display: "flex", gap: 4, marginBottom: 8 }}>
            <span>
              {o.code}: <input type="text" name="label" defaultValue={o.label} />
            </span>
            <button type="submit">저장</button>
          </form>
          <ul>
            {o.values.map((v) => (
              <li key={v.code}>
                <form action={renameOptionValueAction.bind(null, code, o.code, v.code)} style={{ display: "flex", gap: 4 }}>
                  <code>{v.code}</code>
                  <input type="text" name="label" defaultValue={v.label} />
                  <button type="submit">저장</button>
                </form>
              </li>
            ))}
          </ul>
          <form action={addOptionValueAction.bind(null, code, o.code)} style={{ display: "flex", gap: 4 }}>
            <input type="text" name="label" placeholder="새 선택지" required />
            <button type="submit">선택지 추가</button>
          </form>
        </div>
      ))}
      <form action={addOptionAction.bind(null, code)} className="ts-form">
        <h2 className="ts-form-title">옵션 추가</h2>
        <label className="ts-field">
          <span>옵션명</span>
          <input type="text" name="label" required />
        </label>
        <label className="ts-field">
          <span>선택지 (콤마로 구분, 2개 이상)</span>
          <input type="text" name="values" placeholder="예: 사망, 해지" required />
        </label>
        <div className="ts-form-actions">
          <button type="submit">추가</button>
        </div>
      </form>

      <h2 className="ts-h2">사용처 ({usages.length})</h2>
      <table className="ts-table">
        <thead>
          <tr>
            <th>문서</th>
            <th>소유 실체</th>
            <th>선택</th>
          </tr>
        </thead>
        <tbody>
          {usages.map((u, i) => (
            <tr key={i}>
              <td>{u.ownerKind}</td>
              <td>{u.ownerName ?? u.ownerId}</td>
              <td>{JSON.stringify(u.selection)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="ts-h2">재검사 결과</h2>
      {recheck.ok && recheck.value.length === 0 && <p className="ts-ok">문제 없음.</p>}
      {recheck.ok &&
        recheck.value.map((entry, i) => (
          <div key={i} className="ts-panel">
            <p>
              {entry.usage.ownerName ?? entry.usage.ownerId} — 미부착: {entry.missing.join(", ") || "없음"}
            </p>
            <IssueList issues={entry.issues} />
          </div>
        ))}

      <h2 className="ts-h2">삭제</h2>
      {sp.del === "1" ? deleteNode : <Link href="?del=1">삭제…</Link>}

      <p style={{ marginTop: 24 }}>
        <Link href="/clauses">← 목록으로</Link>
      </p>
    </div>
  );
}
