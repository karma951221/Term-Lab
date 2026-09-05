import Link from "next/link";
import type { ReactNode } from "react";

import { Confirm } from "@/app/_components/Confirm";
import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { IssueList } from "@/app/_components/IssueList";
import { previewOutcome } from "@/app/_lib/rejection";
import { masterCatalog, masterEvalContext } from "@/domain/coverage";
import type { Appendix, BlockBranch, BranchEvaluation, InlineBranch, Node, NodeKind } from "@/domain/document";
import type { Id } from "@/domain/types";
import { currentActor, getServices } from "@/lib/services";

import {
  addBranchAction,
  duplicateNodeAction,
  insertNodeAction,
  linkArticleAction,
  moveNodeAction,
  removeBranchAction,
  removeDocumentAction,
  removeNodeAction,
  setAppendixRefAction,
  setArticleRefAction,
  setArticleTitleAction,
  setClauseOptionsAction,
  setDocumentTitleAction,
  setGeneralDocumentAction,
  setSlotRefAction,
  setTextAction,
  setWhenAction,
} from "../actions";

export const dynamic = "force-dynamic";

interface Ctx {
  documentId: Id;
  docKind: "special" | "general";
  numbers: Map<Id, { n: number; label: string }>;
  branchEval?: Map<Id, BranchEvaluation>;
  appendices: Appendix[];
}

const KIND_LABEL: Record<string, string> = {
  article: "조",
  paragraph: "항",
  item: "호",
  subitem: "목",
  text: "텍스트",
  slot: "슬롯",
  inlineCond: "인라인 조건",
  condBlock: "조건 블록",
  clauseBlockRef: "공용조항(block)",
  clauseInlineRef: "공용조항(inline)",
  articleRef: "조 참조",
  appendixRef: "별표 참조",
};

const MODE_KINDS = {
  top: ["article", "condBlock"],
  block: ["paragraph", "condBlock", "clauseBlockRef"],
  inline: ["text", "slot", "inlineCond", "articleRef", "appendixRef", "clauseInlineRef"],
  item: ["item", "condBlock"],
  subitem: ["subitem", "condBlock"],
} satisfies Record<string, readonly NodeKind[]>;

function NodeActions({ documentId, nodeId }: { documentId: Id; nodeId: Id }) {
  return (
    <span className="ts-node-actions">
      <form action={moveNodeAction.bind(null, documentId, nodeId, -1)} style={{ display: "inline" }}>
        <button type="submit" title="위로 이동">
          ↑
        </button>
      </form>
      <form action={moveNodeAction.bind(null, documentId, nodeId, 1)} style={{ display: "inline" }}>
        <button type="submit" title="아래로 이동">
          ↓
        </button>
      </form>
      <form action={duplicateNodeAction.bind(null, documentId, nodeId)} style={{ display: "inline" }}>
        <button type="submit" title="복제">
          ⧉
        </button>
      </form>
      <form action={removeNodeAction.bind(null, documentId, nodeId)} style={{ display: "inline" }}>
        <button type="submit" className="danger" title="삭제">
          ✕
        </button>
      </form>
    </span>
  );
}

function InsertMenu({
  documentId,
  parentId,
  slot,
  mode,
  appendices,
}: {
  documentId: Id;
  parentId: Id;
  slot?: "children" | "items" | "subitems";
  mode: keyof typeof MODE_KINDS;
  appendices: Appendix[];
}) {
  const kinds = MODE_KINDS[mode];
  return (
    <details className="ts-insert-menu">
      <summary>+ 추가</summary>
      <form action={insertNodeAction.bind(null, documentId, parentId, slot)} className="ts-form" style={{ maxWidth: "none" }}>
        <label className="ts-field">
          <span>종류</span>
          <select name="kind">
            {kinds.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k] ?? k}
              </option>
            ))}
          </select>
        </label>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          <input type="text" name="title" placeholder="조 제목" />
          <input type="text" name="text" placeholder="텍스트" />
          <input type="text" name="ref" placeholder="슬롯 참조 경로 (D0001.F01)" className="ts-mono" />
          <input type="text" name="when" placeholder="조건식 (when)" className="ts-mono" />
          <input type="text" name="thenText" placeholder="참일 때 텍스트" />
          <input type="text" name="elseText" placeholder="else 텍스트" />
          <input type="text" name="articleId" placeholder="조 참조 대상 id" className="ts-mono" />
          <select name="scope" defaultValue="self">
            <option value="self">이 문서 조</option>
            <option value="general">보통약관 조</option>
          </select>
          {appendices.length > 0 ? (
            <select name="appendixCode">
              {appendices.map((a) => (
                <option key={a.code} value={a.code}>
                  {a.name} ({a.code})
                </option>
              ))}
            </select>
          ) : (
            <input type="text" name="appendixCode" placeholder="별표 코드" />
          )}
          <input type="text" name="clauseCode" placeholder="공용조항 코드" />
          <input type="text" name="options" placeholder='옵션 JSON {"O01":"V01"}' />
        </div>
        <div className="ts-form-actions">
          <button type="submit">추가</button>
        </div>
      </form>
    </details>
  );
}

