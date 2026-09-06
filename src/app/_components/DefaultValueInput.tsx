"use client";

import type { EnumDef } from "@/domain/catalog";
import type { FieldType, Value } from "@/domain/types";

export function DefaultValueInput({ type, value, onChange, enums, disabled }: { type: FieldType; value: Value | undefined; onChange: (value: Value | undefined) => void; enums: readonly EnumDef[]; disabled?: boolean }) {
  const item = "enumCode" in type ? enums.find((entry) => entry.code === type.enumCode) : undefined;
  switch (type.kind) {
    case "string": return <input type="text" value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value || undefined)} disabled={disabled} className="ts-field-direct" />;
    case "number": return <input type="number" value={typeof value === "number" ? value : ""} onChange={(event) => onChange(event.target.value === "" ? undefined : Number(event.target.value))} disabled={disabled} className="ts-field-direct col-num" />;
    case "boolean": return <select value={value === undefined ? "" : value ? "true" : "false"} onChange={(event) => onChange(event.target.value === "" ? undefined : event.target.value === "true")} disabled={disabled} className="ts-field-direct"><option value="">없음</option><option value="true">예</option><option value="false">아니오</option></select>;
    case "date": return <input type="date" value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value || undefined)} disabled={disabled} className="ts-field-direct" />;
    case "enum": return <select value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value || undefined)} disabled={disabled} className="ts-field-direct"><option value="">없음</option>{item?.values.map((entry) => <option key={entry.code} value={entry.code}>{entry.label}</option>)}</select>;
    case "list<enum>": return <select multiple value={Array.isArray(value) ? value : []} onChange={(event) => onChange(Array.from(event.target.selectedOptions, (option) => option.value))} disabled={disabled} className="ts-field-direct">{item?.values.map((entry) => <option key={entry.code} value={entry.code}>{entry.label}</option>)}</select>;
  }
}
