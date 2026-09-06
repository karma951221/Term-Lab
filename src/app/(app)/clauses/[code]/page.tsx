/**
 * 공용조항 상세 (L2) — 정의 · 본문 · 옵션 · 사용처.
 *
 * 본문은 **먼저 문서 세계(명조)로 읽힌다** (디자인원칙 §1.1 · 리뷰 #65). 원시 JSON 은 1급 편집 표면이 아니라
 * 맨 아래 「본문 (고급 · JSON)」 섹션으로 내렸다 — 구조 편집기(ADR-0012)가 붙기 전까지의 유일한 편집 경로이므로
 * 없애지는 않는다.
 * 옵션 선택은 `{"O01":"V01"}` 이 아니라 「어조: 사망」으로 읽는다 (§9.4 — 실체는 표시명으로 부른다).
 */
import Link from "next/link";
import type { ReactNode } from "react";

import { Confirm } from "@/app/_components/Confirm";
import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { IconTrash } from "@/app/_components/icons";
import { IssueList } from "@/app/_components/IssueList";
import { MODE_LABEL, label as labelOf } from "@/app/_lib/labels";
import { previewOutcome } from "@/app/_lib/rejection";
import type { Block, Clause, Inline, ItemNode, OptionSelection, SubitemNode } from "@/domain/clause";
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

const OWNER_KIND_LABEL: Record<string, string> = { coverage: "담보약관", general: "보통약관" };

/** 읽기 모드 조건식 칩 — 길면 자르고 전체는 tooltip 으로 (§2 L3). */
function CondHead({ when }: { when?: string }) {
  const text = when ?? "그 밖의 경우 (else)";
  return (
    <span className="ts-doc-cond-head" title={text}>
      {text.length > 60 ? `${text.slice(0, 60)}…` : text}
    </span>
  );
}

function InlineNodes({ nodes, clause }: { nodes: readonly Inline[]; clause: Clause }): ReactNode {
  return nodes.map((n) => {
    switch (n.kind) {
      case "text":
        return <span key={n.id}>{n.text}</span>;
      case "slot":
        return (
          <span key={n.id} className="ts-doc-slot" title={`치환 슬롯 · ${n.ref}`}>
            {n.ref}
          </span>
        );
      case "articleRef":
        return (
          <span key={n.id} className="ts-doc-ref" title="조 참조 슬롯 — 번호는 조립에서 계산된다">
            제○조
          </span>
        );
      case "appendixRef":
        return (
          <span key={n.id} className="ts-doc-ref" title={`별표 참조 · ${n.appendixCode}`}>
            【별표 {n.appendixCode}】
          </span>
        );
      case "optionSlot": {
        const option = clause.options.find((o) => o.code === n.optionCode);
        return (
          <span key={n.id} className="ts-doc-ref" title={`옵션 자리 — 사용처가 고른 선택지가 여기 들어간다 (${n.optionCode})`}>
            〔{option?.label ?? n.optionCode}〕
          </span>
        );
      }
      case "inlineCond":
        return (
          <span key={n.id} className="ts-doc-cond">
            {n.branches.map((br) => (
              <span key={br.id}>
                <CondHead {...(br.when !== undefined ? { when: br.when } : {})} /> <InlineNodes nodes={br.children} clause={clause} />
              </span>
            ))}
          </span>
        );
    }
  });
}

function Subitems({ nodes, clause }: { nodes: readonly SubitemNode[]; clause: Clause }) {
  return (
    <ol className="ts-doc-subitems">
      {nodes.map((s) => (
        <li key={s.id} className="ts-doc-subitem">
          <InlineNodes nodes={s.children} clause={clause} />
        </li>
      ))}
    </ol>
  );
}

