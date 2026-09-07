/**
 * L3 우측 패널 — **모드에 종속된다. 탭이 없다** (디자인원칙 §2 L3).
 *
 * - 읽기 모드 → 사전평가/미리보기: 조건식마다 「식 · 참/거짓 · 채택 분기」 한 줄, 그 아래 명조로 렌더된 결과.
 * - 편집 모드 → 고르는 자리의 편집 폼. 아무것도 안 고르면 문서 수준(제목 · 대응 보통약관 · 삭제)을 준다.
 *
 * 서버 액션의 `name` 속성은 그대로다 — 화면만 바뀌었지 저장 경로는 그대로 산다.
 */
import Link from "next/link";
import type { ReactNode } from "react";

import { IconButton, IconPlus, IconTrash } from "@/app/_components/icons";
import { IssueList } from "@/app/_components/IssueList";
import { DOC_KIND_LABEL } from "@/app/_lib/labels";
import type { Clause } from "@/domain/clause";
import {
  referenceTargetLabel,
  type Appendix,
  type BlockBranch,
  type BranchEvaluation,
  type DocumentNode,
  type InlineBranch,
  type Node,
  type NodeKind,
  type TreeIndex,
} from "@/domain/document";
import type { Id, Issue } from "@/domain/types";

import {
  addBranchAction,
  insertNodeAction,
  linkArticleAction,
  removeBranchAction,
  setAppendixRefAction,
  setArticleRefAction,
  setArticleTitleAction,
  setBoxAction,
  setClauseOptionsAction,
  setDocumentTitleAction,
  setGeneralDocumentAction,
  setSlotRefAction,
  setTableAction,
  setTextAction,
  setWhenAction,
} from "../../actions";
import { NodeControls } from "./DocBody";
import { chipText, returnToValue, type DocCtx } from "./ctx";

const KIND_LABEL: Record<string, string> = {
  section: "관",
  article: "조",
  table: "표",
  box: "박스",
  paragraph: "항",
  item: "호",
  subitem: "목",
  text: "문장",
  slot: "치환 슬롯",
  inlineCond: "문장 안 조건",
  condBlock: "조건 블록",
  clauseBlockRef: "공용조항 (조 단위)",
  clauseInlineRef: "공용조항 (문장 안)",
  articleRef: "조 참조 슬롯",
  appendixRef: "별표 참조 슬롯",
  forBlock: "반복 블록",
  inlineFor: "문장 안 반복",
};

const ADD_KINDS = {
  top: ["article", "section", "condBlock"],
  section: ["article", "condBlock"],
  block: ["paragraph", "condBlock", "clauseBlockRef", "table", "box"],
  inline: ["text", "slot", "inlineCond", "articleRef", "appendixRef", "clauseInlineRef"],
  item: ["item", "condBlock", "table", "box"],
  subitem: ["subitem", "condBlock"],
} satisfies Record<string, readonly NodeKind[]>;

/** 표 폼 필드 — 추가·수정 폼이 같이 쓴다 (값은 노드에서 역직렬화). */
function TableFields({ prefix, node, withTitle = true }: { prefix: string; node?: Node & { kind: "table" }; withTitle?: boolean }) {
  const headerRows = node ? node.rows.findIndex((r) => !r.header) : -1;
  return (
    <>
      {withTitle && (
        <div className="ts-form-row">
          <label htmlFor={`${prefix}-title`}>표 제목</label>
          <input id={`${prefix}-title`} type="text" name="title" defaultValue={node?.title ?? ""} placeholder="없으면 비운다" />
        </div>
      )}
      <div className="ts-form-row">
        <label htmlFor={`${prefix}-widths`}>열 너비 %</label>
        <input id={`${prefix}-widths`} type="text" name="widths" className="ts-mono" defaultValue={node ? node.columns.map((c) => c.width ?? "").join(",") : ""} placeholder="예: 30,70 (빈칸은 자동)" />
      </div>
      <div className="ts-form-row">
        <label htmlFor={`${prefix}-header`}>제목줄 수</label>
        <input id={`${prefix}-header`} type="number" name="headerRows" min={0} defaultValue={node ? (headerRows < 0 ? node.rows.length : headerRows) : 1} />
      </div>
      <div className="ts-form-row ts-form-full">
        <label htmlFor={`${prefix}-rows`}>행 (한 줄 = 한 행 · 셀은 |)</label>
        <textarea id={`${prefix}-rows`} name="rows" rows={6} className="ts-mono" defaultValue={node ? node.rows.map((r) => r.cells.join("|")).join("\n") : ""} placeholder={"용어|정의\n계약자|회사와 계약을 체결하고…"} />
      </div>
    </>
  );
}

