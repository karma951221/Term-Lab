"use server";

import { describeRejection } from "@/app/_lib/rejection";
import type { EditOutcome } from "@/app/_lib/edit";
import type { Result } from "@/domain/types";
import { currentActor, getServices } from "@/lib/services";
import { checkDerivedExpression } from "@/services/container";

import { fieldTypeFrom } from "./lib";
import type { CatalogEditData } from "./edit-types";

function failed<T>(result: Result<T>, token: string): EditOutcome | undefined {
  if (result.ok) return undefined;
  if (result.rejection.reason === "needsConfirmation") return { ok: "confirm", impact: result.rejection.impact, token };
  return { ok: false, message: describeRejection(result.rejection).message };
}

export async function saveDiscriminatorEditAction(code: string, input: CatalogEditData, confirm = false): Promise<EditOutcome> {
  const actor = await currentActor();
  const services = getServices();
  let def = await services.catalog.get(code);
  if (!def) return { ok: false, message: `찾을 수 없습니다 — 구분자 ${code}` };

  if (def.kind === "derived") {
    const checked = await checkDerivedExpression(services.db, input.expression ?? "");
    const error = failed(checked, "expression");
    if (error) return error;
  }

  if (def.kind === "scalar") {
    const nextType = fieldTypeFrom(input.typeKind ?? "", input.enumCode ?? "");
    if (!nextType) return { ok: false, message: "타입을 확인하세요. 선택형은 대상 선택지를 골라야 합니다." };
    if (JSON.stringify(nextType) !== JSON.stringify(def.type)) {
      const changed = await services.catalog.changeScalarType(actor, code, nextType, { confirm });
      const error = failed(changed, "type");
      if (error) return error;
      def = changed.ok ? changed.value : def;
    }
  }

  const rename = await services.catalog.rename(actor, code, input.label);
  let error = failed(rename, "label");
  if (error) return error;
  const description = await services.catalog.setDescription(actor, code, input.description);
  error = failed(description, "description");
  if (error) return error;
  if (def.kind === "scalar" || def.kind === "struct") {
    const exposure = await services.catalog.setAlwaysExposed(actor, code, Boolean(input.alwaysExposed));
    error = failed(exposure, "exposure");
    if (error) return error;
  }
  if (def.kind === "scalar") {
    const value = await services.catalog.setDefaultValue(actor, code, input.defaultValue);
    error = failed(value, "default");
    if (error) return error;
  } else if (def.kind === "const") {
    const value = await services.catalog.setConstValue(actor, code, input.value ?? "");
    error = failed(value, "value");
    if (error) return error;
  } else if (def.kind === "derived") {
    const expression = await services.catalog.setExpression(actor, code, input.expression ?? "");
    error = failed(expression, "expression");
    if (error) return error;
  }
  return { ok: true };
}

export async function removeDiscriminatorEditAction(code: string, confirm = false): Promise<EditOutcome> {
  const result = await getServices().catalog.remove(await currentActor(), code, { confirm });
  return failed(result, "delete") ?? { ok: true };
}