function renderBranch(br: BlockBranch | InlineBranch, ctx: Ctx, inline: boolean): ReactNode {
  const ev = ctx.branchEval?.get(br.id);
  const dim = ev?.state === "notTaken";
  return (
    <div key={br.id} className={`ts-cond-branch${dim ? " ts-dim" : ""}`}>
      <form action={setWhenAction.bind(null, ctx.documentId, br.id)} style={{ display: "inline-flex", gap: 4 }}>
        <input type="text" name="when" defaultValue={br.when ?? ""} placeholder="(else)" className="ts-mono" />
        <button type="submit">식 저장</button>
      </form>
      {ev?.state === "undetermined" && <span className="ts-badge undetermined">미결</span>}
      {ev?.state === "error" && <span className="ts-badge" style={{ color: "var(--ts-error)" }}>오류: {ev.issue?.message}</span>}
      <form action={removeBranchAction.bind(null, ctx.documentId, br.id)} style={{ display: "inline" }}>
        <button type="submit" className="danger">
          가지 삭제
        </button>
      </form>
      <div style={{ paddingLeft: 12 }}>
        {(br.children as Node[]).map((c) => renderNode(c, ctx))}
        <InsertMenu documentId={ctx.documentId} parentId={br.id} mode={inline ? "inline" : "block"} appendices={ctx.appendices} />
      </div>
    </div>
  );
}

function AddBranchForm({ documentId, condId }: { documentId: Id; condId: Id }) {
  return (
    <form action={addBranchAction.bind(null, documentId, condId)} style={{ display: "flex", gap: 4 }}>
      <input type="text" name="when" placeholder="조건식 (비우면 else)" className="ts-mono" />
      <input type="text" name="text" placeholder="가지 첫 텍스트 (선택)" />
      <button type="submit">가지 추가</button>
    </form>
  );
}