/** 박스 폼 필드. */
function BoxFields({ prefix, node }: { prefix: string; node?: Node & { kind: "box" } }) {
  return (
    <>
      <div className="ts-form-row">
        <label htmlFor={`${prefix}-box-title`}>박스 제목</label>
        <input id={`${prefix}-box-title`} type="text" name="title" defaultValue={node?.title ?? ""} placeholder="예: 심신상실 (【】 없이)" />
      </div>
      <div className="ts-form-row ts-form-full">
        <label htmlFor={`${prefix}-box-lines`}>줄 (한 줄씩)</label>
        <textarea id={`${prefix}-box-lines`} name="lines" rows={5} defaultValue={node ? node.lines.join("\n") : ""} />
      </div>
    </>
  );
}

type AddMode = keyof typeof ADD_KINDS;

export interface PanelData {
  tree: DocumentNode;
  index: TreeIndex;
  appendices: readonly Appendix[];
  clauses: readonly Clause[];
  slotCandidates: readonly { path: string; label: string }[];
  generals: readonly { id: Id; title: string }[];
  generalDocumentId?: Id;
  /** 이 담보약관이 아직 보통약관을 안 골랐을 때의 제안 (상품이 실제로 쓰는 템플릿). 저장해야 확정된다 (ADR-0004). */
  suggestedGeneralId?: Id;
  issues: readonly Issue[];
  documentTitle: string;
  branchEval?: ReadonlyMap<Id, BranchEvaluation>;
  evalRan: boolean;
  evalAvailable: boolean;
  evalNote?: string;
  rendered?: ReactNode;
}

/* ── 추가 폼 ─────────────────────────────────────────────────────────────── */

function AddForm({ ctx, data, parentId, slot, mode }: { ctx: DocCtx; data: PanelData; parentId: Id; slot?: "children" | "items" | "subitems"; mode: AddMode }) {
  const kinds: readonly NodeKind[] = ADD_KINDS[mode];
  return (
    <details className="ts-insert-menu">
      <summary>여기에 추가</summary>
      <form action={insertNodeAction.bind(null, ctx.documentId, parentId, slot)}>
        <input type="hidden" name="returnTo" value={returnToValue(ctx)} />
        <div className="ts-form-row">
          <label htmlFor={`add-kind-${parentId}-${slot ?? "children"}`}>종류</label>
          <select id={`add-kind-${parentId}-${slot ?? "children"}`} name="kind" defaultValue={kinds[0]}>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k] ?? k}
              </option>
            ))}
          </select>
        </div>
        {(kinds.includes("article") || kinds.includes("section") || kinds.includes("table") || kinds.includes("box")) && (
          <div className="ts-form-row">
            <label>제목</label>
            <input
              type="text"
              name="title"
              placeholder={kinds.includes("article") ? "조: 보험금의 지급사유 · 관: 목적 및 용어의 정의" : "표 제목(없으면 비움) · 박스 제목(【】 없이)"}
            />
          </div>
        )}
        {kinds.includes("table") && <TableFields prefix={`add-${parentId}-${slot ?? "children"}`} withTitle={false} />}
        {kinds.includes("box") && (
          <div className="ts-form-row ts-form-full">
            <label>박스 줄 (제목은 위 제목 칸 · 한 줄씩)</label>
            <textarea name="lines" rows={3} placeholder="박스 본문 줄" />
          </div>
        )}
        {kinds.includes("text") && (
          <div className="ts-form-row">
            <label>문장</label>
            <input type="text" name="text" placeholder="본문에 넣을 문장" />
          </div>
        )}
        {kinds.includes("slot") && (
          <div className="ts-form-row">
            <label>슬롯 참조</label>
            <input type="text" name="ref" list="slot-candidates" placeholder="D0003.F01" className="ts-mono" />
          </div>
        )}
        {(kinds.includes("condBlock") || kinds.includes("inlineCond")) && (
          <div className="ts-form-row">
            <label>조건식</label>
            <input type="text" name="when" placeholder="D0001 = '예'" className="ts-mono" />
          </div>
        )}
        {kinds.includes("inlineCond") && (
          <>
            <div className="ts-form-row">
              <label>참일 때</label>
              <input type="text" name="thenText" placeholder="조건이 맞을 때 문장" />
            </div>
            <div className="ts-form-row">
              <label>아닐 때</label>
              <input type="text" name="elseText" placeholder="그 밖의 경우 문장" />
            </div>
          </>
        )}
        {kinds.includes("articleRef") && (
          <div className="ts-form-row">
            <label>참조할 조</label>
            <select name="articleTarget" defaultValue="">
              <option value="">— 고르기 —</option>
              {[...ctx.references.self].map(([nodeId, target]) => (
                <option key={`self:${nodeId}`} value={`self:${nodeId}`}>
                  이 문면 › {referenceTargetLabel(target)}
                </option>
              ))}
              {[...ctx.references.general].map(([nodeId, target]) => (
                <option key={`general:${nodeId}`} value={`general:${nodeId}`}>
                  보통약관 › {referenceTargetLabel(target)}
                </option>
              ))}
            </select>
          </div>
        )}
        {kinds.includes("appendixRef") && (
          <div className="ts-form-row">
            <label>별표</label>
            <select name="appendixCode" defaultValue={data.appendices[0]?.code ?? ""}>
              {data.appendices.length === 0 && <option value="">별표 없음</option>}
              {data.appendices.map((a) => (
                <option key={a.code} value={a.code}>
                  {a.name}({a.code})
                </option>
              ))}
            </select>
          </div>
        )}
        {(kinds.includes("clauseBlockRef") || kinds.includes("clauseInlineRef")) && (
          <div className="ts-form-row">
            <label>공용조항</label>
            <select name="clauseCode" defaultValue={data.clauses[0]?.code ?? ""}>
              {data.clauses.length === 0 && <option value="">공용조항 없음</option>}
              {data.clauses.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}({c.code})
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="ts-form-actions">
          <IconButton type="submit" label="고른 종류로 노드 추가" icon={<IconPlus />} />
          <span className="ts-muted">쓰지 않는 칸은 비워 둬도 된다.</span>
        </div>
      </form>
    </details>
  );
}

