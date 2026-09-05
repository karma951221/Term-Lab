import Link from "next/link";
import type { ReactNode } from "react";

import { Confirm } from "@/app/_components/Confirm";
import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { previewOutcome } from "@/app/_lib/rejection";
import { ATTACH_LEVEL_LABEL } from "@/domain/types";
import { currentActor, getServices } from "@/lib/services";

import {
  addFieldAction,
  changeFieldTypeAction,
  changeScalarTypeAction,
  removeAction,
  removeFieldAction,
  renameAction,
  renameFieldAction,
  setAlwaysExposedAction,
  setConstValueAction,
  setDefaultValueAction,
  setDescriptionAction,
  setExpressionAction,
  setFieldDefaultValueAction,
} from "../actions";
import { fieldTypeFrom } from "../lib";

export const dynamic = "force-dynamic";

interface SearchParams {
  error?: string;
  del?: string;
  delField?: string;
  newType?: string;
  newEnum?: string;
  field?: string;
}

function TypeKindSelect({ defaultValue = "" }: { defaultValue?: string }) {
  return (
    <select name="typeKind" defaultValue={defaultValue} required>
      <option value="string">string</option>
      <option value="number">number</option>
      <option value="boolean">boolean</option>
      <option value="date">date</option>
      <option value="enum">enum</option>
      <option value="list<enum>">list&lt;enum&gt;</option>
    </select>
  );
}

function coordText(at: { document?: string; ownerName?: string; ownerId?: string; articleTitle?: string; refPath?: string }): string {
  return [at.document, at.ownerName ?? at.ownerId, at.articleTitle, at.refPath].filter(Boolean).join(" · ") || "—";
}

