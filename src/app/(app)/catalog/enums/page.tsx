import Link from "next/link";

import { Confirm } from "@/app/_components/Confirm";
import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { previewOutcome } from "@/app/_lib/rejection";
import { currentActor, getServices } from "@/lib/services";

import {
  addEnumValueAction,
  createEnumAction,
  removeEnumAction,
  removeEnumValueAction,
  renameEnumAction,
  renameEnumValueAction,
} from "../actions";

export const dynamic = "force-dynamic";

interface SearchParams {
  error?: string;
  delEnum?: string;
  delValue?: string; // `${enumCode}:${valueCode}`
}

export default async function EnumsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const services = getServices();
  const enums = await services.catalog.listEnums();
  const actor = await currentActor();
  const [delValueEnum, delValueCode] = (sp.delValue ?? "").split(":");

  return (
    <div>
      <h1 className="ts-h1">enum 목록</h1>
      <ErrorBanner message={sp.error} />

      <form action={createEnumAction} className="ts-form">
        <h2 className="ts-form-title">새 enum</h2>
        <label className="ts-field">
          <span>표시명</span>
          <input type="text" name="label" required />
        </label>
        <label className="ts-field">
          <span>초기 값 (콤마로 구분, 선택)</span>
          <input type="text" name="values" placeholder="예: 일반심사, 간편심사" />
        </label>
        <div className="ts-form-actions">
          <button type="submit">생성</button>
        </div>
      </form>

      {enums.map((e) => (
        <div key={e.code} className="ts-panel">
          <h2 className="ts-h2">
            {e.label} <code className="ts-muted">{e.code}</code>
          </h2>
          <form action={renameEnumAction.bind(null, e.code)} style={{ display: "flex", gap: 4, marginBottom: 8 }}>
            <input type="text" name="label" defaultValue={e.label} />
            <button type="submit">이름 저장</button>
          </form>
          <table className="ts-table">
            <thead>
              <tr>
                <th>코드</th>
                <th>표시명</th>
                <th>조작</th>
              </tr>
            </thead>
            <tbody>
              {[...e.values]
                .sort((a, b) => a.order - b.order)
                .map((v) => (
                  <tr key={v.code}>
                    <td>
                      <code>{v.code}</code>
                    </td>
                    <td>
                      <form action={renameEnumValueAction.bind(null, e.code, v.code)} style={{ display: "flex", gap: 4 }}>
                        <input type="text" name="label" defaultValue={v.label} />
                        <button type="submit">저장</button>
                      </form>
                    </td>
                    <td>
                      {delValueEnum === e.code && delValueCode === v.code ? null : <Link href={`?delValue=${e.code}:${v.code}`}>삭제</Link>}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {delValueEnum === e.code &&
            delValueCode &&
            (() => {
              return <EnumValueConfirm enumCode={e.code} valueCode={delValueCode} actor={actor} />;
            })()}
          <form action={addEnumValueAction.bind(null, e.code)} style={{ display: "flex", gap: 4, marginTop: 8 }}>
            <input type="text" name="label" placeholder="새 값 표시명" required />
            <button type="submit">값 추가</button>
          </form>

          {sp.delEnum === e.code ? (
            <EnumConfirm enumCode={e.code} actor={actor} />
          ) : (
            <p style={{ marginTop: 8 }}>
              <Link href={`?delEnum=${e.code}`}>enum 삭제…</Link>
            </p>
          )}
        </div>
      ))}
      {enums.length === 0 && <p className="ts-muted">아직 enum 이 없습니다.</p>}
    </div>
  );
}

async function EnumValueConfirm({ enumCode, valueCode, actor }: { enumCode: string; valueCode: string; actor: Awaited<ReturnType<typeof currentActor>> }) {
  const r = await getServices().catalog.removeEnumValue(actor, enumCode, valueCode);
  const outcome = previewOutcome(r);
  if (outcome.kind === "confirm") return <Confirm impact={outcome.impact} action={removeEnumValueAction.bind(null, enumCode, valueCode)} />;
  if (outcome.kind === "error") return <p className="ts-error-banner">{outcome.message}</p>;
  return null;
}

async function EnumConfirm({ enumCode, actor }: { enumCode: string; actor: Awaited<ReturnType<typeof currentActor>> }) {
  const r = await getServices().catalog.removeEnum(actor, enumCode);
  const outcome = previewOutcome(r);
  if (outcome.kind === "confirm") return <Confirm impact={outcome.impact} action={removeEnumAction.bind(null, enumCode)} />;
  if (outcome.kind === "error") return <p className="ts-error-banner">{outcome.message}</p>;
  return null;
}
