"use server";

import { redirect } from "next/navigation";

import type { ActionOutcome } from "@/app/_components/ValueForm";
import { str } from "@/app/_lib/formData";
import { describeRejection, errorRedirectPath } from "@/app/_lib/rejection";
import type { OverrideScope, SnapshotOwner } from "@/services/product";
import type { Code, Id } from "@/domain/types";
import type { Submission } from "@/forms";
import { currentActor, getServices } from "@/lib/services";

import { parseOptionSelection, parseSelections } from "./lib";

const BASE = "/products";

function msg(r: Parameters<typeof describeRejection>[0]): string {
  return describeRejection(r).message;
}
function detailPath(id: Id): string {
  return `${BASE}/${id}`;
}

// ───────────────────────────── 상품 ─────────────────────────────

export async function createProductAction(formData: FormData): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().product.createProduct(actor, { name: str(formData, "name") });
  if (!r.ok) redirect(errorRedirectPath(`${BASE}/new`, msg(r.rejection)));
  redirect(detailPath(r.value.id));
}

export async function renameProductAction(id: Id, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().product.renameProduct(actor, id, str(formData, "name"));
  if (!r.ok) redirect(errorRedirectPath(detailPath(id), msg(r.rejection)));
  redirect(detailPath(id));
}

export async function setProductGeneralDocumentAction(id: Id, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const generalDocumentId = str(formData, "generalDocumentId") || undefined;
  const r = await getServices().product.setGeneralDocument(actor, id, generalDocumentId);
  if (!r.ok) redirect(errorRedirectPath(detailPath(id), msg(r.rejection)));
  redirect(detailPath(id));
}

export async function deleteProductAction(id: Id): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().product.deleteProduct(actor, id, { confirm: true });
  if (!r.ok) redirect(errorRedirectPath(detailPath(id), msg(r.rejection)));
  redirect(BASE);
}

export async function writeProductValuesAction(productId: Id, submission: Submission): Promise<ActionOutcome> {
  const actor = await currentActor();
  const services = getServices();
  for (const entry of submission.values) {
    const [code, fieldCode] = entry.path.split(".");
    const r = await services.product.setProductValue(actor, productId, code, fieldCode || undefined, entry.value);
    if (!r.ok) {
      return {
        ok: false,
        issues: r.rejection.reason === "invalid" ? r.rejection.issues : [{ kind: "typeMismatch", message: msg(r.rejection), at: { refPath: entry.path } }],
      };
    }
  }
  return { ok: true };
}

// ───────────────────────────── 세목 ─────────────────────────────

export async function addPlanOptionAction(productId: Id, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().product.addPlanOption(actor, productId, {
    axis: str(formData, "axis") as "type" | "form",
    number: Number(str(formData, "number")),
    name: str(formData, "name"),
    planTypeCode: str(formData, "planTypeCode"),
  });
  if (!r.ok) redirect(errorRedirectPath(detailPath(productId), msg(r.rejection)));
  redirect(detailPath(productId));
}

export async function removePlanOptionAction(productId: Id, optionId: Id): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().product.removePlanOption(actor, optionId, { confirm: true });
  if (!r.ok) redirect(errorRedirectPath(detailPath(productId), msg(r.rejection)));
  redirect(detailPath(productId));
}

export async function registerPlanAction(productId: Id, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const optionIds = formData.getAll("optionIds").map(String);
  const r = await getServices().product.registerPlan(actor, productId, optionIds);
  if (!r.ok) redirect(errorRedirectPath(detailPath(productId), msg(r.rejection)));
  redirect(detailPath(productId));
}

export async function removePlanAction(productId: Id, planId: Id): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().product.removePlan(actor, planId, { confirm: true });
  if (!r.ok) redirect(errorRedirectPath(detailPath(productId), msg(r.rejection)));
  redirect(detailPath(productId));
}

// ───────────────────────────── 상품담보 = 탑재 ─────────────────────────────

export async function mountAction(productId: Id, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const services = getServices();
  const kinds = await services.product.listAttributeKinds();
  const coverageId = str(formData, "coverageId");
  const r = await services.product.mount(actor, productId, coverageId, parseSelections(formData, kinds));
  if (!r.ok) redirect(errorRedirectPath(detailPath(productId), msg(r.rejection)));
  redirect(`${detailPath(productId)}/coverages/${r.value.id}`);
}

export async function renameProductCoverageAction(productId: Id, pcId: Id, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().product.renameProductCoverage(actor, pcId, str(formData, "name"));
  if (!r.ok) redirect(errorRedirectPath(detailPath(productId), msg(r.rejection)));
  redirect(detailPath(productId));
}

export async function regenerateNameAction(productId: Id, pcId: Id): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().product.regenerateName(actor, pcId);
  if (!r.ok) redirect(errorRedirectPath(detailPath(productId), msg(r.rejection)));
  redirect(detailPath(productId));
}