/* ── 노드별 편집 폼 ──────────────────────────────────────────────────────── */

function OptionForm({ ctx, data, node }: { ctx: DocCtx; data: PanelData; node: Node & { kind: "clauseBlockRef" | "clauseInlineRef" } }) {
  const clause = data.clauses.find((c) => c.code === node.clauseCode);
  if (!clause) {
    return <p className="ts-error-banner">공용조항 {node.clauseCode} 이(가) 없다 — 깨진 참조다.</p>;
  }
  return (
    <form action={setClauseOptionsAction.bind(null, ctx.documentId, node.id)}>
      <input type="hidden" name="returnTo" value={returnToValue(ctx)} />
      {clause.options.length === 0 && <p className="ts-muted">고를 옵션이 없는 공용조항이다.</p>}
      {clause.options.map((o) => (
        <div key={o.code} className="ts-form-row">
          <label htmlFor={`opt-${node.id}-${o.code}`}>{o.label}</label>
          <select id={`opt-${node.id}-${o.code}`} name={`option:${o.code}`} defaultValue={node.options[o.code] ?? ""}>
            <option value="">— 미선택 —</option>
            {o.values.map((v) => (
              <option key={v.code} value={v.code}>
                {v.label}
              </option>
            ))}
          </select>
        </div>
      ))}
      <div className="ts-form-actions">
        <button type="submit">옵션 저장</button>
      </div>
    </form>
  );
}

