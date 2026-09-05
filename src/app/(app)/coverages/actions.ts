"use server";

import { redirect } from "next/navigation";

import { describeRejection, errorRedirectPath } from "@/app/_lib/rejection";
import type { ActionOutcome } from "@/app/_components/ValueForm";
import type { CoverageNodeRef } from "@/domain/coverage";
import type { Code, Id } from "@/domain/types";
import type { Submission } from "@/forms";
import { currentActor, getServices } from "@/lib/services";

import { moved, str } from "./lib";

const BASE = "/coverages";

function msg(r: Parameters<typeof describeRejection>[0]): string {
  return describeRejection(r).message;
}
function detailPath(id: Id, node?: string): string {
  return node ? `${BASE}/${id}?node=${node}` : `${BASE}/${id}`;
}

export async function createCoverageAction(formData: FormData): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().coverage.create(actor, {
    name: str(formData, "name"),
    description: str(formData, "description"),
    subCoverageName: str(formData, "subCoverageName") || undefined,
    benefitName: str(formData, "benefitName") || undefined,
  });
  if (!r.ok) redirect(errorRedirectPath(`${BASE}/new`, msg(r.rejection)));
  redirect(detailPath(r.value.id));
}

export async function renameCoverageAction(id: Id, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().coverage.rename(actor, id, str(formData, "name"));
  if (!r.ok) redirect(errorRedirectPath(detailPath(id), msg(r.rejection)));
  redirect(detailPath(id));
}

export async function setDescriptionAction(id: Id, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().coverage.setDescription(actor, id, str(formData, "description"));
  if (!r.ok) redirect(errorRedirectPath(detailPath(id), msg(r.rejection)));
  redirect(detailPath(id));
}

export async function addSubCoverageAction(coverageId: Id, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().coverage.addSubCoverage(actor, coverageId, {
    name: str(formData, "name"),
    benefitName: str(formData, "benefitName") || undefined,
  });
  if (!r.ok) redirect(errorRedirectPath(detailPath(coverageId), msg(r.rejection)));
  redirect(detailPath(coverageId));
}

export async function addBenefitAction(coverageId: Id, subCoverageId: Id, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().coverage.addBenefit(actor, subCoverageId, str(formData, "name"));
  if (!r.ok) redirect(errorRedirectPath(detailPath(coverageId), msg(r.rejection)));
  redirect(detailPath(coverageId));
}

export async function renameSubCoverageAction(coverageId: Id, subCoverageId: Id, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().coverage.renameSubCoverage(actor, subCoverageId, str(formData, "name"));
  if (!r.ok) redirect(errorRedirectPath(detailPath(coverageId), msg(r.rejection)));
  redirect(detailPath(coverageId));
}

export async function renameBenefitAction(coverageId: Id, benefitId: Id, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().coverage.renameBenefit(actor, benefitId, str(formData, "name"));
  if (!r.ok) redirect(errorRedirectPath(detailPath(coverageId), msg(r.rejection)));
  redirect(detailPath(coverageId));
}

export async function moveSubCoverageAction(coverageId: Id, subCoverageId: Id, dir: -1 | 1): Promise<void> {
  const actor = await currentActor();
  const services = getServices();
  const tree = await services.coverage.get(coverageId);
  if (!tree) redirect(errorRedirectPath(BASE, "담보를 찾을 수 없습니다."));
  const order = moved(tree.subCoverages, subCoverageId, dir);
  const r = await services.coverage.reorderSubCoverages(actor, coverageId, order);
  if (!r.ok) redirect(errorRedirectPath(detailPath(coverageId), msg(r.rejection)));
  redirect(detailPath(coverageId));
}

export async function moveBenefitAction(coverageId: Id, subCoverageId: Id, benefitId: Id, dir: -1 | 1): Promise<void> {
  const actor = await currentActor();
  const services = getServices();
  const tree = await services.coverage.get(coverageId);
  const sub = tree?.subCoverages.find((s) => s.id === subCoverageId);
  if (!sub) redirect(errorRedirectPath(BASE, "세부보장을 찾을 수 없습니다."));
  const order = moved(sub.benefits, benefitId, dir);
  const r = await services.coverage.reorderBenefits(actor, subCoverageId, order);
  if (!r.ok) redirect(errorRedirectPath(detailPath(coverageId), msg(r.rejection)));
  redirect(detailPath(coverageId));
}

export async function attachAction(coverageId: Id, owner: CoverageNodeRef, code: Code): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().coverage.attach(actor, owner, code);
  if (!r.ok) redirect(errorRedirectPath(detailPath(coverageId, `${owner.level}:${owner.id}`), msg(r.rejection)));
  redirect(detailPath(coverageId, `${owner.level}:${owner.id}`));
}

export async function writeCoverageValuesAction(owner: CoverageNodeRef, submission: Submission): Promise<ActionOutcome> {
  const actor = await currentActor();
  const services = getServices();
  for (const entry of submission.values) {
    const r =
      entry.value === undefined
        ? await services.coverage.clearValue(actor, owner, entry.path)
        : await services.coverage.writeValue(actor, owner, entry.path, entry.value);
    if (!r.ok) return { ok: false, issues: r.rejection.reason === "invalid" ? r.rejection.issues : [{ kind: "typeMismatch", message: msg(r.rejection), at: { refPath: entry.path } }] };
  }
  return { ok: true };
}

// ───────────────────────────── 파괴적 (확인 폼이 confirm:true 로 호출) ─────────────────────────────

export async function detachAction(coverageId: Id, owner: CoverageNodeRef, code: Code): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().coverage.detach(actor, owner, code, { confirm: true });
  if (!r.ok) redirect(errorRedirectPath(detailPath(coverageId, `${owner.level}:${owner.id}`), msg(r.rejection)));
  redirect(detailPath(coverageId, `${owner.level}:${owner.id}`));
}

export async function removeSubCoverageAction(coverageId: Id, subCoverageId: Id): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().coverage.removeSubCoverage(actor, subCoverageId, { confirm: true });
  if (!r.ok) redirect(errorRedirectPath(detailPath(coverageId), msg(r.rejection)));
  redirect(detailPath(coverageId));
}

export async function removeBenefitAction(coverageId: Id, benefitId: Id): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().coverage.removeBenefit(actor, benefitId, { confirm: true });
  if (!r.ok) redirect(errorRedirectPath(detailPath(coverageId), msg(r.rejection)));
  redirect(detailPath(coverageId));
}

export async function removeCoverageAction(coverageId: Id): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().coverage.remove(actor, coverageId, { confirm: true });
  if (!r.ok) redirect(errorRedirectPath(detailPath(coverageId), msg(r.rejection)));
  redirect(BASE);
}

export async function createSpecialDocumentAction(coverageId: Id, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const services = getServices();
  const doc = await services.document.createSpecial(actor, coverageId, str(formData, "title"));
  if (!doc.ok) redirect(errorRedirectPath(detailPath(coverageId), msg(doc.rejection)));
  const linked = await services.coverage.setDocument(actor, coverageId, doc.value.id);
  if (!linked.ok) redirect(errorRedirectPath(detailPath(coverageId), msg(linked.rejection)));
  redirect(`/documents/${doc.value.id}`);
}
