import type { FieldType, Value } from "@/domain/types";

export interface CatalogEditData extends Record<string, unknown> {
  label: string;
  description: string;
  alwaysExposed?: boolean;
  typeKind?: FieldType["kind"];
  enumCode?: string;
  defaultValue?: Value;
  value?: string;
  expression?: string;
}