export async function setAttributesAction(productId: Id, pcId: Id, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const services = getServices();
  const kinds = await services.product.listAttributeKinds();
  const r = await services.product.setAttributes(actor, pcId, parseSelections(formData, kinds), { regenerateName: formData.get("regenerateName") === "on" });
  if (!r.ok) redirect(errorRedirectPath(detailPath(productId), msg(r.rejection)));
  redirect(detailPath(productId));
}

export async function unmountAction(productId: Id, pcId: Id): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().product.unmount(actor, pcId, { confirm: true });
  if (!r.ok) redirect(errorRedirectPath(detailPath(productId), msg(r.rejection)));
  redirect(detailPath(productId));
}

export async function attachPlanAction(productId: Id, pcId: Id, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().product.attachPlan(actor, pcId, str(formData, "planId"));
  if (!r.ok) redirect(errorRedirectPath(detailPath(productId), msg(r.rejection)));
  redirect(detailPath(productId));
}

export async function detachPlanAction(productId: Id, pcId: Id, planId: Id): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().product.detachPlan(actor, pcId, planId, { confirm: true });
  if (!r.ok) redirect(errorRedirectPath(detailPath(productId), msg(r.rejection)));
  redirect(detailPath(productId));
}

export async function writeSnapshotValuesAction(pcId: Id, owner: SnapshotOwner, submission: Submission): Promise<ActionOutcome> {
  const actor = await currentActor();
  const services = getServices();
  for (const entry of submission.values) {
    const [code, fieldCode] = entry.path.split(".");
    const r = await services.product.setSnapshotValue(actor, pcId, owner, code, fieldCode || undefined, entry.value);
    if (!r.ok) {
      return {
        ok: false,
        issues: r.rejection.reason === "invalid" ? r.rejection.issues : [{ kind: "typeMismatch", message: msg(r.rejection), at: { refPath: entry.path } }],
      };
    }
  }
  return { ok: true };
}

// ───────────────────────────── 기본계약 ─────────────────────────────

export async function designateBaseContractAction(productId: Id, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().product.designateBaseContract(actor, productId, str(formData, "productCoverageId"));
  if (!r.ok) redirect(errorRedirectPath(detailPath(productId), msg(r.rejection)));
  redirect(detailPath(productId));
}

export async function releaseBaseContractAction(productId: Id, pcId: Id): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().product.releaseBaseContract(actor, productId, pcId);
  if (!r.ok) redirect(errorRedirectPath(detailPath(productId), msg(r.rejection)));
  redirect(detailPath(productId));
}

// ───────────────────────────── 특약 그룹 ─────────────────────────────

export async function createGroupAction(productId: Id, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().product.createGroup(actor, productId, { title: str(formData, "title") });
  if (!r.ok) redirect(errorRedirectPath(detailPath(productId), msg(r.rejection)));
  redirect(detailPath(productId));
}

export async function renameGroupAction(productId: Id, groupId: Id, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().product.renameGroup(actor, groupId, str(formData, "title"));
  if (!r.ok) redirect(errorRedirectPath(detailPath(productId), msg(r.rejection)));
  redirect(detailPath(productId));
}

export async function reorderGroupsAction(productId: Id, order: Id[]): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().product.reorderGroups(actor, productId, order);
  if (!r.ok) redirect(errorRedirectPath(detailPath(productId), msg(r.rejection)));
  redirect(detailPath(productId));
}

export async function deleteGroupAction(productId: Id, groupId: Id): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().product.deleteGroup(actor, groupId);
  if (!r.ok) redirect(errorRedirectPath(detailPath(productId), msg(r.rejection)));
  redirect(detailPath(productId));
}

export async function placeInGroupAction(productId: Id, groupId: Id, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().product.placeInGroup(actor, groupId, str(formData, "productCoverageId"));
  if (!r.ok) redirect(errorRedirectPath(detailPath(productId), msg(r.rejection)));
  redirect(detailPath(productId));
}

export async function removeFromGroupAction(productId: Id, pcId: Id): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().product.removeFromGroup(actor, pcId);
  if (!r.ok) redirect(errorRedirectPath(detailPath(productId), msg(r.rejection)));
  redirect(detailPath(productId));
}

// ───────────────────────────── 옵션 오버라이드 ─────────────────────────────

/** nodeId·clauseCode 는 폼 입력(사용처 화면의 문면에서 복사한 참조 노드 id) — bind 는 productId·scope 만. */
export async function setOptionOverrideAction(productId: Id, scope: OverrideScope, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const nodeId = str(formData, "nodeId");
  const clauseCode = str(formData, "clauseCode");
  const r = await getServices().product.setOptionOverride(actor, scope, nodeId, clauseCode, parseOptionSelection(str(formData, "options")));
  if (!r.ok) redirect(errorRedirectPath(detailPath(productId), msg(r.rejection)));
  redirect(detailPath(productId));
}

export async function removeOptionOverrideAction(productId: Id, scope: OverrideScope, nodeId: Id, clauseCode: Code): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().product.removeOptionOverride(actor, scope, nodeId, clauseCode);
  if (!r.ok) redirect(errorRedirectPath(detailPath(productId), msg(r.rejection)));
  redirect(detailPath(productId));
}
