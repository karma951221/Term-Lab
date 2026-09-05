/**
 * 담보속성 카탈로그 규칙 (ADR-0015 · 담보속성탑재 S1) — 순수.
 *
 * - 종류 코드 `A0001`(전역) · 유효값 코드 `V01`(종류 안) — 시스템 채번 · 불변. 순번은 저장소가 준다
 *   (`AttributeSeq` 주입 — 카탈로그와 같은 시퀀스 테이블을 kind `attribute` / `attributeValue` 로 공유).
 * - 종류·유효값 표시명은 언제든 변경. 종류 표시명은 카탈로그 전역, 유효값 표시명은 종류 안에서 유일.
 * - 적용 순서(order)는 카탈로그 전역 하나 (D-P5-4) — 작명 적용 순서 = 그룹 안 정렬 2차 키.
 * - 삭제(종류·유효값)는 파괴적 — 서비스가 `destructive()` 로 처리한다. 여기엔 없음.
 */
import { type Code, type Issue, ok, reject, type Result } from "../types";
import type { AttributeKind, AttributeValue, NamingRule, NewAttributeKind, NewAttributeValue } from "./types";

// ───────────────────────────── 코드 ─────────────────────────────

export type AttributeCodeKind = "attribute" | "attributeValue";

/** 순번의 출처 — scope 는 attributeValue 면 소속 종류 코드, attribute 면 "". */
export type AttributeSeq = (kind: AttributeCodeKind, scope: string) => Promise<number> | number;

export const ATTRIBUTE_CODE_PATTERN = /^A\d{4,}$/;
export const ATTRIBUTE_VALUE_CODE_PATTERN = /^V\d{2,}$/;

export function formatAttributeCode(seq: number): Code {
  if (!Number.isInteger(seq) || seq < 1) throw new RangeError(`코드 순번은 1 이상의 정수여야 합니다: ${seq}`);
  return "A" + String(seq).padStart(4, "0");
}

export function formatAttributeValueCode(seq: number): Code {
  if (!Number.isInteger(seq) || seq < 1) throw new RangeError(`코드 순번은 1 이상의 정수여야 합니다: ${seq}`);
  return "V" + String(seq).padStart(2, "0");
}

// ───────────────────────────── 공통 ─────────────────────────────

function invalid<T>(message: string, refPath?: string): Result<T> {
  const issue: Issue = { kind: "typeMismatch", message, at: refPath ? { refPath } : {} };
  return reject({ reason: "invalid", issues: [issue] });
}

function cleanLabel(label: unknown): string | undefined {
  if (typeof label !== "string") return undefined;
  const t = label.trim();
  return t.length > 0 ? t : undefined;
}

/** 작명 규칙 정리 — 앞뒤 공백 제거, 빈 문자열은 규칙 없음 (공백 1칸 규칙은 naming.ts 가 적용). */
export function normalizeNamingRule(rule: NamingRule | undefined): NamingRule {
  const out: NamingRule = {};
  const p = rule?.prefix?.trim();
  const s = rule?.suffix?.trim();
  if (p) out.prefix = p;
  if (s) out.suffix = s;
  return out;
}

function sortedValues(values: readonly AttributeValue[]): AttributeValue[] {
  return [...values].sort((a, b) => a.order - b.order || a.code.localeCompare(b.code));
}

// ───────────────────────────── 종류 ─────────────────────────────

export async function createAttributeKind(
  input: NewAttributeKind,
  existing: readonly AttributeKind[],
  nextSeq: AttributeSeq,
): Promise<Result<AttributeKind>> {
  const label = cleanLabel(input.label);
  if (!label) return invalid("담보속성 종류 표시명은 비울 수 없습니다");
  if (existing.some((k) => k.label === label)) return reject({ reason: "duplicate", what: `담보속성 종류 표시명 ${label}` });
  const code = formatAttributeCode(await nextSeq("attribute", ""));
  const order = existing.reduce((m, k) => Math.max(m, k.order + 1), 0);
  return ok({ code, label, order, values: [] });
}

export function renameAttributeKind(
  kind: AttributeKind,
  label: string,
  existing: readonly AttributeKind[],
): Result<AttributeKind> {
  const clean = cleanLabel(label);
  if (!clean) return invalid("담보속성 종류 표시명은 비울 수 없습니다", kind.code);
  if (existing.some((k) => k.code !== kind.code && k.label === clean)) {
    return reject({ reason: "duplicate", what: `담보속성 종류 표시명 ${clean}` });
  }
  return ok({ ...kind, label: clean });
}

