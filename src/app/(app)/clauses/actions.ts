"use server";

import { redirect } from "next/navigation";

import { describeRejection, errorRedirectPath } from "@/app/_lib/rejection";
import type { ClauseMode } from "@/domain/clause";
import type { Code } from "@/domain/types";
import { currentActor, getServices } from "@/lib/services";

import { parseClauseBody, str } from "./lib";

const BASE = "/clauses";

function msg(r: Parameters<typeof describeRejection>[0]): string {
  return describeRejection(r).message;
}
function detailPath(code: Code): string {
  return `${BASE}/${code}`;
}

export async function createClauseAction(formData: FormData): Promise<void> {
  const actor = await currentActor();
  const mode = str(formData, "mode") as ClauseMode;
  const body = parseClauseBody(str(formData, "body"));
  if (body === undefined) redirect(errorRedirectPath(`${BASE}/new`, "본문 JSON을 확인하세요 (배열이어야 합니다)."));
  const r = await getServices().clause.create(actor, {
    label: str(formData, "label"),
    mode,
    body,
    description: str(formData, "description"),
  });
  if (!r.ok) redirect(errorRedirectPath(`${BASE}/new`, msg(r.rejection)));
  redirect(detailPath(r.value.code));
}

export async function renameAction(code: Code, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().clause.rename(actor, code, str(formData, "label"));
  if (!r.ok) redirect(errorRedirectPath(detailPath(code), msg(r.rejection)));
  redirect(detailPath(code));
}

export async function setDescriptionAction(code: Code, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().clause.setDescription(actor, code, str(formData, "description"));
  if (!r.ok) redirect(errorRedirectPath(detailPath(code), msg(r.rejection)));
  redirect(detailPath(code));
}

export async function setBodyAction(code: Code, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const body = parseClauseBody(str(formData, "body"));
  if (body === undefined) redirect(errorRedirectPath(detailPath(code), "본문 JSON을 확인하세요 (배열이어야 합니다)."));
  const r = await getServices().clause.setBody(actor, code, body);
  if (!r.ok) redirect(errorRedirectPath(detailPath(code), msg(r.rejection)));
  redirect(detailPath(code));
}

export async function setModeAction(code: Code, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const mode = str(formData, "mode") as ClauseMode;
  const body = parseClauseBody(str(formData, "body"));
  if (body === undefined) redirect(errorRedirectPath(detailPath(code), "본문 JSON을 확인하세요 (배열이어야 합니다)."));
  const r = await getServices().clause.setMode(actor, code, mode, body);
  if (!r.ok) redirect(errorRedirectPath(detailPath(code), msg(r.rejection)));
  redirect(detailPath(code));
}

export async function addOptionAction(code: Code, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const values = str(formData, "values")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((label) => ({ label }));
  const r = await getServices().clause.addOption(actor, code, { label: str(formData, "label"), values });
  if (!r.ok) redirect(errorRedirectPath(detailPath(code), msg(r.rejection)));
  redirect(detailPath(code));
}

export async function addOptionValueAction(code: Code, optionCode: Code, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().clause.addOptionValue(actor, code, optionCode, { label: str(formData, "label") });
  if (!r.ok) redirect(errorRedirectPath(detailPath(code), msg(r.rejection)));
  redirect(detailPath(code));
}

export async function renameOptionAction(code: Code, optionCode: Code, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().clause.renameOption(actor, code, optionCode, str(formData, "label"));
  if (!r.ok) redirect(errorRedirectPath(detailPath(code), msg(r.rejection)));
  redirect(detailPath(code));
}

export async function renameOptionValueAction(code: Code, optionCode: Code, valueCode: Code, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().clause.renameOptionValue(actor, code, optionCode, valueCode, str(formData, "label"));
  if (!r.ok) redirect(errorRedirectPath(detailPath(code), msg(r.rejection)));
  redirect(detailPath(code));
}

export async function removeAction(code: Code): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().clause.remove(actor, code, { confirm: true });
  if (!r.ok) redirect(errorRedirectPath(detailPath(code), msg(r.rejection)));
  redirect(BASE);
}
