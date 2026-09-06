/**
 * 구분자 상세 (L2 · 수정) — 「한눈에」가 유일한 제약이다 (디자인원칙 §2 L2).
 *
 * - **섹션 하나 = 폼 하나 = 저장 하나** (리뷰 #53). 「기본 정보」는 표시명·설명·노출·기본값(또는 const 값·파생식)을
 *   한 폼으로 묶어 `saveBasicInfoAction` 하나로 저장한다.
 * - 라벨은 값 왼쪽 120px 고정 열 (`.ts-form-row`). 라벨을 값 위에 두지 않는다 (리뷰 #51).
 * - **파괴적인 것은 맨 끝 「위험 구역」에 모은다.** 경고는 산문이 아니라 실측 건수로 말한다 (§9.5 · 리뷰 #35) —
 *   Impact 미리보기는 `confirm` 없이 서비스를 부르는 읽기라서 화면을 그리면서 그 자리에서 센다.
 * - 영문 리터럴은 화면에 내지 않는다 (리뷰 #64) — 종류·레벨·타입은 전부 라벨 맵을 통과한다.
 */
import Link from "next/link";
import type { ReactNode } from "react";

import { Confirm } from "@/app/_components/Confirm";
import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { IconTrash } from "@/app/_components/icons";
import { KIND_LABEL, LEVEL_LABEL, TYPE_LABEL } from "@/app/_lib/labels";
import { previewOutcome } from "@/app/_lib/rejection";
import type { Discriminator } from "@/domain/catalog/types";
import { formatCoordinate } from "@/domain/coordinate";
import { refStats, usagesOf, type EdgeVia } from "@/domain/refs";
import type { FieldType } from "@/domain/types";
import { currentActor, getServices } from "@/lib/services";

