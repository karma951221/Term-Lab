"use server";

import { redirect } from "next/navigation";

import { describeRejection, errorRedirectPath } from "@/app/_lib/rejection";
import type { AttachLevel, Code, FieldType } from "@/domain/types";
import { currentActor, getServices } from "@/lib/services";
import { checkDerivedExpression } from "@/services/container";

import { bool, fieldTypeFrom, str, valueFromInput } from "./lib";

const BASE = "/catalog";

function detailPath(code: Code): string {
  return `${BASE}/${code}`;
}
function msg(r: Parameters<typeof describeRejection>[0]): string {
  return describeRejection(r).message;
}

// ───────────────────────────── 생성 ─────────────────────────────

export async function createScalarAction(formData: FormData): Promise<void> {
  const actor = await currentActor();
  const level = str(formData, "level") as AttachLevel;
  const type = fieldTypeFrom(str(formData, "typeKind"), str(formData, "enumCode"));
  if (!type) redirect(errorRedirectPath(`${BASE}/new`, "타입을 확인하세요 (enum 은 대상 enum 을 골라야 합니다)."));
  const defaultValue = valueFromInput(type, str(formData, "defaultValue"));
  const r = await getServices().catalog.create(actor, {
    kind: "scalar",
    label: str(formData, "label"),
    level,
    type,
    alwaysExposed: bool(formData, "alwaysExposed"),
    description: str(formData, "description"),
    ...(defaultValue !== undefined ? { defaultValue } : {}),
  });
  if (!r.ok) redirect(errorRedirectPath(`${BASE}/new`, msg(r.rejection)));
  redirect(detailPath(r.value.code));
}

export async function createStructAction(formData: FormData): Promise<void> {
  const actor = await currentActor();
  const level = str(formData, "level") as AttachLevel;
  const r = await getServices().catalog.create(actor, {
    kind: "struct",
    label: str(formData, "label"),
    level,
    alwaysExposed: bool(formData, "alwaysExposed"),
    description: str(formData, "description"),
  });
  if (!r.ok) redirect(errorRedirectPath(`${BASE}/new`, msg(r.rejection)));
  redirect(detailPath(r.value.code));
}

export async function createConstAction(formData: FormData): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().catalog.create(actor, {
    kind: "const",
    label: str(formData, "label"),
    value: str(formData, "value"),
    description: str(formData, "description"),
  });
  if (!r.ok) redirect(errorRedirectPath(`${BASE}/new`, msg(r.rejection)));
  redirect(detailPath(r.value.code));
}

export async function createDerivedAction(formData: FormData): Promise<void> {
  const actor = await currentActor();
  const expression = str(formData, "expression");
  const level = str(formData, "level") as AttachLevel;
  const services = getServices();
  const checked = await checkDerivedExpression(services.db, expression);
  if (!checked.ok) redirect(errorRedirectPath(`${BASE}/new`, msg(checked.rejection)));
  const r = await services.catalog.create(actor, {
    kind: "derived",
    label: str(formData, "label"),
    level,
    expression,
    description: str(formData, "description"),
  });
  if (!r.ok) redirect(errorRedirectPath(`${BASE}/new`, msg(r.rejection)));
  redirect(detailPath(r.value.code));
}

export async function createEnumAction(formData: FormData): Promise<void> {
  const actor = await currentActor();
  const values = str(formData, "values")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((label) => ({ label }));
  const r = await getServices().catalog.createEnum(actor, { label: str(formData, "label"), values });
  if (!r.ok) redirect(errorRedirectPath(`${BASE}/enums`, msg(r.rejection)));
  redirect(`${BASE}/enums`);
}

// ───────────────────────────── 상세 · 비파괴 편집 ─────────────────────────────

export async function renameAction(code: Code, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().catalog.rename(actor, code, str(formData, "label"));
  if (!r.ok) redirect(errorRedirectPath(detailPath(code), msg(r.rejection)));
  redirect(detailPath(code));
}

export async function setDescriptionAction(code: Code, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().catalog.setDescription(actor, code, str(formData, "description"));
  if (!r.ok) redirect(errorRedirectPath(detailPath(code), msg(r.rejection)));
  redirect(detailPath(code));
}

export async function setAlwaysExposedAction(code: Code, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().catalog.setAlwaysExposed(actor, code, bool(formData, "alwaysExposed"));
  if (!r.ok) redirect(errorRedirectPath(detailPath(code), msg(r.rejection)));
  redirect(detailPath(code));
}

export async function setDefaultValueAction(code: Code, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const services = getServices();
  const def = await services.catalog.get(code);
  if (!def || def.kind !== "scalar") redirect(errorRedirectPath(detailPath(code), "scalar 구분자가 아닙니다."));
  const value = valueFromInput(def.type, str(formData, "defaultValue"));
  const r = await services.catalog.setDefaultValue(actor, code, value);
  if (!r.ok) redirect(errorRedirectPath(detailPath(code), msg(r.rejection)));
  redirect(detailPath(code));
}

