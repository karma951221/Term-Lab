"use server";

import { redirect } from "next/navigation";

import { describeRejection, errorRedirectPath } from "@/app/_lib/rejection";
import { currentActor, getServices } from "@/lib/services";
import type { AttachLevel, Code, FieldType } from "@/domain/types";

import { bool, fieldTypeFrom, str, valueFromInput } from "../catalog/lib";

const enumPath = (code?: Code) => code ? `/types/enums/${code}` : "/types/enums";
const formPath = (code?: Code) => code ? `/types/forms/${code}` : "/types/forms";
const message = (rejection: Parameters<typeof describeRejection>[0]) => describeRejection(rejection).message;

export async function createTypeEnumAction(formData: FormData): Promise<void> {
  const values = str(formData, "values").split(/\r?\n/).map((label) => label.trim()).filter(Boolean).map((label) => ({ label }));
  const result = await getServices().catalog.createEnum(await currentActor(), {
    label: str(formData, "label"),
    description: str(formData, "description"),
    values,
  });
  if (!result.ok) redirect(errorRedirectPath("/types/enums/new", message(result.rejection)));
  redirect(enumPath(result.value.code));
}

export async function renameTypeEnumAction(code: Code, formData: FormData): Promise<void> {
  const result = await getServices().catalog.renameEnum(await currentActor(), code, str(formData, "label"));
  if (!result.ok) redirect(errorRedirectPath(enumPath(code), message(result.rejection)));
  redirect(enumPath(code));
}

export async function addTypeEnumValueAction(code: Code, formData: FormData): Promise<void> {
  const result = await getServices().catalog.addEnumValue(await currentActor(), code, { label: str(formData, "label") });
  if (!result.ok) redirect(errorRedirectPath(enumPath(code), message(result.rejection)));
  redirect(enumPath(code));
}

export async function renameTypeEnumValueAction(code: Code, valueCode: Code, formData: FormData): Promise<void> {
  const result = await getServices().catalog.renameEnumValue(await currentActor(), code, valueCode, str(formData, "label"));
  if (!result.ok) redirect(errorRedirectPath(enumPath(code), message(result.rejection)));
  redirect(enumPath(code));
}

export async function reorderTypeEnumValueAction(code: Code, valueCode: Code, direction: "up" | "down"): Promise<void> {
  const services = getServices();
  const item = await services.catalog.getEnum(code);
  if (!item) redirect(errorRedirectPath(enumPath(code), "선택지를 찾을 수 없습니다."));
  const order = [...item.values].sort((a, b) => a.order - b.order).map((value) => value.code);
  const index = order.indexOf(valueCode);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index >= 0 && target >= 0 && target < order.length) [order[index], order[target]] = [order[target]!, order[index]!];
  const result = await services.catalog.reorderEnumValues(await currentActor(), code, order);
  if (!result.ok) redirect(errorRedirectPath(enumPath(code), message(result.rejection)));
  redirect(enumPath(code));
}

export async function removeTypeEnumValueAction(code: Code, valueCode: Code): Promise<void> {
  const result = await getServices().catalog.removeEnumValue(await currentActor(), code, valueCode, { confirm: true });
  if (!result.ok) redirect(errorRedirectPath(enumPath(code), message(result.rejection)));
  redirect(enumPath(code));
}

export async function removeTypeEnumAction(code: Code): Promise<void> {
  const result = await getServices().catalog.removeEnum(await currentActor(), code, { confirm: true });
  if (!result.ok) redirect(errorRedirectPath(enumPath(code), message(result.rejection)));
  redirect(enumPath());
}

export async function createTypeFormAction(formData: FormData): Promise<void> {
  const result = await getServices().catalog.create(await currentActor(), {
    kind: "struct",
    label: str(formData, "label"),
    level: str(formData, "level") as AttachLevel,
    alwaysExposed: bool(formData, "alwaysExposed"),
    description: str(formData, "description"),
  });
  if (!result.ok) redirect(errorRedirectPath("/types/forms/new", message(result.rejection)));
  redirect(formPath(result.value.code));
}

