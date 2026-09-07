"use server";

import { redirect } from "next/navigation";

import { describeRejection, errorRedirectPath } from "@/app/_lib/rejection";
import type { ArticleRefNode, BlockNode, Command, InlineNode } from "@/domain/document";
import { indexTree, nodeBuilders } from "@/domain/document";
import type { Id } from "@/domain/types";
import { currentActor, getServices } from "@/lib/services";

import { moveTarget, parseLines, parseOptions, parseTableForm, str } from "./lib";

const BASE = "/documents";

function msg(r: Parameters<typeof describeRejection>[0]): string {
  return describeRejection(r).message;
}
function detailPath(id: Id): string {
  return `${BASE}/${id}`;
}

/**
 * 저장 뒤 돌아갈 자리 — 폼이 숨은 `returnTo` 로 지금 화면의 쿼리(`?mode=edit&node=…`)를 넘긴다.
 * L3 저작 화면(ADR-0012)은 모드·선택 자리를 쿼리로 나르므로, 이것이 없으면 저장할 때마다 편집 모드에서 튕긴다.
 * 넘기지 않는 호출부는 예전처럼 상세 기본 경로로 간다.
 */
function backTo(id: Id, formData?: FormData): string {
  const q = formData ? String(formData.get("returnTo") ?? "").trim() : "";
  return q.startsWith("?") && !q.includes("//") ? `${detailPath(id)}${q}` : detailPath(id);
}

async function apply(id: Id, commands: Command[], formData?: FormData): Promise<void> {
  const actor = await currentActor();
  const back = backTo(id, formData);
  const r = await getServices().document.apply(actor, id, commands);
  if (!r.ok) redirect(errorRedirectPath(back, msg(r.rejection)));
  redirect(back);
}

// ───────────────────────────── 문서 자체 ─────────────────────────────

export async function createGeneralAction(formData: FormData): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().document.createGeneral(actor, str(formData, "title"));
  if (!r.ok) redirect(errorRedirectPath(BASE, msg(r.rejection)));
  redirect(detailPath(r.value.id));
}

export async function duplicateGeneralAction(id: Id, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().document.duplicate(actor, id, { title: str(formData, "title") });
  if (!r.ok) redirect(errorRedirectPath(BASE, msg(r.rejection)));
  redirect(detailPath(r.value.id));
}

export async function setDocumentTitleAction(id: Id, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const back = backTo(id, formData);
  const r = await getServices().document.setTitle(actor, id, str(formData, "title"));
  if (!r.ok) redirect(errorRedirectPath(back, msg(r.rejection)));
  redirect(back);
}

export async function removeDocumentAction(id: Id): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().document.remove(actor, id, { confirm: true });
  if (!r.ok) redirect(errorRedirectPath(detailPath(id), msg(r.rejection)));
  redirect(BASE);
}

// ───────────────────────────── 트리 커맨드 (전부 한 줄 apply) ─────────────────────────────