export async function addFieldAction(code: Code, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const type = fieldTypeFrom(str(formData, "typeKind"), str(formData, "enumCode"));
  if (!type) redirect(errorRedirectPath(detailPath(code), "필드 타입을 확인하세요."));
  const r = await getServices().catalog.addField(actor, code, { label: str(formData, "label"), type });
  if (!r.ok) redirect(errorRedirectPath(detailPath(code), msg(r.rejection)));
  redirect(detailPath(code));
}

export async function renameFieldAction(code: Code, fieldCode: Code, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().catalog.renameField(actor, code, fieldCode, str(formData, "label"));
  if (!r.ok) redirect(errorRedirectPath(detailPath(code), msg(r.rejection)));
  redirect(detailPath(code));
}

export async function setFieldDefaultValueAction(code: Code, fieldCode: Code, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const services = getServices();
  const def = await services.catalog.get(code);
  if (!def || def.kind !== "struct") redirect(errorRedirectPath(detailPath(code), "struct 구분자가 아닙니다."));
  const field = def.fields.find((f) => f.code === fieldCode);
  if (!field) redirect(errorRedirectPath(detailPath(code), "필드를 찾을 수 없습니다."));
  const value = valueFromInput(field.type, str(formData, "defaultValue"));
  const r = await services.catalog.setFieldDefaultValue(actor, code, fieldCode, value);
  if (!r.ok) redirect(errorRedirectPath(detailPath(code), msg(r.rejection)));
  redirect(detailPath(code));
}

export async function setConstValueAction(code: Code, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().catalog.setConstValue(actor, code, str(formData, "value"));
  if (!r.ok) redirect(errorRedirectPath(detailPath(code), msg(r.rejection)));
  redirect(detailPath(code));
}

export async function setExpressionAction(code: Code, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const expression = str(formData, "expression");
  const services = getServices();
  const checked = await checkDerivedExpression(services.db, expression);
  if (!checked.ok) redirect(errorRedirectPath(detailPath(code), msg(checked.rejection)));
  const r = await services.catalog.setExpression(actor, code, expression);
  if (!r.ok) redirect(errorRedirectPath(detailPath(code), msg(r.rejection)));
  redirect(detailPath(code));
}

// ───────────────────────────── 파괴적 (2단 — 확인 폼이 confirm:true 로 호출) ─────────────────────────────

export async function removeAction(code: Code): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().catalog.remove(actor, code, { confirm: true });
  if (!r.ok) redirect(errorRedirectPath(detailPath(code), msg(r.rejection)));
  redirect(BASE);
}

/** type 은 미리 GET 폼(쿼리스트링)으로 골라 미리보기하고, 확인 폼이 `(code, type)` 로 bind 해 호출한다. */
export async function changeScalarTypeAction(code: Code, type: FieldType): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().catalog.changeScalarType(actor, code, type, { confirm: true });
  if (!r.ok) redirect(errorRedirectPath(detailPath(code), msg(r.rejection)));
  redirect(detailPath(code));
}

/** type 은 미리 GET 폼으로 골라 미리보기하고, 확인 폼이 `(code, fieldCode, type)` 로 bind 해 호출한다. */
export async function changeFieldTypeAction(code: Code, fieldCode: Code, type: FieldType): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().catalog.changeFieldType(actor, code, fieldCode, type, { confirm: true });
  if (!r.ok) redirect(errorRedirectPath(detailPath(code), msg(r.rejection)));
  redirect(detailPath(code));
}

export async function removeFieldAction(code: Code, fieldCode: Code): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().catalog.removeField(actor, code, fieldCode, { confirm: true });
  if (!r.ok) redirect(errorRedirectPath(detailPath(code), msg(r.rejection)));
  redirect(detailPath(code));
}

export async function removeEnumValueAction(enumCode: Code, valueCode: Code): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().catalog.removeEnumValue(actor, enumCode, valueCode, { confirm: true });
  if (!r.ok) redirect(errorRedirectPath(`${BASE}/enums`, msg(r.rejection)));
  redirect(`${BASE}/enums`);
}

export async function removeEnumAction(enumCode: Code): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().catalog.removeEnum(actor, enumCode, { confirm: true });
  if (!r.ok) redirect(errorRedirectPath(`${BASE}/enums`, msg(r.rejection)));
  redirect(`${BASE}/enums`);
}

export async function addEnumValueAction(enumCode: Code, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().catalog.addEnumValue(actor, enumCode, { label: str(formData, "label") });
  if (!r.ok) redirect(errorRedirectPath(`${BASE}/enums`, msg(r.rejection)));
  redirect(`${BASE}/enums`);
}

export async function renameEnumValueAction(enumCode: Code, valueCode: Code, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().catalog.renameEnumValue(actor, enumCode, valueCode, str(formData, "label"));
  if (!r.ok) redirect(errorRedirectPath(`${BASE}/enums`, msg(r.rejection)));
  redirect(`${BASE}/enums`);
}

export async function renameEnumAction(enumCode: Code, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().catalog.renameEnum(actor, enumCode, str(formData, "label"));
  if (!r.ok) redirect(errorRedirectPath(`${BASE}/enums`, msg(r.rejection)));
  redirect(`${BASE}/enums`);
}
