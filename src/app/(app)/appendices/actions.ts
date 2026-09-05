"use server";

import { redirect } from "next/navigation";

import { str } from "@/app/_lib/formData";
import { describeRejection, errorRedirectPath } from "@/app/_lib/rejection";
import type { Code } from "@/domain/types";
import { currentActor, getServices } from "@/lib/services";

const BASE = "/appendices";

function msg(r: Parameters<typeof describeRejection>[0]): string {
  return describeRejection(r).message;
}

export async function createAppendixAction(formData: FormData): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().document.createAppendix(actor, {
    code: str(formData, "code"),
    name: str(formData, "name"),
    description: str(formData, "description"),
  });
  if (!r.ok) redirect(errorRedirectPath(BASE, msg(r.rejection)));
  redirect(BASE);
}

export async function renameAppendixAction(code: Code, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().document.renameAppendix(actor, code, str(formData, "name"));
  if (!r.ok) redirect(errorRedirectPath(BASE, msg(r.rejection)));
  redirect(BASE);
}

export async function setAppendixDescriptionAction(code: Code, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().document.setAppendixDescription(actor, code, str(formData, "description"));
  if (!r.ok) redirect(errorRedirectPath(BASE, msg(r.rejection)));
  redirect(BASE);
}

export async function removeAppendixAction(code: Code): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().document.removeAppendix(actor, code, { confirm: true });
  if (!r.ok) redirect(errorRedirectPath(BASE, msg(r.rejection)));
  redirect(BASE);
}
