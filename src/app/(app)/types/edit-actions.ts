"use server";

import { describeRejection } from "@/app/_lib/rejection";
import type { EditOutcome } from "@/app/_lib/edit";
import type { Result } from "@/domain/types";
import { currentActor, getServices } from "@/lib/services";

import type { EnumEditData, FormEditData } from "./edit-types";

function failed<T>(result: Result<T>, token: string): EditOutcome | undefined {
  if (result.ok) return undefined;
  if (result.rejection.reason === "needsConfirmation") return { ok: "confirm", impact: result.rejection.impact, token };
  return { ok: false, message: describeRejection(result.rejection).message };
}

export async function saveEnumEditAction(code: string, input: EnumEditData): Promise<EditOutcome> {
  const actor = await currentActor();
  const services = getServices();
  const current = await services.catalog.getEnum(code);
  if (!current) return { ok: false, message: "선택지를 찾을 수 없습니다." };
  let error = failed(await services.catalog.renameEnum(actor, code, input.label), "label");
  if (error) return error;
  const existing = new Set(current.values.map((value) => value.code));
  for (const value of input.values.filter((item) => existing.has(item.code))) {
    const result = await services.catalog.renameEnumValue(actor, code, value.code, value.label);
    error = failed(result, value.code);
    if (error) return error;
  }
  const codes = input.values.filter((item) => existing.has(item.code)).map((item) => item.code);
  for (const value of input.values.filter((item) => !existing.has(item.code))) {
    const result = await services.catalog.addEnumValue(actor, code, { label: value.label });
    error = failed(result, value.code);
    if (error) return error;
    if (result.ok) codes.push(result.value.values.at(-1)!.code);
  }
  error = failed(await services.catalog.reorderEnumValues(actor, code, codes), "order");
  return error ?? { ok: true };
}

export async function removeEnumEditAction(code: string, confirm = false): Promise<EditOutcome> {
  return failed(await getServices().catalog.removeEnum(await currentActor(), code, { confirm }), "delete") ?? { ok: true };
}

export async function removeEnumValueEditAction(code: string, valueCode: string, confirm = false): Promise<EditOutcome> {
  return failed(await getServices().catalog.removeEnumValue(await currentActor(), code, valueCode, { confirm }), valueCode) ?? { ok: true };
}

export async function saveFormEditAction(code: string, input: FormEditData, confirm = false): Promise<EditOutcome> {
  const actor = await currentActor();
  const services = getServices();
  let current = await services.catalog.get(code);
  if (!current || current.kind !== "struct") return { ok: false, message: "폼을 찾을 수 없습니다." };
  const existing = new Map(current.fields.map((field) => [field.code, field]));
  const changedTypes = input.fields.filter((field) => existing.has(field.code) && JSON.stringify(existing.get(field.code)!.type) !== JSON.stringify(field.type));
  if (!confirm) {
    for (const field of changedTypes) {
      const preview = await services.catalog.changeFieldType(actor, code, field.code, field.type);
      const error = failed(preview, field.code);
      if (error) return error;
    }
  } else {
    for (const field of changedTypes) {
      const result = await services.catalog.changeFieldType(actor, code, field.code, field.type, { confirm: true });
      const error = failed(result, field.code);
      if (error) return error;
    }
    current = await services.catalog.get(code);
    if (!current || current.kind !== "struct") return { ok: false, message: "폼을 찾을 수 없습니다." };
  }

  let error = failed(await services.catalog.rename(actor, code, input.label), "label");
  if (error) return error;
  error = failed(await services.catalog.setDescription(actor, code, input.description), "description");
  if (error) return error;
  error = failed(await services.catalog.setAlwaysExposed(actor, code, input.alwaysExposed), "exposure");
  if (error) return error;

  const order: string[] = [];
  for (const field of input.fields) {
    if (existing.has(field.code)) {
      error = failed(await services.catalog.renameField(actor, code, field.code, field.label), field.code);
      if (error) return error;
      error = failed(await services.catalog.setFieldDefaultValue(actor, code, field.code, field.defaultValue), field.code);
      if (error) return error;
      order.push(field.code);
    } else {
      const added = await services.catalog.addField(actor, code, { label: field.label, type: field.type, defaultValue: field.defaultValue });
      error = failed(added, field.code);
      if (error) return error;
      if (added.ok) order.push(added.value.fields.at(-1)!.code);
    }
  }
  error = failed(await services.catalog.reorderFields(actor, code, order), "order");
  return error ?? { ok: true };
}

export async function removeFormEditAction(code: string, confirm = false): Promise<EditOutcome> {
  return failed(await getServices().catalog.remove(await currentActor(), code, { confirm }), "delete") ?? { ok: true };
}

export async function removeFormFieldEditAction(code: string, fieldCode: string, confirm = false): Promise<EditOutcome> {
  return failed(await getServices().catalog.removeField(await currentActor(), code, fieldCode, { confirm }), fieldCode) ?? { ok: true };
}