export default async function CatalogDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { code } = await params;
  const sp = await searchParams;
  const services = getServices();
  const def = await services.catalog.get(code);
  if (!def) {
    return (
      <div>
        <h1 className="ts-h1">구분자 {code}</h1>
        <p className="ts-error-banner">찾을 수 없습니다.</p>
      </div>
    );
  }
  const enums = await services.catalog.listEnums();
  const usages = await services.refs.usages({ kind: "discriminator", code });
  const actor = await currentActor();

  // ── 파괴적 액션 미리보기 (읽기 전용 — confirm 없이 호출해 Impact 만 얻는다)
  let removeNode: ReactNode = (
    <Link href="?del=1">
      <button type="button">삭제…</button>
    </Link>
  );
  if (sp.del === "1") {
    const outcome = previewOutcome(await services.catalog.remove(actor, code));
    removeNode =
      outcome.kind === "confirm" ? (
        <Confirm impact={outcome.impact} action={removeAction.bind(null, code)} />
      ) : outcome.kind === "error" ? (
        <p className="ts-error-banner">{outcome.message}</p>
      ) : null;
  }

  let scalarTypeChangeNode: ReactNode = null;
  if (def.kind === "scalar") {
    if (sp.newType && !sp.field) {
      const type = fieldTypeFrom(sp.newType, sp.newEnum ?? "");
      if (!type) {
        scalarTypeChangeNode = <p className="ts-error-banner">타입을 확인하세요.</p>;
      } else {
        const outcome = previewOutcome(await services.catalog.changeScalarType(actor, code, type));
        scalarTypeChangeNode =
          outcome.kind === "confirm" ? (
            <Confirm impact={outcome.impact} action={changeScalarTypeAction.bind(null, code, type)} />
          ) : outcome.kind === "error" ? (
            <p className="ts-error-banner">{outcome.message}</p>
          ) : null;
      }
    } else {
      scalarTypeChangeNode = (
        <form method="get" className="ts-form">
          <label className="ts-field">
            <span>새 타입</span>
            <TypeKindSelect />
          </label>
          <label className="ts-field">
            <span>enum 대상 (enum 류일 때)</span>
            <select name="newEnum" defaultValue="">
              <option value="">—</option>
              {enums.map((e) => (
                <option key={e.code} value={e.code}>
                  {e.label} ({e.code})
                </option>
              ))}
            </select>
          </label>
          <div className="ts-form-actions">
            <button type="submit">미리보기</button>
          </div>
        </form>
      );
    }
  }

  const fieldNodes = new Map<string, ReactNode>();
  if (def.kind === "struct") {
    for (const f of def.fields) {
      if (sp.delField === f.code) {
        const outcome = previewOutcome(await services.catalog.removeField(actor, code, f.code));
        fieldNodes.set(
          f.code,
          outcome.kind === "confirm" ? (
            <Confirm impact={outcome.impact} action={removeFieldAction.bind(null, code, f.code)} />
          ) : outcome.kind === "error" ? (
            <span className="ts-error-banner">{outcome.message}</span>
          ) : null,
        );
      } else if (sp.field === f.code && sp.newType) {
        const type = fieldTypeFrom(sp.newType, sp.newEnum ?? "");
        if (!type) {
          fieldNodes.set(f.code, <span className="ts-error-banner">타입을 확인하세요.</span>);
        } else {
          const outcome = previewOutcome(await services.catalog.changeFieldType(actor, code, f.code, type));
          fieldNodes.set(
            f.code,
            outcome.kind === "confirm" ? (
              <Confirm impact={outcome.impact} action={changeFieldTypeAction.bind(null, code, f.code, type)} />
            ) : outcome.kind === "error" ? (
              <span className="ts-error-banner">{outcome.message}</span>
            ) : null,
          );
        }
      } else {
        fieldNodes.set(
          f.code,
          <>
            <form method="get" style={{ display: "inline-flex", gap: 4 }}>
              <input type="hidden" name="field" value={f.code} />
              <select name="newType" defaultValue={f.type.kind}>
                <option value="string">string</option>
                <option value="number">number</option>
                <option value="boolean">boolean</option>
                <option value="date">date</option>
                <option value="enum">enum</option>
                <option value="list<enum>">list&lt;enum&gt;</option>
              </select>
              <select name="newEnum" defaultValue={f.type.kind === "enum" || f.type.kind === "list<enum>" ? f.type.enumCode : ""}>
                <option value="">—</option>
                {enums.map((e) => (
                  <option key={e.code} value={e.code}>
                    {e.code}
                  </option>
                ))}
              </select>
              <button type="submit">타입 변경…</button>
            </form>
            {" · "}
            <Link href={`?delField=${f.code}`}>삭제</Link>
          </>,
        );
      }
    }
  }

  return (
    <div>
      <h1 className="ts-h1">
        {def.label} <code className="ts-muted">{def.code}</code>
      </h1>
      <ErrorBanner message={sp.error} />

      <h2 className="ts-h2">기본 정보</h2>
      <div className="ts-panel">
        <p>
          종류: {def.kind}
          {def.kind !== "const" && <> · 레벨: {ATTACH_LEVEL_LABEL[def.level]}</>}
        </p>
        <form action={renameAction.bind(null, code)} className="ts-form">
          <label className="ts-field">
            <span>표시명</span>
            <input type="text" name="label" defaultValue={def.label} required />
          </label>
          <div className="ts-form-actions">
            <button type="submit">저장</button>
          </div>
        </form>
        <form action={setDescriptionAction.bind(null, code)} className="ts-form">
          <label className="ts-field">
            <span>설명</span>
            <textarea name="description" rows={2} defaultValue={def.description} />
          </label>
          <div className="ts-form-actions">
            <button type="submit">저장</button>
          </div>
        </form>

        {(def.kind === "scalar" || def.kind === "struct") && (
          <form action={setAlwaysExposedAction.bind(null, code)} className="ts-form">
            <label className="ts-field">
              <span>
                <input type="checkbox" name="alwaysExposed" defaultChecked={def.alwaysExposed} /> 무조건 노출
              </span>
            </label>
            <div className="ts-form-actions">
              <button type="submit">저장</button>
            </div>
          </form>
        )}
      </div>

      {def.kind === "scalar" && (
        <>
          <h2 className="ts-h2">타입 · 기본값</h2>
          <div className="ts-panel">
            <p>
              현재 타입: <code>{def.type.kind}</code>
              {(def.type.kind === "enum" || def.type.kind === "list<enum>") && ` (${def.type.enumCode})`}
            </p>
            <form action={setDefaultValueAction.bind(null, code)} className="ts-form">
              <label className="ts-field">
                <span>기본값 (비우면 없음)</span>
                <input type="text" name="defaultValue" defaultValue={def.defaultValue === undefined ? "" : String(def.defaultValue)} />
              </label>
              <div className="ts-form-actions">
                <button type="submit">저장</button>
              </div>
            </form>
            <p className="ts-muted">타입 변경은 파괴적 액션입니다 — 저장된 값이 전부 삭제됩니다.</p>
            {scalarTypeChangeNode}
          </div>
        </>
      )}

      {def.kind === "const" && (
        <>
          <h2 className="ts-h2">값</h2>
          <form action={setConstValueAction.bind(null, code)} className="ts-form">
            <label className="ts-field">
              <span>값</span>
              <input type="text" name="value" defaultValue={def.value} required />
            </label>
            <div className="ts-form-actions">
              <button type="submit">저장</button>
            </div>
          </form>
        </>
      )}

      {def.kind === "derived" && (
        <>
          <h2 className="ts-h2">식</h2>
          <form action={setExpressionAction.bind(null, code)} className="ts-form">
            <label className="ts-field">
              <span>식</span>
              <input type="text" name="expression" defaultValue={def.expression} required />
            </label>
            <div className="ts-form-actions">
              <button type="submit">저장 전 검사 · 저장</button>
            </div>
          </form>
        </>
      )}

      {def.kind === "struct" && (
        <>
          <h2 className="ts-h2">필드 ({def.fields.length})</h2>
          <table className="ts-table">
            <thead>
              <tr>
                <th>코드</th>
                <th>표시명</th>
                <th>타입</th>
                <th>기본값</th>
                <th>조작</th>
              </tr>
            </thead>
            <tbody>
              {[...def.fields]
                .sort((a, b) => a.order - b.order)
                .map((f) => (
                  <tr key={f.code}>
                    <td>
                      <code>{f.code}</code>
                    </td>
                    <td>
                      <form action={renameFieldAction.bind(null, code, f.code)} style={{ display: "flex", gap: 4 }}>
                        <input type="text" name="label" defaultValue={f.label} />
                        <button type="submit">이름 저장</button>
                      </form>
                    </td>
                    <td>
                      {f.type.kind}
                      {(f.type.kind === "enum" || f.type.kind === "list<enum>") && ` (${f.type.enumCode})`}
                    </td>
                    <td>
                      <form action={setFieldDefaultValueAction.bind(null, code, f.code)} style={{ display: "flex", gap: 4 }}>
                        <input type="text" name="defaultValue" defaultValue={f.defaultValue === undefined ? "" : String(f.defaultValue)} />
                        <button type="submit">저장</button>
                      </form>
                    </td>
                    <td>{fieldNodes.get(f.code)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <form action={addFieldAction.bind(null, code)} className="ts-form">
            <h2 className="ts-form-title">필드 추가</h2>
            <label className="ts-field">
              <span>표시명</span>
              <input type="text" name="label" required />
            </label>
            <label className="ts-field">
              <span>타입</span>
              <TypeKindSelect />
            </label>
            <label className="ts-field">
              <span>enum 대상</span>
              <select name="enumCode" defaultValue="">
                <option value="">—</option>
                {enums.map((e) => (
                  <option key={e.code} value={e.code}>
                    {e.label} ({e.code})
                  </option>
                ))}
              </select>
            </label>
            <div className="ts-form-actions">
              <button type="submit">추가</button>
            </div>
          </form>
        </>
      )}

      <h2 className="ts-h2">사용처 ({usages.length})</h2>
      <table className="ts-table">
        <thead>
          <tr>
            <th>형태</th>
            <th>좌표</th>
          </tr>
        </thead>
        <tbody>
          {usages.map((u, i) => (
            <tr key={i}>
              <td>{u.via}</td>
              <td>{coordText(u.at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {usages.length === 0 && <p className="ts-muted">사용처가 없습니다 (고아).</p>}

      <h2 className="ts-h2">삭제</h2>
      {removeNode}

      <p style={{ marginTop: 24 }}>
        <Link href="/catalog">← 목록으로</Link>
      </p>
    </div>
  );
}