function NodeForms({ ctx, data, node }: { ctx: DocCtx; data: PanelData; node: Node }) {
  switch (node.kind) {
    case "section":
      return (
        <>
          <form action={setArticleTitleAction.bind(null, ctx.documentId, node.id)}>
            <input type="hidden" name="returnTo" value={returnToValue(ctx)} />
            <div className="ts-form-row">
              <label htmlFor="sec-title">관 제목</label>
              <input id="sec-title" type="text" name="title" defaultValue={node.title} />
            </div>
            <div className="ts-form-actions">
              <button type="submit">관 제목 저장</button>
            </div>
          </form>
          <AddForm ctx={ctx} data={data} parentId={node.id} mode="section" />
        </>
      );

    case "table":
      return (
        <form action={setTableAction.bind(null, ctx.documentId, node.id)}>
          <input type="hidden" name="returnTo" value={returnToValue(ctx)} />
          <TableFields prefix={`edit-${node.id}`} node={node} />
          <div className="ts-form-actions">
            <button type="submit">표 저장</button>
            <span className="ts-muted">제목줄은 굵게·음영, 너비는 %.</span>
          </div>
        </form>
      );

    case "box":
      return (
        <form action={setBoxAction.bind(null, ctx.documentId, node.id)}>
          <input type="hidden" name="returnTo" value={returnToValue(ctx)} />
          <BoxFields prefix={`edit-${node.id}`} node={node} />
          <div className="ts-form-actions">
            <button type="submit">박스 저장</button>
          </div>
        </form>
      );

    case "article":
      return (
        <>
          <form action={setArticleTitleAction.bind(null, ctx.documentId, node.id)}>
            <input type="hidden" name="returnTo" value={returnToValue(ctx)} />
            <div className="ts-form-row">
              <label htmlFor="art-title">조 제목</label>
              <input id="art-title" type="text" name="title" defaultValue={node.title} />
            </div>
            <div className="ts-form-actions">
              <button type="submit">제목 저장</button>
            </div>
          </form>
          {ctx.docKind === "special" && (
            <form action={linkArticleAction.bind(null, ctx.documentId, node.id)}>
              <input type="hidden" name="returnTo" value={returnToValue(ctx)} />
              <div className="ts-form-row">
                <label htmlFor="art-link">조연결</label>
                <select id="art-link" name="linkedArticleId" defaultValue={node.linkedArticleId ?? ""}>
                  <option value="">— 연결 없음 —</option>
                  {[...ctx.references.general]
                    .filter(([, t]) => t.kind === "article")
                    .map(([nodeId, target]) => (
                      <option key={nodeId} value={nodeId}>
                        {referenceTargetLabel(target)}
                      </option>
                    ))}
                </select>
              </div>
              <div className="ts-form-actions">
                <button type="submit">조연결 저장</button>
                {ctx.references.general.size === 0 && <span className="ts-muted">대응 보통약관을 먼저 골라야 조를 고를 수 있다.</span>}
              </div>
            </form>
          )}
          <AddForm ctx={ctx} data={data} parentId={node.id} mode="block" />
        </>
      );

    case "paragraph":
      return (
        <>
          <AddForm ctx={ctx} data={data} parentId={node.id} slot="children" mode="inline" />
          <AddForm ctx={ctx} data={data} parentId={node.id} slot="items" mode="item" />
        </>
      );

    case "item":
      return (
        <>
          <AddForm ctx={ctx} data={data} parentId={node.id} slot="children" mode="inline" />
          <AddForm ctx={ctx} data={data} parentId={node.id} slot="subitems" mode="subitem" />
        </>
      );

    case "subitem":
      return <AddForm ctx={ctx} data={data} parentId={node.id} slot="children" mode="inline" />;

    case "text":
      return (
        <form action={setTextAction.bind(null, ctx.documentId, node.id)}>
          <input type="hidden" name="returnTo" value={returnToValue(ctx)} />
          <div className="ts-form-row ts-form-full">
            <label htmlFor="node-text">문장</label>
            <textarea id="node-text" name="text" rows={4} defaultValue={node.text} />
          </div>
          <div className="ts-form-actions">
            <button type="submit">문장 저장</button>
          </div>
        </form>
      );

    case "slot":
      return (
        <form action={setSlotRefAction.bind(null, ctx.documentId, node.id)}>
          <input type="hidden" name="returnTo" value={returnToValue(ctx)} />
          <div className="ts-form-row">
            <label htmlFor="node-ref">참조 경로</label>
            <input id="node-ref" type="text" name="ref" list="slot-candidates" defaultValue={node.ref} className="ts-mono" />
          </div>
          <div className="ts-form-actions">
            <button type="submit">슬롯 저장</button>
          </div>
        </form>
      );

    case "articleRef":
      return (
        <form action={setArticleRefAction.bind(null, ctx.documentId, node.id)}>
          <input type="hidden" name="returnTo" value={returnToValue(ctx)} />
          <div className="ts-form-row">
            <label htmlFor="ref-scope">범위</label>
            <select id="ref-scope" name="scope" defaultValue={node.scope}>
              <option value="self">이 문면</option>
              <option value="general">대응 보통약관</option>
            </select>
          </div>
          <div className="ts-form-row ts-form-full">
            <label htmlFor="ref-targets">참조 대상 (여럿 고를 수 있다)</label>
            <select id="ref-targets" name="targets" multiple size={8} defaultValue={node.targets.map((t) => t.nodeId)}>
              <optgroup label="이 문면">
                {[...ctx.references.self].map(([nodeId, target]) => (
                  <option key={`self:${nodeId}`} value={nodeId}>
                    {referenceTargetLabel(target)}
                  </option>
                ))}
              </optgroup>
              <optgroup label="대응 보통약관">
                {[...ctx.references.general].map(([nodeId, target]) => (
                  <option key={`general:${nodeId}`} value={nodeId}>
                    {referenceTargetLabel(target)}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
          <div className="ts-form-row">
            <label htmlFor="ref-connector">연결어</label>
            <input id="ref-connector" type="text" name="connector" defaultValue={node.connector} />
          </div>
          <div className="ts-form-actions">
            <button type="submit">조 참조 저장</button>
          </div>
        </form>
      );

    case "appendixRef":
      return (
        <form action={setAppendixRefAction.bind(null, ctx.documentId, node.id)}>
          <input type="hidden" name="returnTo" value={returnToValue(ctx)} />
          <div className="ts-form-row">
            <label htmlFor="node-appendix">별표</label>
            <select id="node-appendix" name="appendixCode" defaultValue={node.appendixCode}>
              {data.appendices.map((a) => (
                <option key={a.code} value={a.code}>
                  {a.name}({a.code})
                </option>
              ))}
            </select>
          </div>
          <div className="ts-form-actions">
            <button type="submit">별표 저장</button>
          </div>
        </form>
      );

    case "clauseBlockRef":
    case "clauseInlineRef":
      return <OptionForm ctx={ctx} data={data} node={node} />;

    case "condBlock":
    case "inlineCond":
      return (
        <>
          <p className="ts-muted">가지를 누르면 그 조건식을 여기서 고칠 수 있다.</p>
          <ul>
            {node.branches.map((br) => (
              <li key={br.id}>
                <Link href={ctx.linkTo({ node: br.id })} className="ts-mono">
                  {chipText(br.when, "edit").full}
                </Link>
              </li>
            ))}
          </ul>
          <form action={addBranchAction.bind(null, ctx.documentId, node.id)}>
            <input type="hidden" name="returnTo" value={returnToValue(ctx)} />
            <div className="ts-form-row">
              <label htmlFor="branch-when">가지 추가</label>
              <input id="branch-when" type="text" name="when" placeholder="비우면 그 밖의 경우(else)" className="ts-mono" />
            </div>
            {node.kind === "inlineCond" && (
              <div className="ts-form-row">
                <label htmlFor="branch-text">첫 문장</label>
                <input id="branch-text" type="text" name="text" placeholder="선택" />
              </div>
            )}
            <div className="ts-form-actions">
              <button type="submit">가지 추가</button>
            </div>
          </form>
        </>
      );

    default:
      return <p className="ts-muted">이 종류는 아직 여기서 고칠 것이 없다.</p>;
  }
}

/* ── 문서 수준 ───────────────────────────────────────────────────────────── */

function DocumentForms({ ctx, data }: { ctx: DocCtx; data: PanelData }) {
  const generalValue = data.generalDocumentId ?? data.suggestedGeneralId ?? "";
  const proposed = data.generalDocumentId === undefined && data.suggestedGeneralId !== undefined;
  return (
    <>
      <p className="ts-muted">본문에서 고칠 자리의 ✎ 를 누르면 여기에 그 자리의 폼이 실린다.</p>

      <form action={setDocumentTitleAction.bind(null, ctx.documentId)}>

        <input type="hidden" name="returnTo" value={returnToValue(ctx)} />
        <div className="ts-form-row">
          <label htmlFor="doc-title">문면 이름</label>
          <input id="doc-title" type="text" name="title" defaultValue={data.documentTitle} />
        </div>
        <div className="ts-form-actions">
          <button type="submit">이름 저장</button>
        </div>
      </form>

      {ctx.docKind === "special" && (
        <form action={setGeneralDocumentAction.bind(null, ctx.documentId)}>
          <input type="hidden" name="returnTo" value={returnToValue(ctx)} />
          <div className="ts-form-row">
            <label htmlFor="doc-general">대응 보통약관</label>
            <span className="ts-form-control">
              <select id="doc-general" name="generalDocumentId" defaultValue={generalValue}>
                <option value="">— 해제 —</option>
                {data.generals.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}({DOC_KIND_LABEL.general})
                  </option>
                ))}
              </select>
              {proposed && <span className="ts-badge proposed">제안값 — 저장해야 확정</span>}
            </span>
          </div>
          <div className="ts-form-actions">
            <button type="submit">대응 보통약관 저장</button>
          </div>
        </form>
      )}

      <AddForm ctx={ctx} data={data} parentId={data.tree.id} mode="top" />

      <h3 className="ts-form-title">
        저장 검증{" "}
        <span className="ts-count">
          <b>{data.issues.length}</b> / 노드 {data.index.nodes.size}
        </span>
      </h3>
      {data.issues.length === 0 ? <p className="ts-ok">문제 없음.</p> : <IssueList issues={data.issues} />}

      <h3 className="ts-form-title">문면 삭제</h3>
      <p>
        <Link className="ts-iconbtn danger" href={ctx.linkTo({ del: "1" })} title={`문면 ${data.documentTitle} 삭제`} aria-label={`문면 ${data.documentTitle} 삭제`}>
          <IconTrash />
        </Link>
      </p>
    </>
  );
}

