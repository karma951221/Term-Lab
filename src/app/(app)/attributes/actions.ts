"use server";

import { redirect } from "next/navigation";

import { str } from "@/app/_lib/formData";
import { describeRejection, errorRedirectPath } from "@/app/_lib/rejection";
import type { Code } from "@/domain/types";
import { currentActor, getServices } from "@/lib/services";

const BASE = "/attributes";

function msg(r: Parameters<typeof describeRejection>[0]): string {
  return describeRejection(r).message;
}

export async function createAttributeKindAction(formData: FormData): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().product.createAttributeKind(actor, { label: str(formData, "label") });
  if (!r.ok) redirect(errorRedirectPath(BASE, msg(r.rejection)));
  redirect(BASE);
}

export async function renameAttributeKindAction(code: Code, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().product.renameAttributeKind(actor, code, str(formData, "label"));
  if (!r.ok) redirect(errorRedirectPath(BASE, msg(r.rejection)));
  redirect(BASE);
}

export async function addAttributeValueAction(code: Code, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().product.addAttributeValue(actor, code, {
    label: str(formData, "label"),
    fragment: str(formData, "fragment"),
  });
  if (!r.ok) redirect(errorRedirectPath(BASE, msg(r.rejection)));
  redirect(BASE);
}

export async function renameAttributeValueAction(code: Code, valueCode: Code, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().product.renameAttributeValue(actor, code, valueCode, str(formData, "label"));
  if (!r.ok) redirect(errorRedirectPath(BASE, msg(r.rejection)));
  redirect(BASE);
}

export async function setNamingFragmentAction(code: Code, valueCode: Code, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().product.setNamingFragment(actor, code, valueCode, str(formData, "fragment"));
  if (!r.ok) redirect(errorRedirectPath(BASE, msg(r.rejection)));
  redirect(BASE);
}

export async function setNamingTemplateAction(formData: FormData): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().product.setNamingTemplate(actor, str(formData, "template"));
  if (!r.ok) redirect(errorRedirectPath(BASE, msg(r.rejection)));
  redirect(BASE);
}

export async function removeAttributeValueAction(code: Code, valueCode: Code): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().product.removeAttributeValue(actor, code, valueCode, { confirm: true });
  if (!r.ok) redirect(errorRedirectPath(BASE, msg(r.rejection)));
  redirect(BASE);
}

export async function removeAttributeKindAction(code: Code): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().product.removeAttributeKind(actor, code, { confirm: true });
  if (!r.ok) redirect(errorRedirectPath(BASE, msg(r.rejection)));
  redirect(BASE);
}