/** 카탈로그 전역 적용 순서 재배열 — 전체 코드를 정확히 한 번씩. */
export function reorderAttributeKinds(kinds: readonly AttributeKind[], order: readonly Code[]): Result<AttributeKind[]> {
  const codes = new Set(kinds.map((k) => k.code));
  if (order.length !== codes.size || new Set(order).size !== order.length || order.some((c) => !codes.has(c))) {
    return invalid("적용 순서는 카탈로그의 모든 종류 코드를 한 번씩 담아야 합니다");
  }
  const byCode = new Map(kinds.map((k) => [k.code, k]));
  return ok(order.map((c, i) => ({ ...byCode.get(c)!, order: i })));
}

// ───────────────────────────── 유효값 ─────────────────────────────

export async function addAttributeValue(
  kind: AttributeKind,
  input: NewAttributeValue,
  nextSeq: AttributeSeq,
): Promise<Result<AttributeKind>> {
  const label = cleanLabel(input.label);
  if (!label) return invalid("담보속성 유효값 표시명은 비울 수 없습니다", kind.code);
  if (kind.values.some((v) => v.label === label)) return reject({ reason: "duplicate", what: `담보속성 유효값 표시명 ${label}` });
  const code = formatAttributeValueCode(await nextSeq("attributeValue", kind.code));
  const order = kind.values.reduce((m, v) => Math.max(m, v.order + 1), 0);
  const value: AttributeValue = { code, label, order, naming: normalizeNamingRule(input.naming) };
  return ok({ ...kind, values: [...kind.values, value] });
}

function withValue(kind: AttributeKind, valueCode: Code, fn: (v: AttributeValue) => Result<AttributeValue>): Result<AttributeKind> {
  const target = kind.values.find((v) => v.code === valueCode);
  if (!target) return reject({ reason: "notFound", what: `담보속성 유효값 ${valueCode}` });
  const r = fn(target);
  if (!r.ok) return r as Result<AttributeKind>;
  return ok({ ...kind, values: kind.values.map((v) => (v.code === valueCode ? r.value : v)) });
}

export function renameAttributeValue(kind: AttributeKind, valueCode: Code, label: string): Result<AttributeKind> {
  const clean = cleanLabel(label);
  if (!clean) return invalid("담보속성 유효값 표시명은 비울 수 없습니다", `${kind.code}.${valueCode}`);
  if (kind.values.some((v) => v.code !== valueCode && v.label === clean)) {
    return reject({ reason: "duplicate", what: `담보속성 유효값 표시명 ${clean}` });
  }
  return withValue(kind, valueCode, (v) => ok({ ...v, label: clean }));
}

/** 담보명 규칙 등록·수정 — prefix · suffix 둘 다 선택. */
export function setNamingRule(kind: AttributeKind, valueCode: Code, rule: NamingRule): Result<AttributeKind> {
  return withValue(kind, valueCode, (v) => ok({ ...v, naming: normalizeNamingRule(rule) }));
}

export function reorderAttributeValues(kind: AttributeKind, order: readonly Code[]): Result<AttributeKind> {
  const codes = new Set(kind.values.map((v) => v.code));
  if (order.length !== codes.size || new Set(order).size !== order.length || order.some((c) => !codes.has(c))) {
    return invalid("유효값 순서는 종류의 모든 유효값 코드를 한 번씩 담아야 합니다", kind.code);
  }
  const byCode = new Map(kind.values.map((v) => [v.code, v]));
  return ok({ ...kind, values: order.map((c, i) => ({ ...byCode.get(c)!, order: i })) });
}

/** 유효값 삭제 (정의 변경만 — 파괴적 흐름은 서비스). */
export function removeAttributeValue(kind: AttributeKind, valueCode: Code): Result<AttributeKind> {
  if (!kind.values.some((v) => v.code === valueCode)) return reject({ reason: "notFound", what: `담보속성 유효값 ${valueCode}` });
  return ok({ ...kind, values: sortedValues(kind.values.filter((v) => v.code !== valueCode)).map((v, i) => ({ ...v, order: i })) });
}

/** 종류 안에서 유효값 찾기. */
export function findAttributeValue(kinds: readonly AttributeKind[], kindCode: Code, valueCode: Code): AttributeValue | undefined {
  return kinds.find((k) => k.code === kindCode)?.values.find((v) => v.code === valueCode);
}
