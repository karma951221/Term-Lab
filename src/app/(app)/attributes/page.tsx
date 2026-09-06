import Link from "next/link";

import { Confirm } from "@/app/_components/Confirm";
import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { previewOutcome } from "@/app/_lib/rejection";
import { displayNamingTemplate, missingTemplateKinds } from "@/domain/product";
import { currentActor, getServices } from "@/lib/services";

import {
  addAttributeValueAction,
  createAttributeKindAction,
  removeAttributeKindAction,
  removeAttributeValueAction,
  renameAttributeKindAction,
  renameAttributeValueAction,
  setNamingFragmentAction,
  setNamingTemplateAction,
} from "./actions";

export const dynamic = "force-dynamic";

interface SearchParams {
  error?: string;
  delKind?: string;
  delValue?: string; // `${kindCode}:${valueCode}`
}

export default async function AttributesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const services = getServices();
  const [kinds, namingTemplate] = await Promise.all([services.product.listAttributeKinds(), services.product.getNamingTemplate()]);
  const actor = await currentActor();
  const [delKindCode, delValueCode] = (sp.delValue ?? "").split(":");

  return (
    <div>
      <h1 className="ts-h1">담보속성</h1>
      <ErrorBanner message={sp.error} />

      <form action={setNamingTemplateAction} className="ts-form">
        <h2 className="ts-form-title">상품담보명 템플릿</h2>
        <label className="ts-field">
          <span>템플릿</span>
          <input type="text" name="template" defaultValue={namingTemplate} />
        </label>
        <p className="ts-muted">표시: {displayNamingTemplate(namingTemplate, kinds)}</p>
        {missingTemplateKinds(kinds, namingTemplate).length > 0 && (
          <p className="ts-muted">템플릿에 없는 종류: {missingTemplateKinds(kinds, namingTemplate).map((kind) => kind.label).join(", ")}</p>
        )}
        <p className="ts-muted">사용 가능한 칩: [담보명]{kinds.map((kind) => ` [${kind.code}](${kind.label})`).join("")}</p>
        <div className="ts-form-actions"><button type="submit">템플릿 저장</button></div>
      </form>

      <form action={createAttributeKindAction} className="ts-form">
        <h2 className="ts-form-title">새 담보속성 종류</h2>
        <label className="ts-field">
          <span>표시명</span>
          <input type="text" name="label" required />
        </label>
        <div className="ts-form-actions">
          <button type="submit">생성</button>
        </div>
      </form>

      {kinds.map((k) => (
        <div key={k.code} className="ts-panel">
          <h2 className="ts-h2">
            {k.label} <code className="ts-muted">{k.code}</code>
          </h2>
          <form action={renameAttributeKindAction.bind(null, k.code)} style={{ display: "flex", gap: 4, marginBottom: 8 }}>
            <input type="text" name="label" defaultValue={k.label} />
            <button type="submit">이름 저장</button>
          </form>

          <table className="ts-table">
            <thead>
              <tr>
                <th>코드</th>
                <th>표시명</th>
                <th>명명 조각</th>
                <th>조작</th>
              </tr>
            </thead>
            <tbody>
              {[...k.values]
                .sort((a, b) => a.order - b.order)
                .map((v) => (
                  <tr key={v.code}>
                    <td>
                      <code>{v.code}</code>
                    </td>
                    <td>
                      <form action={renameAttributeValueAction.bind(null, k.code, v.code)} style={{ display: "flex", gap: 4 }}>
                        <input type="text" name="label" defaultValue={v.label} />
                        <button type="submit">저장</button>
                      </form>
                    </td>
                    <td>
                      <form action={setNamingFragmentAction.bind(null, k.code, v.code)} style={{ display: "flex", gap: 4 }}>
                        <input type="text" name="fragment" placeholder="명명 조각" defaultValue={v.fragment} />
                        <button type="submit">저장</button>
                      </form>
                    </td>
                    <td>
                      {delKindCode === k.code && delValueCode === v.code ? (
                        <AttributeValueConfirm kindCode={k.code} valueCode={v.code} actor={actor} />
                      ) : (
                        <Link href={`?delValue=${k.code}:${v.code}`}>삭제</Link>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          <form action={addAttributeValueAction.bind(null, k.code)} style={{ display: "flex", gap: 4, marginTop: 8 }}>
            <input type="text" name="label" placeholder="새 값 표시명" required />
            <input type="text" name="fragment" placeholder="명명 조각" />
            <button type="submit">값 추가</button>
          </form>

          {sp.delKind === k.code ? (
            <AttributeKindConfirm kindCode={k.code} actor={actor} />
          ) : (
            <p style={{ marginTop: 8 }}>
              <Link href={`?delKind=${k.code}`}>종류 삭제…</Link>
            </p>
          )}
        </div>
      ))}
      {kinds.length === 0 && <p className="ts-muted">아직 담보속성이 없습니다.</p>}
    </div>
  );
}

async function AttributeValueConfirm({ kindCode, valueCode, actor }: { kindCode: string; valueCode: string; actor: Awaited<ReturnType<typeof currentActor>> }) {
  const r = await getServices().product.removeAttributeValue(actor, kindCode, valueCode);
  const outcome = previewOutcome(r);
  if (outcome.kind === "confirm") return <Confirm impact={outcome.impact} action={removeAttributeValueAction.bind(null, kindCode, valueCode)} />;
  if (outcome.kind === "error") return <p className="ts-error-banner">{outcome.message}</p>;
  return null;
}

async function AttributeKindConfirm({ kindCode, actor }: { kindCode: string; actor: Awaited<ReturnType<typeof currentActor>> }) {
  const r = await getServices().product.removeAttributeKind(actor, kindCode);
  const outcome = previewOutcome(r);
  if (outcome.kind === "confirm") return <Confirm impact={outcome.impact} action={removeAttributeKindAction.bind(null, kindCode)} />;
  if (outcome.kind === "error") return <p className="ts-error-banner">{outcome.message}</p>;
  return null;
}
