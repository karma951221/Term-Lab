"use server";

import { redirect } from "next/navigation";

import { describeRejection, errorRedirectPath } from "@/app/_lib/rejection";
import type { ArticleRefNode, BlockNode, Command, InlineNode } from "@/domain/document";
import { indexTree, nodeBuilders } from "@/domain/document";
import type { Id } from "@/domain/types";
import { currentActor, getServices } from "@/lib/services";

import { moveTarget, parseOptions, str } from "./lib";

const BASE = "/documents";

function msg(r: Parameters<typeof describeRejection>[0]): string {
  return describeRejection(r).message;
}
function detailPath(id: Id): string {
  return `${BASE}/${id}`;
}

async function apply(id: Id, commands: Command[]): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().document.apply(actor, id, commands);
  if (!r.ok) redirect(errorRedirectPath(detailPath(id), msg(r.rejection)));
  redirect(detailPath(id));
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
  const r = await getServices().document.setTitle(actor, id, str(formData, "title"));
  if (!r.ok) redirect(errorRedirectPath(detailPath(id), msg(r.rejection)));
  redirect(detailPath(id));
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
      node = b.articleRef(str(formData, "articleId"), (str(formData, "scope") || "self") as "self" | "general");
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
  await apply(documentId, [{ type: "insert", node: node!, at }]);
}

export async function removeNodeAction(documentId: Id, nodeId: Id): Promise<void> {
  await apply(documentId, [{ type: "remove", nodeId }]);
}

export async function moveNodeAction(documentId: Id, nodeId: Id, dir: -1 | 1): Promise<void> {
  const services = getServices();
  const doc = await services.document.get(documentId);
  if (!doc) redirect(errorRedirectPath(BASE, "문서를 찾을 수 없습니다."));
  const to = moveTarget(doc.tree, nodeId, dir);
  if (!to) redirect(detailPath(documentId)); // 경계 — 조용히 무시
  await apply(documentId, [{ type: "move", nodeId, to }]);
}

export async function duplicateNodeAction(documentId: Id, nodeId: Id): Promise<void> {
  await apply(documentId, [{ type: "duplicate", nodeId }]);
}

export async function setTextAction(documentId: Id, nodeId: Id, formData: FormData): Promise<void> {
  await apply(documentId, [{ type: "setText", nodeId, text: str(formData, "text") }]);
}

export async function setArticleTitleAction(documentId: Id, nodeId: Id, formData: FormData): Promise<void> {
  await apply(documentId, [{ type: "setTitle", nodeId, title: str(formData, "title") }]);
}

export async function setSlotRefAction(documentId: Id, nodeId: Id, formData: FormData): Promise<void> {
  await apply(documentId, [{ type: "setSlotRef", nodeId, ref: str(formData, "ref") }]);
}

export async function setArticleRefAction(documentId: Id, nodeId: Id, formData: FormData): Promise<void> {
  await apply(documentId, [{ type: "setArticleRef", nodeId, articleId: str(formData, "articleId"), scope: (str(formData, "scope") || "self") as ArticleRefNode["scope"] }]);
}

export async function setAppendixRefAction(documentId: Id, nodeId: Id, formData: FormData): Promise<void> {
  await apply(documentId, [{ type: "setAppendixRef", nodeId, appendixCode: str(formData, "appendixCode") }]);
}

export async function setClauseOptionsAction(documentId: Id, nodeId: Id, formData: FormData): Promise<void> {
  await apply(documentId, [{ type: "setClauseOptions", nodeId, options: parseOptions(str(formData, "options")) }]);
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
  await apply(documentId, [{ type: "addBranch", condId, branch }]);
}

export async function setWhenAction(documentId: Id, branchId: Id, formData: FormData): Promise<void> {
  const when = str(formData, "when");
  await apply(documentId, [{ type: "setWhen", branchId, ...(when ? { when } : {}) }]);
}

export async function removeBranchAction(documentId: Id, branchId: Id): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().document.apply(actor, documentId, [{ type: "removeBranch", branchId }]);
  if (!r.ok) redirect(errorRedirectPath(detailPath(documentId), msg(r.rejection)));
  redirect(detailPath(documentId));
}

export async function linkArticleAction(documentId: Id, articleId: Id, formData: FormData): Promise<void> {
  const linkedArticleId = str(formData, "linkedArticleId") || undefined;
  await apply(documentId, [{ type: "link", articleId, linkedArticleId }]);
}

export async function setGeneralDocumentAction(specialId: Id, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const generalId = str(formData, "generalDocumentId") || undefined;
  const r = await getServices().document.setGeneralDocument(actor, specialId, generalId);
  if (!r.ok) redirect(errorRedirectPath(detailPath(specialId), msg(r.rejection)));
  redirect(detailPath(specialId));
}
