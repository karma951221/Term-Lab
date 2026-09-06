/**
 * 담보속성 — 상품담보 작명의 재료(종류 · 유효값 · 명명 조각)와 이름 템플릿.
 *
 * - 저장은 텍스트 버튼, 삭제는 `.danger` 아이콘 버튼 + 「무엇을 · 무엇에」 tooltip (§1.6 · 리뷰 #37).
 *   삭제는 전부 `Confirm` 을 거치고 대상을 「표시명(코드)」로 부른다 (§9.4).
 * - 라벨은 값 왼쪽 120px 고정 열 (`.ts-form-row`) — 라벨을 값 위에 두지 않는다 (리뷰 #51).
 */
import Link from "next/link";

import { Confirm } from "@/app/_components/Confirm";
import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { IconTrash } from "@/app/_components/icons";
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

const BASE = "/attributes";

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
  const missing = missingTemplateKinds(kinds, namingTemplate);

  return (
    <div>
      <h1 className="ts-h1">
        담보속성 <span className="ts-count">종류 {kinds.length}</span>
      </h1>
      <ErrorBanner message={sp.error} />

      <form action={setNamingTemplateAction} className="ts-form">
        <h2 className="ts-form-title">상품담보명 템플릿</h2>
        <div className="ts-form-row">
          <label htmlFor="tmpl">템플릿</label>
          <div className="ts-form-control">
            <input id="tmpl" type="text" name="template" defaultValue={namingTemplate} className="ts-field-direct ts-mono" />
          </div>
        </div>
        <div className="ts-form-row">
          <label>지금 이름</label>
          <div className="ts-form-control">{displayNamingTemplate(namingTemplate, kinds)}</div>
        </div>
        <div className="ts-form-row">
          <label>쓸 수 있는 칩</label>
          <div className="ts-form-control ts-mono">
            [담보명]
            {kinds.map((kind) => ` [${kind.code}](${kind.label})`).join("")}
          </div>
        </div>
        {missing.length > 0 && (
          <div className="ts-form-row">
            <label>템플릿에 없는 종류</label>
            <div className="ts-form-control">
              <span className="ts-badge missing">{missing.map((kind) => kind.label).join(", ")}</span>
            </div>
          </div>
        )}
        <div className="ts-form-actions">
          <button type="submit" className="primary">
            저장
          </button>
        </div>
      </form>

      <form action={createAttributeKindAction} className="ts-form">
        <h2 className="ts-form-title">새 담보속성 종류</h2>
        <div className="ts-form-row">
          <label htmlFor="new-kind">표시명</label>
          <div className="ts-form-control">
            <input id="new-kind" type="text" name="label" className="ts-field-direct" required />
          </div>
        </div>
        <div className="ts-form-actions">
          <button type="submit" className="primary">
            생성
          </button>
        </div>
      </form>

      {kinds.map((k) => {
        const values = [...k.values].sort((a, b) => a.order - b.order);
        return (
          <section key={k.code} className="ts-section">
            <h2 className="ts-section-title">
              {k.label} <code className="ts-mono ts-muted">{k.code}</code>
              <span className="ts-count">값 {values.length}</span>
            </h2>

            <form action={renameAttributeKindAction.bind(null, k.code)} className="ts-form-row">
              <label htmlFor={`rn-${k.code}`}>표시명</label>
              <div className="ts-form-control">
                <input id={`rn-${k.code}`} type="text" name="label" defaultValue={k.label} className="ts-field-direct" required />
                <button type="submit">저장</button>
              </div>
            </form>

            {values.length === 0 ? (
              <div className="ts-empty">
                <p className="ts-empty-what">유효값이 없으면 이 종류는 상품담보 조합에 쓰이지 못한다.</p>
                <p className="ts-empty-example">예: 상해 · 질병 (명명 조각 「[상해]」 · 「[질병]」)</p>
              </div>
            ) : (
              <table className="ts-table">
                <thead>
                  <tr>
                    <th className="col-code">코드</th>
                    <th className="col-flex">표시명</th>
                    <th>명명 조각</th>
                    <th className="col-fixed-sm">조작</th>
                  </tr>
                </thead>
                <tbody>
                  {values.map((v) => (
                    <tr key={v.code}>
                      <td className="col-code">{v.code}</td>
                      <td className="col-flex">
                        <form action={renameAttributeValueAction.bind(null, k.code, v.code)} style={{ display: "flex", gap: 4 }}>
                          <input type="text" name="label" defaultValue={v.label} className="ts-field-direct" required />
                          <button type="submit">저장</button>
                        </form>
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <form action={setNamingFragmentAction.bind(null, k.code, v.code)} style={{ display: "flex", gap: 4 }}>
                          <input
                            type="text"
                            name="fragment"
                            defaultValue={v.fragment}
                            className="ts-field-direct ts-mono"
                            title={`${v.label} 이 상품담보명에 들어갈 때의 조각`}
                          />
                          <button type="submit">저장</button>
                        </form>
                      </td>
                      <td>
                        {delKindCode === k.code && delValueCode === v.code ? null : (
                          <Link
                            href={`?delValue=${k.code}:${v.code}`}
                            className="ts-iconbtn danger"
                            title={`${v.label}(${v.code}) 삭제`}
                            aria-label={`${v.label}(${v.code}) 삭제`}
                          >
                            <IconTrash />
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {delKindCode === k.code && delValueCode && (
              <AttributeValueConfirm
                kindCode={k.code}
                valueCode={delValueCode}
                valueLabel={values.find((v) => v.code === delValueCode)?.label ?? delValueCode}
                actor={actor}
              />
            )}

            <form action={addAttributeValueAction.bind(null, k.code)} className="ts-form-row">
              <label htmlFor={`add-${k.code}`}>값 추가</label>
              <div className="ts-form-control">
                <input id={`add-${k.code}`} type="text" name="label" className="ts-field-direct" placeholder="새 값 표시명" required />
                <input type="text" name="fragment" className="ts-field-direct ts-mono" placeholder="명명 조각" />
                <button type="submit">추가</button>
              </div>
            </form>

            {sp.delKind === k.code ? (
              <AttributeKindConfirm kindCode={k.code} kindLabel={k.label} actor={actor} />
            ) : (
              <div className="ts-form-actions">
                <Link href={`?delKind=${k.code}`} tabIndex={-1}>
                  <button
                    type="button"
                    className="danger"
                    title={`담보속성 종류 ${k.label}(${k.code}) 삭제 — 값 ${values.length}개가 함께 사라진다`}
                  >
                    {k.label} 종류 삭제…
                  </button>
                </Link>
              </div>
            )}
          </section>
        );
      })}

      {kinds.length === 0 && (
        <div className="ts-empty">
          <p className="ts-empty-what">담보속성은 상품담보의 이름을 짓는 재료다 — 종류마다 유효값과 명명 조각을 갖는다.</p>
          <p className="ts-empty-example">예: 재해구분(상해 · 질병) · 지급형태(정액 · 실손)</p>
          <p className="ts-empty-action">위 「새 담보속성 종류」 폼에서 첫 종류를 만든다.</p>
        </div>
      )}
    </div>
  );
}

async function AttributeValueConfirm({
  kindCode,
  valueCode,
  valueLabel,
  actor,
}: {
  kindCode: string;
  valueCode: string;
  valueLabel: string;
  actor: Awaited<ReturnType<typeof currentActor>>;
}) {
  const outcome = previewOutcome(await getServices().product.removeAttributeValue(actor, kindCode, valueCode));
  if (outcome.kind === "confirm")
    return (
      <Confirm
        impact={outcome.impact}
        action={removeAttributeValueAction.bind(null, kindCode, valueCode)}
        targetLabel={`담보속성 값 ${valueLabel}(${valueCode})`}
        actionLabel={`${valueLabel} 삭제`}
        cancelHref={BASE}
      />
    );
  if (outcome.kind === "error") return <p className="ts-error-banner">{outcome.message}</p>;
  return null;
}

async function AttributeKindConfirm({
  kindCode,
  kindLabel,
  actor,
}: {
  kindCode: string;
  kindLabel: string;
  actor: Awaited<ReturnType<typeof currentActor>>;
}) {
  const outcome = previewOutcome(await getServices().product.removeAttributeKind(actor, kindCode));
  if (outcome.kind === "confirm")
    return (
      <Confirm
        impact={outcome.impact}
        action={removeAttributeKindAction.bind(null, kindCode)}
        targetLabel={`담보속성 종류 ${kindLabel}(${kindCode})`}
        actionLabel={`${kindLabel} 삭제`}
        cancelHref={BASE}
      />
    );
  if (outcome.kind === "error") return <p className="ts-error-banner">{outcome.message}</p>;
  return null;
}