/* ── 사전평가 (읽기 모드) ────────────────────────────────────────────────── */

function EvalLines({ data, index }: { data: PanelData; index: TreeIndex }) {
  const conds = [...index.nodes.values()].map((e) => e.node).filter((n): n is Node & { branches: (BlockBranch | InlineBranch)[] } => n.kind === "condBlock" || n.kind === "inlineCond");
  if (conds.length === 0) return <p className="ts-muted">조건식이 없는 문면이다 — 평가할 분기가 없다.</p>;
  return (
    <>
      {conds.map((cond) => {
        const taken = cond.branches.find((br) => data.branchEval?.get(br.id)?.state === "taken");
        return (
          <div key={cond.id} style={{ margin: "6px 0" }}>
            {cond.branches.map((br) => {
              const ev = data.branchEval?.get(br.id);
              const verdict = ev?.state === "taken" ? "참" : ev?.state === "notTaken" ? "거짓" : ev?.state === "undetermined" ? `미결 (${ev.reason ?? "문맥 부족"})` : ev?.state === "error" ? `오류 — ${ev.issue?.message ?? ""}` : "평가 안 됨";
              return (
                <p key={br.id} className="ts-doc-cond-head" title={chipText(br.when, "edit").full}>
                  {chipText(br.when, "read").text} · {verdict}
                </p>
              );
            })}
            <p className="ts-muted">채택 분기: {taken ? chipText(taken.when, "read").text : "없음 (어느 가지도 타지 않았다)"}</p>
          </div>
        );
      })}
    </>
  );
}