export async function saveTypeFormBasicAction(code: Code, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const services = getServices();
  const renamed = await services.catalog.rename(actor, code, str(formData, "label"));
  if (!renamed.ok) redirect(errorRedirectPath(formPath(code), message(renamed.rejection)));
  const described = await services.catalog.setDescription(actor, code, str(formData, "description"));
  if (!described.ok) redirect(errorRedirectPath(formPath(code), message(described.rejection)));
  const exposed = await services.catalog.setAlwaysExposed(actor, code, bool(formData, "alwaysExposed"));
  if (!exposed.ok) redirect(errorRedirectPath(formPath(code), message(exposed.rejection)));
  redirect(formPath(code));
}

export async function createInlineEnumAction(input: { label: string; values: string[] }): Promise<{ ok: true; item: { code: string; label: string; description?: string; values: { code: string; label: string; order: number }[] } } | { ok: false; message: string }> {
  const result = await getServices().catalog.createEnum(await currentActor(), {
    label: input.label.trim(),
    values: input.values.map((label) => ({ label: label.trim() })).filter((value) => value.label),
  });
  return result.ok ? { ok: true, item: result.value } : { ok: false, message: message(result.rejection) };
}

export async function addTypeFieldAction(code: Code, formData: FormData): Promise<void> {
  const type = fieldTypeFrom(str(formData, "typeKind"), str(formData, "enumCode"));
  if (!type) redirect(errorRedirectPath(formPath(code), "필드 타입을 확인하세요."));
  const result = await getServices().catalog.addField(await currentActor(), code, { label: str(formData, "label"), type });
  if (!result.ok) redirect(errorRedirectPath(formPath(code), message(result.rejection)));
  redirect(formPath(code));
}

export async function saveTypeFieldAction(code: Code, fieldCode: Code, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const services = getServices();
  const def = await services.catalog.get(code);
  if (!def || def.kind !== "struct") redirect(errorRedirectPath(formPath(code), "폼을 찾을 수 없습니다."));
  const field = def.fields.find((item) => item.code === fieldCode);
  if (!field) redirect(errorRedirectPath(formPath(code), "필드를 찾을 수 없습니다."));
  const renamed = await services.catalog.renameField(actor, code, fieldCode, str(formData, "label"));
  if (!renamed.ok) redirect(errorRedirectPath(formPath(code), message(renamed.rejection)));
  const result = await services.catalog.setFieldDefaultValue(actor, code, fieldCode, valueFromInput(field.type, str(formData, "defaultValue")));
  if (!result.ok) redirect(errorRedirectPath(formPath(code), message(result.rejection)));
  redirect(formPath(code));
}

export async function changeTypeFieldAction(code: Code, fieldCode: Code, type: FieldType): Promise<void> {
  const result = await getServices().catalog.changeFieldType(await currentActor(), code, fieldCode, type, { confirm: true });
  if (!result.ok) redirect(errorRedirectPath(formPath(code), message(result.rejection)));
  redirect(formPath(code));
}

export async function reorderTypeFieldAction(code: Code, fieldCode: Code, direction: "up" | "down"): Promise<void> {
  const services = getServices();
  const def = await services.catalog.get(code);
  if (!def || def.kind !== "struct") redirect(errorRedirectPath(formPath(code), "폼을 찾을 수 없습니다."));
  const order = [...def.fields].sort((a, b) => a.order - b.order).map((field) => field.code);
  const index = order.indexOf(fieldCode);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index >= 0 && target >= 0 && target < order.length) [order[index], order[target]] = [order[target]!, order[index]!];
  const result = await services.catalog.reorderFields(await currentActor(), code, order);
  if (!result.ok) redirect(errorRedirectPath(formPath(code), message(result.rejection)));
  redirect(formPath(code));
}

export async function removeTypeFieldAction(code: Code, fieldCode: Code): Promise<void> {
  const result = await getServices().catalog.removeField(await currentActor(), code, fieldCode, { confirm: true });
  if (!result.ok) redirect(errorRedirectPath(formPath(code), message(result.rejection)));
  redirect(formPath(code));
}
