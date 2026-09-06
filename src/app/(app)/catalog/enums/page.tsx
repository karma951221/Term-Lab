/**
 * enum 목록 — 선택형 구분자가 고르는 선택지 사전.
 *
 * - 파괴/비파괴의 무게가 다르게 보여야 한다 (리뷰 #37): 저장은 텍스트 버튼, 삭제는 `.danger` 아이콘 버튼 +
 *   「무엇을 · 무엇에」 tooltip (디자인원칙 §1.6). 삭제는 전부 `Confirm` 을 거치고 대상을 이름으로 부른다 (§9.4).
 * - 표는 코드 104px 고정 · 표시명이 남는 폭을 먹는 한 컬럼 (§2 L1).
 */
import Link from "next/link";

import { Confirm } from "@/app/_components/Confirm";
import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { IconTrash } from "@/app/_components/icons";
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

const BASE = "/catalog/enums";

export default async function EnumsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const services = getServices();
  const enums = await services.catalog.listEnums();
  const actor = await currentActor();
  const [delValueEnum, delValueCode] = (sp.delValue ?? "").split(":");

  return (
    <div>
      <h1 className="ts-h1">
        선택지 <span className="ts-count">{enums.length}</span>
      </h1>
      <ErrorBanner message={sp.error} />

      <form action={createEnumAction} className="ts-form">
        <h2 className="ts-form-title">새 선택지</h2>
        <div className="ts-form-row">
          <label htmlFor="new-enum-label">표시명</label>
          <div className="ts-form-control">
            <input id="new-enum-label" type="text" name="label" className="ts-field-direct" required />
          </div>
        </div>
        <div className="ts-form-row">
          <label htmlFor="new-enum-values">초기 값</label>
          <div className="ts-form-control">
            <input
              id="new-enum-values"
              type="text"
              name="values"
              className="ts-field-direct"
              placeholder="예: 일반심사, 간편심사"
              title="콤마로 구분해 여러 개를 한 번에 만든다 (선택)"
            />
          </div>
        </div>
        <div className="ts-form-actions">
          <button type="submit" className="primary">
            생성
          </button>
        </div>
      </form>

      {enums.map((e) => {
        const values = [...e.values].sort((a, b) => a.order - b.order);
        return (
          <section key={e.code} className="ts-section">
            <h2 className="ts-section-title">
              {e.label} <code className="ts-mono ts-muted">{e.code}</code>
              <span className="ts-count">값 {values.length}</span>
            </h2>

            <form action={renameEnumAction.bind(null, e.code)} className="ts-form-row">
              <label htmlFor={`rn-${e.code}`}>표시명</label>
              <div className="ts-form-control">
                <input id={`rn-${e.code}`} type="text" name="label" defaultValue={e.label} className="ts-field-direct" required />
                <button type="submit">저장</button>
              </div>
            </form>

            {values.length === 0 ? (
              <div className="ts-empty">
                <p className="ts-empty-what">값이 없으면 이 선택지를 쓰는 필드는 아무것도 고를 수 없다.</p>
                <p className="ts-empty-example">예: 일반심사 · 간편심사 · 무심사</p>
              </div>
            ) : (
              <table className="ts-table">
                <thead>
                  <tr>
                    <th className="col-code">코드</th>
                    <th className="col-flex">표시명</th>
                    <th className="col-fixed-sm">조작</th>
                  </tr>
                </thead>
                <tbody>
                  {values.map((v) => (
                    <tr key={v.code}>
                      <td className="col-code">{v.code}</td>
                      <td className="col-flex">
                        <form action={renameEnumValueAction.bind(null, e.code, v.code)} style={{ display: "flex", gap: 4 }}>
                          <input type="text" name="label" defaultValue={v.label} className="ts-field-direct" required />
                          <button type="submit">저장</button>
                        </form>
                      </td>
                      <td>
                        {delValueEnum === e.code && delValueCode === v.code ? null : (
                          <Link
                            href={`?delValue=${e.code}:${v.code}`}
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

            {delValueEnum === e.code && delValueCode && (
              <EnumValueConfirm
                enumCode={e.code}
                valueCode={delValueCode}
                valueLabel={values.find((v) => v.code === delValueCode)?.label ?? delValueCode}
                actor={actor}
              />
            )}

            <form action={addEnumValueAction.bind(null, e.code)} className="ts-form-row">
              <label htmlFor={`add-${e.code}`}>값 추가</label>
              <div className="ts-form-control">
                <input id={`add-${e.code}`} type="text" name="label" className="ts-field-direct" placeholder="새 값 표시명" required />
                <button type="submit">추가</button>
              </div>
            </form>

            {sp.delEnum === e.code ? (
              <EnumConfirm enumCode={e.code} enumLabel={e.label} actor={actor} />
            ) : (
              <div className="ts-form-actions">
                <Link href={`?delEnum=${e.code}`} tabIndex={-1}>
                  <button type="button" className="danger" title={`선택지 ${e.label}(${e.code}) 삭제 — 값 ${values.length}개가 함께 사라진다`}>
                    {e.label} 선택지 삭제…
                  </button>
                </Link>
              </div>
            )}
          </section>
        );
      })}

      {enums.length === 0 && (
        <div className="ts-empty">
          <p className="ts-empty-what">선택지는 선택형 구분자가 고르는 값 목록이다.</p>
          <p className="ts-empty-example">예: 고지유형(일반심사 · 간편심사) · 갱신주기(1년 · 3년 · 5년)</p>
          <p className="ts-empty-action">위 「새 선택지」 폼에서 첫 선택지를 만든다.</p>
        </div>
      )}
    </div>
  );
}

async function EnumValueConfirm({
  enumCode,
  valueCode,
  valueLabel,
  actor,
}: {
  enumCode: string;
  valueCode: string;
  valueLabel: string;
  actor: Awaited<ReturnType<typeof currentActor>>;
}) {
  const outcome = previewOutcome(await getServices().catalog.removeEnumValue(actor, enumCode, valueCode));
  if (outcome.kind === "confirm")
    return (
      <Confirm
        impact={outcome.impact}
        action={removeEnumValueAction.bind(null, enumCode, valueCode)}
        targetLabel={`선택지 값 ${valueLabel}(${valueCode})`}
        actionLabel={`${valueLabel} 삭제`}
        cancelHref={BASE}
      />
    );
  if (outcome.kind === "error") return <p className="ts-error-banner">{outcome.message}</p>;
  return null;
}

async function EnumConfirm({ enumCode, enumLabel, actor }: { enumCode: string; enumLabel: string; actor: Awaited<ReturnType<typeof currentActor>> }) {
  const outcome = previewOutcome(await getServices().catalog.removeEnum(actor, enumCode));
  if (outcome.kind === "confirm")
    return (
      <Confirm
        impact={outcome.impact}
        action={removeEnumAction.bind(null, enumCode)}
        targetLabel={`선택지 ${enumLabel}(${enumCode})`}
        actionLabel={`${enumLabel} 삭제`}
        cancelHref={BASE}
      />
    );
  if (outcome.kind === "error") return <p className="ts-error-banner">{outcome.message}</p>;
  return null;
}