function EvalPanel({ ctx, data }: { ctx: DocCtx; data: PanelData }) {
  return (
    <>
      <h3 className="ts-form-title">사전평가 · 미리보기</h3>
      {!data.evalAvailable ? (
        <div className="ts-empty">
          <p className="ts-empty-what">{data.evalNote ?? "이 문면은 사전평가 문맥을 만들 수 없다."}</p>
          <p className="ts-empty-example">사전평가는 담보약관에서 담보 마스터 값을 문맥으로 삼아 돈다.</p>
          <p className="ts-empty-action">
            <Link href="/products">상품 조립 미리보기로 →</Link>
          </p>
        </div>
      ) : (
        <>
          <p className="ts-muted">담보 마스터 값을 문맥으로 조건식을 평가한다. 실시간이 아니라 눌러서 돌린다.</p>
          {/* 패널의 주 행동은 텍스트 버튼을 유지한다 (§1.6 예외 ①). 실시간이 아니라 눌러서 돈다. */}
          <form method="get" className="ts-form-actions">
            {ctx.mode === "edit" && <input type="hidden" name="mode" value="edit" />}
            {ctx.selectedId !== undefined && <input type="hidden" name="node" value={ctx.selectedId} />}
            {data.evalRan ? (
              <button type="submit" title="평가 결과를 지우고 원래 문면으로 돌아간다">
                평가 결과 지우기
              </button>
            ) : (
              <button type="submit" name="view" value="eval" className="primary" title="담보 마스터 값을 문맥으로 조건식을 평가한다">
                미리보기
              </button>
            )}
          </form>
          {data.evalRan && (
            <>
              <EvalLines data={data} index={data.index} />
              <h3 className="ts-form-title">결과 문면</h3>
              {data.rendered}
            </>
          )}
        </>
      )}
    </>
  );
}

