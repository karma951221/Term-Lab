import type { Impact } from "@/domain/types";

export type EditOutcome =
  | { ok: true }
  | { ok: false; message: string }
  | { ok: "confirm"; impact: Impact; token: string };

function normalized(value: unknown): unknown {
  if (value === undefined || value === "") return null;
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalized(item)]));
  }
  return value;
}

export function isDirty(initial: unknown, current: unknown): boolean {
  return JSON.stringify(normalized(initial)) !== JSON.stringify(normalized(current));
}