function Items({ nodes, clause }: { nodes: readonly ItemNode[]; clause: Clause }) {
  return (
    <ol className="ts-doc-items">
      {nodes.map((it) => (
        <li key={it.id} className="ts-doc-item">
          <InlineNodes nodes={it.children} clause={clause} />
          {it.subitems && it.subitems.length > 0 && <Subitems nodes={it.subitems} clause={clause} />}
        </li>
      ))}
    </ol>
  );
}

function Blocks({ nodes, clause }: { nodes: readonly Block[]; clause: Clause }): ReactNode {
  return nodes.map((n) =>
    n.kind === "paragraph" ? (
      <div key={n.id} className="ts-doc-paragraph">
        <InlineNodes nodes={n.children} clause={clause} />
        {n.items && n.items.length > 0 && <Items nodes={n.items} clause={clause} />}
      </div>
    ) : (
      <div key={n.id}>
        {n.branches.map((br, i) => (
          <div key={br.id} className={i === 0 ? "ts-doc-cond" : "ts-doc-cond is-alt"}>
            <CondHead {...(br.when !== undefined ? { when: br.when } : {})} />
            <Blocks nodes={br.children} clause={clause} />
          </div>
        ))}
      </div>
    ),
  );
}

/** 옵션 선택(`{"O01":"V01"}`) → 「어조: 사망」. 정의에 없는 코드는 코드 그대로 남긴다(깨진 선택). */
function selectionLabel(clause: Clause, selection: OptionSelection | undefined): string {
  if (!selection) return "선택 없음";
  const parts = Object.entries(selection).map(([optionCode, valueCode]) => {
    const option = clause.options.find((o) => o.code === optionCode);
    const value = option?.values.find((v) => v.code === valueCode);
    return `${option?.label ?? optionCode}: ${value?.label ?? `${valueCode}(없는 선택지)`}`;
  });
  return parts.length > 0 ? parts.join(" · ") : "선택 없음";
}

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
  const documents = await services.document.list();
  const documentTitle = new Map(documents.map((d) => [d.id, d.title] as const));

  let deleteNode = null;
  if (sp.del === "1") {
    const outcome = previewOutcome(await services.clause.remove(actor, code));
    deleteNode =
      outcome.kind === "confirm" ? (
        <Confirm
          impact={outcome.impact}
          action={removeAction.bind(null, code)}
          targetLabel={`공용조항 ${clause.label}(${clause.code})`}
          actionLabel={`${clause.code} 삭제`}
          cancelHref="?"
        />
      ) : outcome.kind === "error" ? (
        <p className="ts-error-banner">{outcome.message}</p>
      ) : null;
  }

  const optionValueCount = clause.options.reduce((n, o) => n + o.values.length, 0);

  return (
    <div>
      <h1 className="ts-h1">
        {clause.label} <code className="ts-muted">{clause.code}</code>
      </h1>
      <ErrorBanner message={sp.error} />
      <p className="ts-toolbar">
        <span className="ts-muted">{labelOf(MODE_LABEL, clause.mode)} 공용조항</span>
        <Link href={`/relations?kind=clause&code=${clause.code}`}>관계정보 →</Link>
      </p>

      {/* 본문은 먼저 문서로 보인다 (§1.1 — 미리보기는 앱 스킨을 입지 않는다) */}
      <section className="ts-section">
        <h2 className="ts-section-title">본문</h2>
        <article className="ts-doc">
          {clause.mode === "block" ? (
            <Blocks nodes={clause.body} clause={clause} />
          ) : (
            <div className="ts-doc-paragraph">
              <InlineNodes nodes={clause.body} clause={clause} />
            </div>
          )}
        </article>
        {clause.body.length === 0 && (
          <div className="ts-empty">
            <p className="ts-empty-what">본문이 비어 있다 — 이 공용조항을 참조해도 아무 문면도 나오지 않는다.</p>
            <p className="ts-empty-example">
              예: {clause.mode === "block" ? "항 하나 「이 특별약관은 …」" : "문장 조각 「보험금을 지급하지 않습니다」"}
            </p>
            <p className="ts-empty-action">아래 「본문 (고급 · JSON)」에서 노드를 채워라.</p>
          </div>
        )}
      </section>

      <section className="ts-section">
        <h2 className="ts-section-title">기본 정보</h2>
        <form action={renameAction.bind(null, code)}>
          <div className="ts-form-row">
            <label htmlFor="clause-label">표시명</label>
            <input id="clause-label" type="text" name="label" defaultValue={clause.label} required />
          </div>
          <div className="ts-form-actions">
            <button type="submit">표시명 저장</button>
          </div>
        </form>
        <form action={setDescriptionAction.bind(null, code)}>
          <div className="ts-form-row">
            <label htmlFor="clause-desc">설명</label>
            <textarea id="clause-desc" name="description" rows={2} defaultValue={clause.description} />
          </div>
          <div className="ts-form-actions">
            <button type="submit">설명 저장</button>
          </div>
        </form>
        <div className="ts-form-row">
          <span className="ts-form-label">요구 구분자</span>
          <span>
            {clause.required.discriminators.length > 0 ? (
              <span className="ts-mono">{clause.required.discriminators.join(" · ")}</span>
            ) : (
              <span className="ts-muted">없음 — 본문의 식에서 자동 추출된다 (ADR-0010)</span>
            )}
          </span>
        </div>
      </section>

      <section className="ts-section">
        <h2 className="ts-section-title">
          옵션{" "}
          <span className="ts-count">
            <b>{clause.options.length}</b>개 · 선택지 {optionValueCount}
          </span>
        </h2>
        {clause.options.length === 0 && <p className="ts-muted">옵션 없음 — 사용처가 고를 것이 없다.</p>}
        {clause.options.map((o) => (
          <div key={o.code} className="ts-section">
            <form action={renameOptionAction.bind(null, code, o.code)}>
              <div className="ts-form-row">
                <label htmlFor={`opt-${o.code}`}>옵션명</label>
                <span className="ts-form-control">
                  <input id={`opt-${o.code}`} type="text" name="label" defaultValue={o.label} />
                  <button type="submit">저장</button>
                  <span className="ts-muted ts-mono">{o.code}</span>
                </span>
              </div>
            </form>
            {o.values.map((v) => (
              <form key={v.code} action={renameOptionValueAction.bind(null, code, o.code, v.code)}>
                <div className="ts-form-row">
                  <label htmlFor={`optv-${o.code}-${v.code}`}>선택지</label>
                  <span className="ts-form-control">
                    <input id={`optv-${o.code}-${v.code}`} type="text" name="label" defaultValue={v.label} />
                    <button type="submit">저장</button>
                    <span className="ts-muted ts-mono">{v.code}</span>
                  </span>
                </div>
              </form>
            ))}
            <form action={addOptionValueAction.bind(null, code, o.code)}>
              <div className="ts-form-row">
                <label htmlFor={`optnew-${o.code}`}>선택지 추가</label>
                <span className="ts-form-control">
                  <input id={`optnew-${o.code}`} type="text" name="label" placeholder={`예: ${o.values[0]?.label ?? "사망"}`} required />
                  <button type="submit">추가</button>
                </span>
              </div>
            </form>
          </div>
        ))}
        <form action={addOptionAction.bind(null, code)}>
          <h3 className="ts-form-title">옵션 추가</h3>
          <div className="ts-form-row">
            <label htmlFor="newopt-label">옵션명</label>
            <input id="newopt-label" type="text" name="label" placeholder="예: 어조" required />
          </div>
          <div className="ts-form-row">
            <label htmlFor="newopt-values">선택지</label>
            <input id="newopt-values" type="text" name="values" placeholder="콤마로 구분, 2개 이상 — 예: 사망, 해지" required />
          </div>
          <div className="ts-form-actions">
            <button type="submit">추가</button>
          </div>
        </form>
      </section>

      <section className="ts-section">
        <h2 className="ts-section-title">
          사용처 <span className="ts-count"><b>{usages.length}</b>건</span>
        </h2>
        {usages.length === 0 ? (
          <div className="ts-empty">
            <p className="ts-empty-what">아무 문면도 이 공용조항을 참조하지 않는다 — 지금은 고아다.</p>
            <p className="ts-empty-example">예: 담보약관의 조 안에 「공용조항(조 단위)」 노드를 넣으면 여기 잡힌다.</p>
            <p className="ts-empty-action">
              <Link href="/documents">문면 목록으로 →</Link>
            </p>
          </div>
        ) : (
          <table className="ts-table">
            <thead>
              <tr>
                <th className="col-flex">문면</th>
                <th className="col-fixed-md">소유 모델링</th>
                <th className="col-fixed-md">선택</th>
              </tr>
            </thead>
            <tbody>
              {usages.map((u, i) => (
                <tr key={i}>
                  <td className="col-flex">
                    <Link href={`/documents/${u.documentId}`}>
                      {documentTitle.get(u.documentId) ?? u.ownerName ?? "이름 없는 문면"}({OWNER_KIND_LABEL[u.ownerKind] ?? u.ownerKind})
                    </Link>
                  </td>
                  <td className="col-fixed-md" title={u.ownerId}>
                    {u.ownerName ?? "—"}
                  </td>
                  <td className="col-fixed-md">{selectionLabel(clause, u.selection)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="ts-section">
        <h2 className="ts-section-title">
          재검사 결과{" "}
          <span className="ts-count">
            <b>{recheck.ok ? recheck.value.length : 0}</b> / {usages.length}건
          </span>
        </h2>
        {recheck.ok && recheck.value.length === 0 && <p className="ts-ok">사용처 {usages.length}건 모두 문제 없음.</p>}
        {recheck.ok &&
          recheck.value.map((entry, i) => (
            <div key={i}>
              <p>
                {documentTitle.get(entry.usage.documentId) ?? entry.usage.ownerName ?? entry.usage.ownerId} — 미부착:{" "}
                {entry.missing.length > 0 ? <span className="ts-mono">{entry.missing.join(" · ")}</span> : "없음"}
              </p>
              <IssueList issues={entry.issues} />
            </div>
          ))}
      </section>

      {/* 원시 JSON 은 1급 편집 표면이 아니다 (#65) — 구조 편집기가 붙을 때까지의 임시 통로 */}
      <section className="ts-section">
        <h2 className="ts-section-title">본문 (고급 · JSON)</h2>
        <p className="ts-muted">
          공용조항 본문의 노드 트리를 직접 고친다. 저장하면 요구 구분자를 다시 뽑고 사용처 {usages.length}건을 재검사한다. 위 「본문」에 결과가 그대로 보인다.
        </p>
        <form action={setBodyAction.bind(null, code)}>
          <div className="ts-form-row ts-form-full">
            <label htmlFor="clause-body">노드 트리</label>
            <textarea id="clause-body" name="body" className="ts-json" defaultValue={JSON.stringify(clause.body, null, 2)} />
          </div>
          <div className="ts-form-actions">
            <button type="submit">저장 (요구 구분자 재추출 · 사용처 재검사)</button>
          </div>
        </form>
      </section>

      <section className="ts-section">
        <h2 className="ts-section-title">삭제</h2>
        {sp.del === "1" ? (
          deleteNode
        ) : (
          <p>
            <Link className="ts-iconbtn danger" href="?del=1" title={`공용조항 ${clause.label}(${clause.code}) 삭제`} aria-label={`공용조항 ${clause.label}(${clause.code}) 삭제`}>
              <IconTrash />
            </Link>
          </p>
        )}
      </section>

      <p style={{ marginTop: 24 }}>
        <Link href="/clauses">← 목록으로</Link>
      </p>
    </div>
  );
}