import {
  addFieldAction,
  changeFieldTypeAction,
  changeScalarTypeAction,
  removeAction,
  removeFieldAction,
  saveBasicInfoAction,
  saveFieldAction,
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

/** 참조 형태 — 영문 간선 이름을 화면에 내지 않는다 (리뷰 #64). 관계정보 화면과 문구를 맞춰야 하면 labels.ts 로 올린다. */
const VIA_LABEL = {
  when: "조건식",
  slot: "치환 슬롯",
  expression: "파생식",
  clauseRef: "공용조항 참조",
  optionSelect: "옵션 선택",
  override: "옵션 오버라이드",
  articleRef: "조 참조",
  link: "조연결",
  appendixRef: "별표 참조",
  generalDocument: "보통약관 연결",
  document: "담보약관",
  type: "타입",
  attach: "부착",
  mount: "탑재",
  combination: "조합",
} as const satisfies Record<EdgeVia, string>;

/** 타입 하나를 사람 말로 — 「선택형 (고지유형)」. */
function typeText(type: FieldType, enumLabels: Map<string, string>): string {
  if (type.kind === "enum" || type.kind === "list<enum>") {
    return `${TYPE_LABEL[type.kind]} (${enumLabels.get(type.enumCode) ?? type.enumCode})`;
  }
  return TYPE_LABEL[type.kind];
}

/** 실체를 이름으로 부른다 — 「구분자 보험금지급(D0003)」 (§9.4). */
function nameOf(def: Discriminator): string {
  return `구분자 ${def.label}(${def.code})`;
}

function TypeKindSelect({ name = "typeKind", defaultValue = "" }: { name?: string; defaultValue?: string }) {
  return (
    <select name={name} defaultValue={defaultValue} required>
      {(Object.keys(TYPE_LABEL) as (keyof typeof TYPE_LABEL)[]).map((k) => (
        <option key={k} value={k}>
          {TYPE_LABEL[k]}
        </option>
      ))}
    </select>
  );
}

function Row({ label, children, htmlFor }: { label: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="ts-form-row">
      <label htmlFor={htmlFor}>{label}</label>
      <div className="ts-form-control">{children}</div>
    </div>
  );
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
  const enumLabels = new Map(enums.map((e) => [e.code, e.label]));
  // 그래프 한 번으로 사용처와 모집단(전체 참조)을 같이 얻는다 — 분모 없는 숫자를 두지 않는다 (§9.6)
  const graph = await services.refs.graph();
  const usages = usagesOf(graph, { kind: "discriminator", code });
  const totalRefs = refStats(graph).edges;
  const actor = await currentActor();

  // ── 파괴적 액션 미리보기 (읽기 전용 — confirm 없이 호출해 Impact 만 얻는다)
  const removePreview = previewOutcome(await services.catalog.remove(actor, code));
  /** 지금 이 구분자에 저장돼 있는 값 건수 — 타입 변경·삭제가 지우는 것 (§9.5). */
  const valueRows = removePreview.kind === "confirm" ? removePreview.impact.valueRowsLost : undefined;

  let removeNode: ReactNode = (
    <div className="ts-form-actions">
      <Link href="?del=1" tabIndex={-1}>
        <button type="button" className="danger" title={`${nameOf(def)} 삭제 — 저장된 값 ${valueRows ?? 0}건이 사라진다`}>
          {def.label} 삭제…
        </button>
      </Link>
    </div>
  );
  if (sp.del === "1") {
    removeNode =
      removePreview.kind === "confirm" ? (
        <Confirm
          impact={removePreview.impact}
          action={removeAction.bind(null, code)}
          targetLabel={nameOf(def)}
          actionLabel={`${def.code} 삭제`}
          cancelHref={`/catalog/${code}`}
        />
      ) : removePreview.kind === "error" ? (
        <p className="ts-error-banner">{removePreview.message}</p>
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
            <Confirm
              impact={outcome.impact}
              action={changeScalarTypeAction.bind(null, code, type)}
              title={`${nameOf(def)} 의 타입을 ${typeText(type, enumLabels)} 로 바꾼다`}
              actionLabel={`타입 바꾸고 값 ${outcome.impact.valueRowsLost}건 삭제`}
              cancelHref={`/catalog/${code}`}
            />
          ) : outcome.kind === "error" ? (
            <p className="ts-error-banner">{outcome.message}</p>
          ) : null;
      }
    } else {
      scalarTypeChangeNode = (
        <form method="get" className="ts-form">
          <Row label="새 타입">
            <TypeKindSelect name="newType" defaultValue={def.type.kind} />
            <select name="newEnum" defaultValue={def.type.kind === "enum" || def.type.kind === "list<enum>" ? def.type.enumCode : ""}>
              <option value="">— 선택형일 때만 —</option>
              {enums.map((e) => (
                <option key={e.code} value={e.code}>
                  {e.label} ({e.code})
                </option>
              ))}
            </select>
          </Row>
          <div className="ts-form-actions">
            <button type="submit" className="danger">
              타입 변경 미리보기…
            </button>
          </div>
        </form>
      );
    }
  }

  // ── struct 필드마다: 타입 변경 · 삭제 (둘 다 파괴적 — 위험 구역에서만)
  const fieldDanger = new Map<string, ReactNode>();
  const fieldValueRows = new Map<string, number>();
  if (def.kind === "struct") {
    for (const f of def.fields) {
      const preview = previewOutcome(await services.catalog.removeField(actor, code, f.code));
      if (preview.kind === "confirm") fieldValueRows.set(f.code, preview.impact.valueRowsLost);

      if (sp.delField === f.code) {
        fieldDanger.set(
          f.code,
          preview.kind === "confirm" ? (
            <Confirm
              impact={preview.impact}
              action={removeFieldAction.bind(null, code, f.code)}
              targetLabel={`필드 ${f.label}(${f.code})`}
              actionLabel={`${f.code} 삭제`}
              cancelHref={`/catalog/${code}`}
            />
          ) : preview.kind === "error" ? (
            <p className="ts-error-banner">{preview.message}</p>
          ) : null,
        );
        continue;
      }
      if (sp.field === f.code && sp.newType) {
        const type = fieldTypeFrom(sp.newType, sp.newEnum ?? "");
        if (!type) {
          fieldDanger.set(f.code, <p className="ts-error-banner">타입을 확인하세요.</p>);
          continue;
        }
        const outcome = previewOutcome(await services.catalog.changeFieldType(actor, code, f.code, type));
        fieldDanger.set(
          f.code,
          outcome.kind === "confirm" ? (
            <Confirm
              impact={outcome.impact}
              action={changeFieldTypeAction.bind(null, code, f.code, type)}
              title={`필드 ${f.label}(${f.code}) 의 타입을 ${typeText(type, enumLabels)} 로 바꾼다`}
              actionLabel={`타입 바꾸고 값 ${outcome.impact.valueRowsLost}건 삭제`}
              cancelHref={`/catalog/${code}`}
            />
          ) : outcome.kind === "error" ? (
            <p className="ts-error-banner">{outcome.message}</p>
          ) : null,
        );
      }
    }
  }

  const sortedFields = def.kind === "struct" ? [...def.fields].sort((a, b) => a.order - b.order) : [];

  return (
    <div>
      <h1 className="ts-h1">
        {def.label} <code className="ts-mono ts-muted">{def.code}</code>
      </h1>
      <ErrorBanner message={sp.error} />

      {/* ── 기본 정보 — 폼 하나 · 저장 하나 (리뷰 #53) ───────────────────────── */}
      <form action={saveBasicInfoAction.bind(null, code)} className="ts-form">
        <h2 className="ts-form-title">기본 정보</h2>
        <Row label="종류">{KIND_LABEL[def.kind]}</Row>
        {def.kind !== "const" && <Row label="부착 레벨">{LEVEL_LABEL[def.level]}</Row>}
        <Row label="표시명" htmlFor="f-label">
          <input id="f-label" type="text" name="label" defaultValue={def.label} className="ts-field-direct" required />
        </Row>
        <Row label="설명" htmlFor="f-description">
          <textarea id="f-description" name="description" rows={2} defaultValue={def.description} className="ts-field-direct" />
        </Row>
        {(def.kind === "scalar" || def.kind === "struct") && (
          <Row label="노출">
            <label className="ts-form-check">
              <input type="checkbox" name="alwaysExposed" defaultChecked={def.alwaysExposed} /> 이 레벨의 모든 실체에 값 자리를 만든다
            </label>
          </Row>
        )}
        {def.kind === "scalar" && (
          <>
            <Row label="타입">{typeText(def.type, enumLabels)}</Row>
            <Row label="기본값" htmlFor="f-default">
              <input
                id="f-default"
                type="text"
                name="defaultValue"
                defaultValue={def.defaultValue === undefined ? "" : String(def.defaultValue)}
                className="ts-field-direct"
                title="폼을 열 때 미리 채워 보여줄 제안값. 비우면 제안 없음 (저장 전까지는 미입력이다 — ADR-0004)"
              />
              {def.defaultValue !== undefined && <span className="ts-badge proposed">폼 프리필 제안</span>}
            </Row>
          </>
        )}
        {def.kind === "const" && (
          <Row label="값" htmlFor="f-value">
            <input id="f-value" type="text" name="value" defaultValue={def.value} className="ts-field-direct" required />
          </Row>
        )}
        {def.kind === "derived" && (
          <Row label="식" htmlFor="f-expression">
            <input id="f-expression" type="text" name="expression" defaultValue={def.expression} className="ts-field-direct ts-mono" required />
          </Row>
        )}
        <div className="ts-form-actions">
          <button type="submit" className="primary">
            저장
          </button>
          {def.kind === "derived" && <span className="ts-muted">저장 전에 식을 검사한다</span>}
        </div>
      </form>

      {/* ── 필드 (struct) ──────────────────────────────────────────────────── */}
      {def.kind === "struct" && (
        <section className="ts-section">
          <h2 className="ts-section-title">
            필드<span className="ts-count">{sortedFields.length}</span>
          </h2>
          {sortedFields.length === 0 ? (
            <div className="ts-empty">
              <p className="ts-empty-what">구조체에는 필드가 있어야 값 자리가 생긴다.</p>
              <p className="ts-empty-example">예: 면책여부(예/아니오) · 지급률(숫자)</p>
            </div>
          ) : (
            <>
              <table className="ts-table">
                <thead>
                  <tr>
                    <th className="col-code">코드</th>
                    <th className="col-flex">표시명</th>
                    <th className="col-fixed-md">타입</th>
                    <th>기본값 (제안)</th>
                    <th className="col-fixed-sm">저장</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedFields.map((f) => (
                    <tr key={f.code}>
                      <td className="col-code">{f.code}</td>
                      <td className="col-flex">
                        <input type="text" name="label" defaultValue={f.label} form={`fld-${f.code}`} className="ts-field-direct" required />
                      </td>
                      <td>{typeText(f.type, enumLabels)}</td>
                      <td>
                        <input
                          type="text"
                          name="defaultValue"
                          defaultValue={f.defaultValue === undefined ? "" : String(f.defaultValue)}
                          form={`fld-${f.code}`}
                          className="ts-field-direct"
                        />
                      </td>
                      <td>
                        <button type="submit" form={`fld-${f.code}`}>
                          저장
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {/* 행 하나 = 폼 하나 = 저장 하나. 표의 칸을 가로지르므로 form 은 밖에 두고 input 이 id 로 붙는다 */}
              {sortedFields.map((f) => (
                <form key={f.code} id={`fld-${f.code}`} action={saveFieldAction.bind(null, code, f.code)} hidden />
              ))}
            </>
          )}
          <form action={addFieldAction.bind(null, code)} className="ts-form">
            <h2 className="ts-form-title">필드 추가</h2>
            <Row label="표시명" htmlFor="new-field-label">
              <input id="new-field-label" type="text" name="label" className="ts-field-direct" required />
            </Row>
            <Row label="타입" htmlFor="new-field-type">
              <TypeKindSelect />
              <select name="enumCode" defaultValue="">
                <option value="">— 선택형일 때만 —</option>
                {enums.map((e) => (
                  <option key={e.code} value={e.code}>
                    {e.label} ({e.code})
                  </option>
                ))}
              </select>
            </Row>
            <div className="ts-form-actions">
              <button type="submit">추가</button>
            </div>
          </form>
        </section>
      )}

      {/* ── 사용처 ─────────────────────────────────────────────────────────── */}
      <section className="ts-section">
        <h2 className="ts-section-title">
          사용처
          <span className="ts-count">
            <b>{usages.length}</b> / 전체 참조 {totalRefs}
          </span>
        </h2>
        {usages.length === 0 ? (
          <div className="ts-empty">
            <p className="ts-empty-what">아무 문면·식도 이 구분자를 읽지 않는다 (고아).</p>
            <p className="ts-empty-example">예: 조건식 「{def.code} = 예」 · 치환 슬롯 「{def.code}」</p>
            <p className="ts-empty-action">
              <Link href="/documents">문면에서 쓰러 가기 →</Link>
            </p>
          </div>
        ) : (
          <table className="ts-table">
            <thead>
              <tr>
                <th className="col-fixed-md">형태</th>
                <th className="col-flex">좌표</th>
              </tr>
            </thead>
            <tbody>
              {usages.map((u, i) => (
                <tr key={i}>
                  <td className="col-fixed-md">{VIA_LABEL[u.via] ?? u.via}</td>
                  <td className="col-flex">{formatCoordinate(u.at, { source: true })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* ── 위험 구역 — 되돌릴 수 없는 것만 여기 모은다 (§1.5 · §9.5) ────────── */}
      <section className="ts-section">
        <h2 className="ts-section-title">위험 구역</h2>
        <p className="ts-issue-warning">
          {valueRows === undefined
            ? "아래 조작은 되돌릴 수 없다."
            : `아래 조작은 되돌릴 수 없다 — 지금 저장된 값 ${valueRows}건이 걸려 있다.`}
        </p>

        {def.kind === "scalar" && (
          <>
            <h3 className="ts-section-title">타입 변경</h3>
            <p className="ts-issue-warning">
              {valueRows === undefined ? "타입을 바꾸면 저장된 값이 삭제된다." : `타입을 바꾸면 지금 저장된 값 ${valueRows}건이 삭제된다.`}
            </p>
            {scalarTypeChangeNode}
          </>
        )}

        {def.kind === "struct" && sortedFields.length > 0 && (
          <>
            <h3 className="ts-section-title">필드 타입 변경 · 필드 삭제</h3>
            <table className="ts-table">
              <thead>
                <tr>
                  <th className="col-code">코드</th>
                  <th className="col-flex">필드</th>
                  <th className="col-fixed-sm col-num">저장된 값</th>
                  <th>새 타입</th>
                  <th className="col-fixed-sm">삭제</th>
                </tr>
              </thead>
              <tbody>
                {sortedFields.map((f) => (
                  <tr key={f.code}>
                    <td className="col-code">{f.code}</td>
                    <td className="col-flex">{f.label}</td>
                    <td className="col-num">{fieldValueRows.get(f.code) ?? "—"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <form method="get" style={{ display: "inline-flex", gap: 4 }}>
                        <input type="hidden" name="field" value={f.code} />
                        <TypeKindSelect name="newType" defaultValue={f.type.kind} />
                        <select name="newEnum" defaultValue={f.type.kind === "enum" || f.type.kind === "list<enum>" ? f.type.enumCode : ""}>
                          <option value="">— 선택형일 때만 —</option>
                          {enums.map((e) => (
                            <option key={e.code} value={e.code}>
                              {e.label} ({e.code})
                            </option>
                          ))}
                        </select>
                        <button type="submit" className="danger">
                          타입 변경…
                        </button>
                      </form>
                    </td>
                    <td>
                      <Link
                        href={`?delField=${f.code}`}
                        className="ts-iconbtn danger"
                        title={`필드 ${f.label}(${f.code}) 삭제 — 저장된 값 ${fieldValueRows.get(f.code) ?? 0}건이 사라진다`}
                        aria-label={`필드 ${f.label}(${f.code}) 삭제`}
                      >
                        <IconTrash />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {sortedFields.map((f) => {
              const node = fieldDanger.get(f.code);
              return node ? <div key={f.code}>{node}</div> : null;
            })}
          </>
        )}

        <h3 className="ts-section-title">구분자 삭제</h3>
        {removeNode}
      </section>

      <p style={{ marginTop: 24 }}>
        <Link href="/catalog">← 구분자 목록</Link>
      </p>
    </div>
  );
}