/* ── 패널 ────────────────────────────────────────────────────────────────── */

export function SidePanel({ ctx, data, confirm }: { ctx: DocCtx; data: PanelData; confirm?: ReactNode }) {
  if (confirm) return <aside className="ts-l3-side">{confirm}</aside>;
  if (ctx.mode === "read") {
    return (
      <aside className="ts-l3-side">
        <EvalPanel ctx={ctx} data={data} />
      </aside>
    );
  }
  const selected = ctx.selectedId !== undefined ? data.index.nodes.get(ctx.selectedId) : undefined;
  const branch = ctx.selectedId !== undefined ? data.index.branches.get(ctx.selectedId) : undefined;

  if (branch) {
    const owner = data.index.nodes.get(branch.ownerId);
    const inline = owner?.node.kind === "inlineCond";
    return (
      <aside className="ts-l3-side">
        <h3 className="ts-form-title">조건 가지</h3>
        <BranchForms ctx={ctx} data={data} branch={branch.branch} inline={inline} />
      </aside>
    );
  }

  if (!selected) {
    return (
      <aside className="ts-l3-side">
        <h3 className="ts-form-title">문면 전체</h3>
        <DocumentForms ctx={ctx} data={data} />
      </aside>
    );
  }

  const num = ctx.numbers.get(selected.node.id);
  const title = selected.node.kind === "article" ? `${num?.label ?? "조"}(${(selected.node as { title: string }).title})` : (num?.label ?? KIND_LABEL[selected.node.kind] ?? selected.node.kind);
  return (
    <aside className="ts-l3-side">
      <h3 className="ts-form-title">
        {title} <span className="ts-muted">{KIND_LABEL[selected.node.kind] ?? selected.node.kind}</span>
      </h3>
      <p>
        <Link href={ctx.linkTo({ node: undefined })}>← 문면 전체로</Link>
      </p>
      {/* 인라인 자리는 본문에 아이콘이 없으므로 (§2 L3) 이동·복제·삭제를 여기서 준다. */}
      <div style={{ marginBottom: 8, overflow: "hidden" }}>
        <NodeControls ctx={ctx} nodeId={selected.node.id} what={title} />
      </div>
      <NodeForms ctx={ctx} data={data} node={selected.node} />
    </aside>
  );
}

function BranchForms({ ctx, data, branch, inline }: { ctx: DocCtx; data: PanelData; branch: BlockBranch | InlineBranch; inline: boolean }) {
  const ev = data.branchEval?.get(branch.id);
  return (
    <>
      <p>
        <Link href={ctx.linkTo({ node: undefined })}>← 문면 전체로</Link>
      </p>
      <form action={setWhenAction.bind(null, ctx.documentId, branch.id)}>
        <input type="hidden" name="returnTo" value={returnToValue(ctx)} />
        <div className="ts-form-row ts-form-full">
          <label htmlFor="branch-expr">조건식</label>
          <textarea id="branch-expr" name="when" rows={3} defaultValue={branch.when ?? ""} className="ts-mono" placeholder="비우면 그 밖의 경우(else) 가지가 된다" />
        </div>
        <div className="ts-form-actions">
          <button type="submit">수정</button>
        </div>
      </form>
      {ev && (
        <p className="ts-muted">
          사전평가: {ev.state === "taken" ? "참" : ev.state === "notTaken" ? "거짓" : ev.state === "undetermined" ? `미결 — ${ev.reason ?? ""}` : `오류 — ${ev.issue?.message ?? ""}`}
        </p>
      )}
      <AddForm ctx={ctx} data={data} parentId={branch.id} mode={inline ? "inline" : "block"} />
      <h3 className="ts-form-title">가지 삭제</h3>
      <form action={removeBranchAction.bind(null, ctx.documentId, branch.id)}>
        <input type="hidden" name="returnTo" value={returnToValue(ctx)} />
        <IconButton type="submit" danger label={`조건 가지 「${chipText(branch.when, "edit").full}」 와 그 안의 내용을 삭제`} icon={<IconTrash />} />
      </form>
    </>
  );
}