function renderNode(node: Node, ctx: Ctx): ReactNode {
  const num = ctx.numbers.get(node.id);
  const actions = <NodeActions documentId={ctx.documentId} nodeId={node.id} />;

  switch (node.kind) {
    case "document":
      return (
        <div key={node.id}>
          {node.children.map((c) => renderNode(c, ctx))}
          <InsertMenu documentId={ctx.documentId} parentId={node.id} mode="top" appendices={ctx.appendices} />
        </div>
      );

    case "article":
      return (
        <section key={node.id} className="ts-panel">
          <div className="ts-tree-row">
            <strong>{num?.label}</strong>
            <form action={setArticleTitleAction.bind(null, ctx.documentId, node.id)} style={{ display: "inline-flex", gap: 4 }}>
              <input type="text" name="title" defaultValue={node.title} />
              <button type="submit">제목 저장</button>
            </form>
            <code className="ts-muted">{node.id.slice(0, 8)}</code>
            {actions}
          </div>
          {ctx.docKind === "special" && (
            <form action={linkArticleAction.bind(null, ctx.documentId, node.id)} style={{ display: "flex", gap: 4 }}>
              <span className="ts-muted">조연결(보통약관 조 id):</span>
              <input type="text" name="linkedArticleId" defaultValue={node.linkedArticleId ?? ""} className="ts-mono" />
              <button type="submit">저장</button>
            </form>
          )}
          <div style={{ paddingLeft: 16 }}>
            {node.children.map((c) => renderNode(c, ctx))}
            <InsertMenu documentId={ctx.documentId} parentId={node.id} mode="block" appendices={ctx.appendices} />
          </div>
        </section>
      );

    case "paragraph":
      return (
        <div key={node.id} className="ts-tree-row" style={{ alignItems: "flex-start" }}>
          <div>
            <span className="ts-muted">{num?.label}</span> {node.children.map((c) => renderNode(c, ctx))}
            {actions}
            <InsertMenu documentId={ctx.documentId} parentId={node.id} slot="children" mode="inline" appendices={ctx.appendices} />
            <div style={{ paddingLeft: 16 }}>
              {(node.items ?? []).map((c) => renderNode(c, ctx))}
              <InsertMenu documentId={ctx.documentId} parentId={node.id} slot="items" mode="item" appendices={ctx.appendices} />
            </div>
          </div>
        </div>
      );

    case "item":
      return (
        <div key={node.id}>
          <span className="ts-muted">{num?.label}</span> {node.children.map((c) => renderNode(c, ctx))}
          {actions}
          <InsertMenu documentId={ctx.documentId} parentId={node.id} slot="children" mode="inline" appendices={ctx.appendices} />
          <div style={{ paddingLeft: 16 }}>
            {(node.subitems ?? []).map((c) => renderNode(c, ctx))}
            <InsertMenu documentId={ctx.documentId} parentId={node.id} slot="subitems" mode="subitem" appendices={ctx.appendices} />
          </div>
        </div>
      );

    case "subitem":
      return (
        <div key={node.id}>
          <span className="ts-muted">{num?.label}</span> {node.children.map((c) => renderNode(c, ctx))}
          {actions}
          <InsertMenu documentId={ctx.documentId} parentId={node.id} slot="children" mode="inline" appendices={ctx.appendices} />
        </div>
      );

    case "condBlock":
      return (
        <div key={node.id} className="ts-cond">
          {node.branches.map((br) => renderBranch(br, ctx, false))}
          {actions}
          <AddBranchForm documentId={ctx.documentId} condId={node.id} />
        </div>
      );

    case "forBlock":
      return (
        <div key={node.id} className="ts-muted">
          (반복 블록 — 아직 미지원) {actions}
        </div>
      );

    case "clauseBlockRef":
      return (
        <div key={node.id}>
          공용조항(block) <code>{node.clauseCode}</code>
          <form action={setClauseOptionsAction.bind(null, ctx.documentId, node.id)} style={{ display: "inline-flex", gap: 4 }}>
            <input type="text" name="options" defaultValue={JSON.stringify(node.options)} className="ts-mono" />
            <button type="submit">옵션 저장</button>
          </form>
          {actions}
        </div>
      );

    case "text":
      return (
        <span key={node.id} className="ts-node-inline">
          <form action={setTextAction.bind(null, ctx.documentId, node.id)} style={{ display: "inline-flex", gap: 2 }}>
            <input type="text" name="text" defaultValue={node.text} />
            <button type="submit">✓</button>
          </form>
          {actions}
        </span>
      );

    case "slot":
      return (
        <span key={node.id} className="ts-node-inline">
          <span className="ts-derived-mark">ƒ</span>
          <form action={setSlotRefAction.bind(null, ctx.documentId, node.id)} style={{ display: "inline-flex", gap: 2 }}>
            <input type="text" name="ref" defaultValue={node.ref} className="ts-mono" />
            <button type="submit">✓</button>
          </form>
          {actions}
        </span>
      );

    case "inlineCond":
      return (
        <span key={node.id} className="ts-cond-inline">
          {node.branches.map((br) => renderBranch(br, ctx, true))}
          <AddBranchForm documentId={ctx.documentId} condId={node.id} />
          {actions}
        </span>
      );

    case "inlineFor":
      return (
        <span key={node.id} className="ts-muted">
          (인라인 반복 — 아직 미지원) {actions}
        </span>
      );

    case "articleRef":
      return (
        <span key={node.id} className="ts-node-inline">
          <form action={setArticleRefAction.bind(null, ctx.documentId, node.id)} style={{ display: "inline-flex", gap: 2 }}>
            <select name="scope" defaultValue={node.scope}>
              <option value="self">이 문서</option>
              <option value="general">보통약관</option>
            </select>
            <input type="text" name="articleId" defaultValue={node.articleId} className="ts-mono" />
            <button type="submit">저장</button>
          </form>
          {actions}
        </span>
      );

    case "appendixRef":
      return (
        <span key={node.id} className="ts-node-inline">
          <form action={setAppendixRefAction.bind(null, ctx.documentId, node.id)} style={{ display: "inline-flex", gap: 2 }}>
            <select name="appendixCode" defaultValue={node.appendixCode}>
              {ctx.appendices.map((a) => (
                <option key={a.code} value={a.code}>
                  {a.name}
                </option>
              ))}
            </select>
            <button type="submit">저장</button>
          </form>
          {actions}
        </span>
      );

    case "clauseInlineRef":
      return (
        <span key={node.id} className="ts-node-inline">
          공용조항 <code>{node.clauseCode}</code>
          <form action={setClauseOptionsAction.bind(null, ctx.documentId, node.id)} style={{ display: "inline-flex", gap: 2 }}>
            <input type="text" name="options" defaultValue={JSON.stringify(node.options)} className="ts-mono" />
            <button type="submit">옵션 저장</button>
          </form>
          {actions}
        </span>
      );
  }
}

