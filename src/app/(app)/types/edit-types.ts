import type { FieldType, Value } from "@/domain/types";

export interface EnumEditValue { code: string; label: string }
export interface EnumEditData extends Record<string, unknown> { label: string; values: EnumEditValue[] }

export interface FormEditField { code: string; label: string; type: FieldType; defaultValue?: Value }
export interface FormEditData extends Record<string, unknown> {
  label: string;
  description: string;
  alwaysExposed: boolean;
  fields: FormEditField[];
}
