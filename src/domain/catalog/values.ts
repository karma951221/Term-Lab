/**
 * 값 규칙 — ValueSlot 검증 · 값 자리 목록 · 기본값 프리필 · 미입력 계산 (ADR-0004).
 *
 * - 값 자리(SlotPath)는 scalar 면 `D0001`, 구조체 필드면 `D0002.F01`. 식의 참조 경로와 같다.
 * - 기본값은 `prefill()` 로 폼 초기값을 돌려줄 뿐 저장소에 들어가지 않는다.
 * - 미입력은 값이 아니라 상태 — 저장소가 자리를 모르거나(undefined) `entered:false` 면 미입력.
 */
import type { Coordinate, FieldType, Issue, Value, ValueSlot } from "../types";
import type { Discriminator, EnumLookup, SlotPath } from "./types";

// ───────────────────────────── 값 검증 ─────────────────────────────

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isRealDate(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function mismatch(message: string, at: Coordinate): Issue {
  return { kind: "typeMismatch", message, at };
}

function broken(message: string, at: Coordinate): Issue {
  return { kind: "brokenRef", message, at };
}

/**
 * 타입에 맞는 값인가. 빈 배열이면 유효.
 * - enum 값은 표시명이 아니라 **값 코드**(`V01`)여야 한다.
 * - 없는 enum · 없는 값 코드는 `brokenRef`, 모양이 틀리면 `typeMismatch`.
 */
export function validateValue(
  type: FieldType,
  value: unknown,
  enums: EnumLookup,
  at: Coordinate = {},
): Issue[] {
  switch (type.kind) {
    case "string":
      return typeof value === "string" ? [] : [mismatch("문자열이어야 합니다", at)];
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? []
        : [mismatch("숫자여야 합니다", at)];
    case "boolean":
      return typeof value === "boolean" ? [] : [mismatch("참/거짓이어야 합니다", at)];
    case "date":
      return typeof value === "string" && isRealDate(value)
        ? []
        : [mismatch("YYYY-MM-DD 형식의 실제 날짜여야 합니다", at)];
    case "enum": {
      const def = enums(type.enumCode);
      if (!def) return [broken(`enum ${type.enumCode} 이(가) 없습니다`, at)];
      if (typeof value !== "string") return [mismatch("enum 값 코드여야 합니다", at)];
      return def.values.some((v) => v.code === value)
        ? []
        : [broken(`enum ${def.label}(${def.code}) 에 값 코드 ${value} 이(가) 없습니다`, at)];
    }
    case "list<enum>": {
      const def = enums(type.enumCode);
      if (!def) return [broken(`enum ${type.enumCode} 이(가) 없습니다`, at)];
      if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
        return [mismatch("enum 값 코드 배열이어야 합니다", at)];
      }
      if (new Set(value).size !== value.length) {
        return [mismatch("같은 enum 값을 두 번 고를 수 없습니다", at)];
      }
      const codes = new Set(def.values.map((v) => v.code));
      const unknown = value.filter((v) => !codes.has(v));
      return unknown.length === 0
        ? []
        : [broken(`enum ${def.label}(${def.code}) 에 값 코드 ${unknown.join(", ")} 이(가) 없습니다`, at)];
    }
  }
}

// ───────────────────────────── 값 자리 ─────────────────────────────

export function slotPath(discriminatorCode: string, fieldCode?: string): SlotPath {
  return fieldCode ? `${discriminatorCode}.${fieldCode}` : discriminatorCode;
}

/** 정의가 만드는 값 자리 목록. const·derived 는 없다. */
export function valueSlotsOf(def: Discriminator): SlotPath[] {
  switch (def.kind) {
    case "scalar":
      return [slotPath(def.code)];
    case "struct":
      return def.fields.map((f) => slotPath(def.code, f.code));
    case "const":
    case "derived":
      return [];
  }
}

/** 경로가 가리키는 자리의 타입. 이 정의의 자리가 아니면 undefined. */
export function slotType(def: Discriminator, path: SlotPath): FieldType | undefined {
  if (def.kind === "scalar") return path === def.code ? def.type : undefined;
  if (def.kind !== "struct") return undefined;
  const [code, fieldCode] = path.split(".");
  if (code !== def.code || !fieldCode) return undefined;
  return def.fields.find((f) => f.code === fieldCode)?.type;
}

// ───────────────────────────── 프리필 · 미입력 ─────────────────────────────

/**
 * 폼 초기값 — 기본값이 있는 자리만. 사람이 보고 저장해야 명시 값이 된다.
 * 여기서 돌려준 값은 어떤 경로로도 저장소에 자동 유입되지 않는다.
 */
export function prefill(def: Discriminator): Record<SlotPath, Value> {
  const out: Record<SlotPath, Value> = {};
  if (def.kind === "scalar" && def.defaultValue !== undefined) {
    out[slotPath(def.code)] = def.defaultValue;
  } else if (def.kind === "struct") {
    for (const f of def.fields) {
      if (f.defaultValue !== undefined) out[slotPath(def.code, f.code)] = f.defaultValue;
    }
  }
  return out;
}

/** 저장소 조회 — 자리를 모르면 undefined (= 미입력). */
export type SlotReader = (path: SlotPath) => ValueSlot | undefined;

/** 미입력 자리 목록. 기본값 지정 여부와 무관하다. */
export function missingSlots(def: Discriminator, read: SlotReader): SlotPath[] {
  return valueSlotsOf(def).filter((p) => {
    const slot = read(p);
    return slot === undefined || !slot.entered;
  });
}