export default async function DocumentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; del?: string; view?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const services = getServices();
  const doc = await services.document.get(id);
  if (!doc) {
    return (
      <div>
        <h1 className="ts-h1">문면</h1>
        <p className="ts-error-banner">찾을 수 없습니다.</p>
      </div>
    );
  }
  const actor = await currentActor();
  const appendices = await services.document.listAppendices();
  const issues = await services.document.validate(id);

  let branchEval: Map<Id, BranchEvaluation> | undefined;
  if (sp.view === "eval" && doc.kind === "special" && doc.ownerId) {
    const mv = await services.coverage.masterValues(doc.ownerId);
    if (mv.ok) {
      const defs = await services.catalog.list();
      const ctxEval = masterEvalContext(mv.value.tree, mv.value.values, masterCatalog(defs));
      const pre = await services.document.preEvaluate(id, ctxEval);
      branchEval = pre.branches;
    }
  }
  const numbers = await services.document.numbering(id, branchEval);

  const ctx: Ctx = { documentId: id, docKind: doc.kind, numbers, appendices, ...(branchEval ? { branchEval } : {}) };

  let deleteNode = null;
  if (sp.del === "1") {
    const outcome = previewOutcome(await services.document.remove(actor, id));
    deleteNode =
      outcome.kind === "confirm" ? (
        <Confirm impact={outcome.impact} action={removeDocumentAction.bind(null, id)} />
      ) : outcome.kind === "error" ? (
        <p className="ts-error-banner">{outcome.message}</p>
      ) : null;
  }

  return (
    <div>
      <h1 className="ts-h1">{doc.title}</h1>
      <ErrorBanner message={sp.error} />
      <p className="ts-toolbar">
        <Link href={`?view=all`}>전체 보기</Link>
        {doc.kind === "special" && <Link href={`?view=eval`}>사전평가 보기</Link>}
      </p>

      <form action={setDocumentTitleAction.bind(null, id)} className="ts-form">
        <label className="ts-field">
          <span>제목</span>
          <input type="text" name="title" defaultValue={doc.title} />
        </label>
        <div className="ts-form-actions">
          <button type="submit">저장</button>
        </div>
      </form>

      {doc.kind === "special" && (
        <form action={setGeneralDocumentAction.bind(null, id)} className="ts-form">
          <label className="ts-field">
            <span>대응 보통약관 id (비우면 해제)</span>
            <input type="text" name="generalDocumentId" defaultValue={doc.generalDocumentId ?? ""} className="ts-mono" />
          </label>
          <div className="ts-form-actions">
            <button type="submit">저장</button>
          </div>
        </form>
      )}

      <h2 className="ts-h2">저장 검증</h2>
      {issues.length === 0 ? <p className="ts-ok">문제 없음.</p> : <IssueList issues={issues} />}

      <h2 className="ts-h2">구조</h2>
      {renderNode(doc.tree, ctx)}

      <h2 className="ts-h2">삭제</h2>
      {sp.del === "1" ? deleteNode : <Link href="?del=1">문서 삭제…</Link>}

      <p style={{ marginTop: 24 }}>
        <Link href="/documents">← 목록으로</Link>
      </p>
    </div>
  );
}