export async function insertNodeAction(documentId: Id, parentId: Id, slot: "children" | "items" | "subitems" | undefined, formData: FormData): Promise<void> {
  const kind = str(formData, "kind");
  const b = nodeBuilders();
  const at = { parentId, ...(slot ? { slot } : {}) };
  let node: BlockNode | InlineNode | undefined;
  switch (kind) {
    case "article":
      node = b.article(str(formData, "title") || "새 조", []);
      break;
    case "section":
      node = b.section(str(formData, "title") || "새 관", []);
      break;
    case "table":
      node = b.table(parseTableForm(formData));
      break;
    case "box":
      node = b.box(str(formData, "title") || "용어풀이", parseLines(String(formData.get("lines") ?? "")));
      break;
    case "paragraph":
      node = b.paragraph([]);
      break;
    case "item":
      node = b.item([]);
      break;
    case "subitem":
      node = b.subitem([]);
      break;
    case "text":
      node = b.text(str(formData, "text"));
      break;
    case "slot":
      node = b.slot(str(formData, "ref"));
      break;
    case "articleRef":
      {
        const [scope, ...targetParts] = str(formData, "articleTarget").split(":");
        node = b.articleRef(targetParts.join(":"), scope === "general" ? "general" : "self");
      }
      break;
    case "appendixRef":
      node = b.appendixRef(str(formData, "appendixCode"));
      break;
    case "clauseBlockRef":
      node = b.clauseBlock(str(formData, "clauseCode"), parseOptions(str(formData, "options")));
      break;
    case "clauseInlineRef":
      node = b.clauseInline(str(formData, "clauseCode"), parseOptions(str(formData, "options")));
      break;
    case "inlineCond": {
      const when = str(formData, "when") || undefined;
      const thenText = str(formData, "thenText");
      const elseText = str(formData, "elseText");
      node = b.inlineCond([b.inlineBranch(when, thenText ? [b.text(thenText)] : []), b.inlineBranch(undefined, elseText ? [b.text(elseText)] : [])]);
      break;
    }
    case "condBlock": {
      const when = str(formData, "when") || undefined;
      node = b.condBlock([b.branch(when, [])]);
      break;
    }
    default:
      redirect(errorRedirectPath(detailPath(documentId), `지원하지 않는 노드 종류입니다: ${kind}`));
  }
  await apply(documentId, [{ type: "insert", node: node!, at }], formData);
}

export async function removeNodeAction(documentId: Id, nodeId: Id, formData?: FormData): Promise<void> {
  await apply(documentId, [{ type: "remove", nodeId }], formData);
}

export async function moveNodeAction(documentId: Id, nodeId: Id, dir: -1 | 1, formData?: FormData): Promise<void> {
  const services = getServices();
  const doc = await services.document.get(documentId);
  if (!doc) redirect(errorRedirectPath(BASE, "문서를 찾을 수 없습니다."));
  const to = moveTarget(doc.tree, nodeId, dir);
  if (!to) redirect(backTo(documentId, formData)); // 경계 — 조용히 무시
  await apply(documentId, [{ type: "move", nodeId, to }], formData);
}

export async function duplicateNodeAction(documentId: Id, nodeId: Id, formData?: FormData): Promise<void> {
  await apply(documentId, [{ type: "duplicate", nodeId }], formData);
}

/**
 * 문장(텍스트런) 저장 — **좌우 공백을 자르지 않는다.** 텍스트런은 슬롯·참조 앞뒤의 한 칸을 스스로 들고 있어서
 * (「계약일부터 」 + 슬롯 + 「 이내에는」), 자르면 조립 문면에서 글자가 붙어 버린다.
 */
export async function setTextAction(documentId: Id, nodeId: Id, formData: FormData): Promise<void> {
  const text = String(formData.get("text") ?? "");
  await apply(documentId, [{ type: "setText", nodeId, text }], formData);
}

/** 표 내용 통째 저장 — 제목 · 열 너비 · 제목줄 수 · 행 (ADR-0029). */
export async function setTableAction(documentId: Id, nodeId: Id, formData: FormData): Promise<void> {
  await apply(documentId, [{ type: "setTable", nodeId, ...parseTableForm(formData) }], formData);
}

/** 박스 내용 저장 — 제목 · 줄. */
export async function setBoxAction(documentId: Id, nodeId: Id, formData: FormData): Promise<void> {
  await apply(documentId, [{ type: "setBox", nodeId, title: str(formData, "title"), lines: parseLines(String(formData.get("lines") ?? "")) }], formData);
}

/** 조 명 · 관 제목 (같은 setTitle 커맨드). */
export async function setArticleTitleAction(documentId: Id, nodeId: Id, formData: FormData): Promise<void> {
  await apply(documentId, [{ type: "setTitle", nodeId, title: str(formData, "title") }], formData);
}

export async function setSlotRefAction(documentId: Id, nodeId: Id, formData: FormData): Promise<void> {
  await apply(documentId, [{ type: "setSlotRef", nodeId, ref: str(formData, "ref") }], formData);
}

export async function setArticleRefAction(documentId: Id, nodeId: Id, formData: FormData): Promise<void> {
  const targets = formData.getAll("targets").flatMap((value) => String(value).split(",")).map((targetId) => targetId.trim()).filter(Boolean).map((targetId) => ({ nodeId: targetId }));
  await apply(documentId, [{ type: "setArticleRef", nodeId, targets, connector: str(formData, "connector") || "및", scope: (str(formData, "scope") || "self") as ArticleRefNode["scope"] }], formData);
}

export async function setAppendixRefAction(documentId: Id, nodeId: Id, formData: FormData): Promise<void> {
  await apply(documentId, [{ type: "setAppendixRef", nodeId, appendixCode: str(formData, "appendixCode") }], formData);
}

/**
 * 공용조항 옵션 선택 저장.
 * 옵션마다 `option:<옵션코드>` select 로 받는다 (L3 우측 패널 — 리뷰 #65). 그런 필드가 하나도 없으면
 * 예전의 `options` JSON 필드로 되돌아간다 (기존 호출부 호환).
 */
export async function setClauseOptionsAction(documentId: Id, nodeId: Id, formData: FormData): Promise<void> {
  const picked: Record<string, string> = {};
  let sawSelect = false;
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("option:")) continue;
    sawSelect = true;
    const code = key.slice("option:".length);
    const chosen = String(value).trim();
    if (chosen !== "") picked[code] = chosen;
  }
  const options = sawSelect ? picked : parseOptions(str(formData, "options"));
  await apply(documentId, [{ type: "setClauseOptions", nodeId, options }], formData);
}

export async function addBranchAction(documentId: Id, condId: Id, formData: FormData): Promise<void> {
  const services = getServices();
  const doc = await services.document.get(documentId);
  if (!doc) redirect(errorRedirectPath(BASE, "문서를 찾을 수 없습니다."));
  const ix = indexTree(doc.tree);
  const entry = ix.nodes.get(condId);
  if (!entry) redirect(errorRedirectPath(detailPath(documentId), "조건 노드를 찾을 수 없습니다."));
  const when = str(formData, "when") || undefined;
  const text = str(formData, "text");
  const b = nodeBuilders();
  const branch = entry.node.kind === "inlineCond" ? b.inlineBranch(when, text ? [b.text(text)] : []) : b.branch(when, []);
  await apply(documentId, [{ type: "addBranch", condId, branch }], formData);
}

export async function setWhenAction(documentId: Id, branchId: Id, formData: FormData): Promise<void> {
  const when = str(formData, "when");
  await apply(documentId, [{ type: "setWhen", branchId, ...(when ? { when } : {}) }], formData);
}

export async function removeBranchAction(documentId: Id, branchId: Id, formData?: FormData): Promise<void> {
  const actor = await currentActor();
  const back = backTo(documentId, formData);
  const r = await getServices().document.apply(actor, documentId, [{ type: "removeBranch", branchId }]);
  if (!r.ok) redirect(errorRedirectPath(back, msg(r.rejection)));
  redirect(back);
}

export async function linkArticleAction(documentId: Id, articleId: Id, formData: FormData): Promise<void> {
  const linkedArticleId = str(formData, "linkedArticleId") || undefined;
  await apply(documentId, [{ type: "link", articleId, linkedArticleId }], formData);
}

export async function setGeneralDocumentAction(specialId: Id, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const back = backTo(specialId, formData);
  const generalId = str(formData, "generalDocumentId") || undefined;
  const r = await getServices().document.setGeneralDocument(actor, specialId, generalId);
  if (!r.ok) redirect(errorRedirectPath(back, msg(r.rejection)));
  redirect(back);
}
