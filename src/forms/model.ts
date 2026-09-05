/**
 * 폼 모델 — 「폼 = 구조체 = 구분자 하나」(ADR-0001) 를 화면 없이 표현한 순수층.
 *
 * - `buildForm`     : 구분자 정의 + enum 조회 + 저장소 값 → 폼 모델 (직렬화 가능한 데이터만).
 * - `formReducer`   : 편집 상태 전이 — 문자열 입력을 타입에 맞게 파싱, 오류는 필드 단위.
 * - `toSubmission`  : 저장할 값 목록. 미입력은 제출하지 않는다 — 기본값 자동 유입 없음 (ADR-0004).
 * - `zodSchemaFor`  : 서버 액션 입력 검증용 zod 스키마.
 *
 * React 를 import 하지 않는다 — 여기 있는 모든 것은 node 환경에서 그대로 테스트된다.
 */
import { z } from "zod";

import type { Discriminator, EnumLookup, SlotPath } from "@/domain/catalog/types";
import { slotPath, validateValue } from "@/domain/catalog/values";
import type { Code, FieldType, Issue, Value, ValueSlot } from "@/domain/types";

// ───────────────────────────── 폼 모델 ─────────────────────────────

export interface EnumOption {
  code: Code;
  label: string;
}

/** 필드 하나의 화면 표현. 직렬화 가능 — 서버 컴포넌트에서 클라이언트로 그대로 넘긴다. */
export interface FieldView {
  path: SlotPath;
  label: string;
  type: FieldType;
  /** enum · list<enum> 만. 표시 순서(order)대로. 없는 enum 이면 빈 목록. */
  enumOptions?: EnumOption[];
  /** 저장소 기준 — 기본값과 무관하다. */
  state: "entered" | "notEntered";
  /** state 가 entered 일 때만. */
  value?: Value;
  /** 기본값 — 프리필 제안일 뿐 저장소에 유입되지 않는다. */
  prefill?: Value;
}

export interface FormModel {
  /** 구분자 코드 (폼 = 구분자 하나). */
  code: Code;
  /** 구분자 표시명. */
  label: string;
  /** 렌더 순서대로. const·derived 는 빈 목록. */
  fields: FieldView[];
}

function enumOptionsOf(type: FieldType, enums: EnumLookup): EnumOption[] | undefined {
  if (type.kind !== "enum" && type.kind !== "list<enum>") return undefined;
  const def = enums(type.enumCode);
  if (!def) return [];
  return [...def.values]
    .sort((a, b) => a.order - b.order)
    .map((v) => ({ code: v.code, label: v.label }));
}

function fieldView(
  path: SlotPath,
  label: string,
  type: FieldType,
  defaultValue: Value | undefined,
  enums: EnumLookup,
  current: Map<SlotPath, ValueSlot>,
): FieldView {
  const slot = current.get(path);
  const view: FieldView = { path, label, type, state: "notEntered" };
  const options = enumOptionsOf(type, enums);
  if (options) view.enumOptions = options;
  if (slot?.entered) {
    view.state = "entered";
    view.value = slot.value;
  }
  if (defaultValue !== undefined) view.prefill = defaultValue;
  return view;
}

/**
 * 구분자 정의만으로 폼 모델을 만든다 — 폼별 코드 없음.
 * scalar 는 필드 1개, struct 는 order 순 필드 목록. const·derived 는 값 자리가 없다.
 */
export function buildForm(
  def: Discriminator,
  enums: EnumLookup,
  current: Map<SlotPath, ValueSlot>,
): FormModel {
  const base = { code: def.code, label: def.label };
  switch (def.kind) {
    case "scalar":
      return {
        ...base,
        fields: [fieldView(slotPath(def.code), def.label, def.type, def.defaultValue, enums, current)],
      };
    case "struct":
      return {
        ...base,
        fields: [...def.fields]
          .sort((a, b) => a.order - b.order)
          .map((f) =>
            fieldView(slotPath(def.code, f.code), f.label, f.type, f.defaultValue, enums, current),
          ),
      };
    case "const":
    case "derived":
      return { ...base, fields: [] };
  }
}

// ───────────────────────────── 표시 ─────────────────────────────

/** 읽기 전용 표시 문자열. enum 은 표시명(ADR-0005), boolean 은 예/아니오. 미입력이면 undefined. */
export function formatValue(field: FieldView): string | undefined {
  if (field.state !== "entered" || field.value === undefined) return undefined;
  const labelOf = (code: string) =>
    field.enumOptions?.find((o) => o.code === code)?.label ?? code;
  const v = field.value;
  switch (field.type.kind) {
    case "boolean":
      return v === true ? "예" : "아니오";
    case "enum":
      return labelOf(String(v));
    case "list<enum>":
      return Array.isArray(v) ? v.map(labelOf).join(", ") : String(v);
    default:
      return String(v);
  }
}

// ───────────────────────────── 편집 상태 ─────────────────────────────

/** 입력 원문. list<enum> 은 코드 배열, 나머지는 문자열. */
export type Draft = string | string[];

export interface FieldState {
  /** 폼 모델의 원본 (저장소 기준 상태·프리필·선택지). */
  view: FieldView;
  draft: Draft;
  /** 지금 편집 상태에서 값이 있는가 (파싱 성공 여부와 무관 — 오류여도 「입력 중」). */
  entered: boolean;
  /** 파싱된 값. entered 이고 오류가 없을 때만. */
  value: Value | undefined;
  /** 파싱 오류 문구 (issue.message). */
  error: string | undefined;
  /** 파싱 오류의 Issue — 종류(typeMismatch·brokenRef)와 좌표(refPath)를 보존한다. */
  issue: Issue | undefined;
  /** 사람이 손댔는가. */
  dirty: boolean;
}

export interface FormState {
  model: FormModel;
  fields: Record<SlotPath, FieldState>;
}

export type FormAction =
  | { type: "edit"; path: SlotPath; draft: Draft }
  | { type: "clear"; path: SlotPath }
  | { type: "applyPrefill"; path: SlotPath };

function emptyDraft(type: FieldType): Draft {
  return type.kind === "list<enum>" ? [] : "";
}

/** 값 → 입력 원문. */
function draftOf(type: FieldType, value: Value): Draft {
  if (type.kind === "list<enum>") return Array.isArray(value) ? [...value] : [String(value)];
  return Array.isArray(value) ? value.join(",") : String(value);
}

function isEmptyDraft(draft: Draft): boolean {
  return Array.isArray(draft) ? draft.length === 0 : draft.trim() === "";
}

/** 선택지만으로 만든 enum 조회 — validateValue 를 그대로 재사용하기 위해. */
function lookupFromView(view: FieldView): EnumLookup {
  return (code) => {
    const t = view.type;
    if ((t.kind !== "enum" && t.kind !== "list<enum>") || t.enumCode !== code) return undefined;
    return {
      code,
      label: "",
      values: (view.enumOptions ?? []).map((o, i) => ({ ...o, order: i })),
    };
  };
}

/** 입력 원문 → 값. 실패하면 Issue. 빈 입력은 호출 전에 걸러진다. */
function parseDraft(view: FieldView, draft: Draft): { value: Value } | { issue: Issue } {
  const t = view.type;
  let candidate: unknown;
  switch (t.kind) {
    case "string":
      candidate = Array.isArray(draft) ? draft.join(",") : draft;
      break;
    case "number": {
      const s = Array.isArray(draft) ? draft.join(",") : draft.trim();
      candidate = s === "" ? Number.NaN : Number(s);
      break;
    }
    case "boolean": {
      const s = Array.isArray(draft) ? "" : draft.trim();
      candidate = s === "true" ? true : s === "false" ? false : s;
      break;
    }
    case "date":
    case "enum":
      candidate = Array.isArray(draft) ? draft.join(",") : draft.trim();
      break;
    case "list<enum>":
      candidate = Array.isArray(draft) ? draft : [draft];
      break;
  }
  const issues = validateValue(t, candidate, lookupFromView(view), { refPath: view.path });
  return issues.length === 0 ? { value: candidate as Value } : { issue: issues[0] };
}

function fieldStateOf(view: FieldView, draft: Draft, dirty: boolean): FieldState {
  const base = { view, draft, dirty, value: undefined, error: undefined, issue: undefined };
  if (isEmptyDraft(draft)) return { ...base, entered: false };
  const parsed = parseDraft(view, draft);
  return "value" in parsed
    ? { ...base, entered: true, value: parsed.value }
    : { ...base, entered: true, error: parsed.issue.message, issue: parsed.issue };
}

/** 편집 상태의 초기값 — 저장 값은 draft 에 실리고, 프리필은 실리지 않는다 (미입력 유지). */
export function initFormState(model: FormModel): FormState {
  const fields: Record<SlotPath, FieldState> = {};
  for (const view of model.fields) {
    const draft =
      view.state === "entered" && view.value !== undefined
        ? draftOf(view.type, view.value)
        : emptyDraft(view.type);
    fields[view.path] = fieldStateOf(view, draft, false);
  }
  return { model, fields };
}

export function formReducer(state: FormState, action: FormAction): FormState {
  const field = state.fields[action.path];
  if (!field) return state;
  let next: FieldState;
  switch (action.type) {
    case "edit":
      next = fieldStateOf(field.view, action.draft, true);
      break;
    case "clear":
      next = fieldStateOf(field.view, emptyDraft(field.view.type), true);
      break;
    case "applyPrefill":
      if (field.view.prefill === undefined) return state;
      next = fieldStateOf(field.view, draftOf(field.view.type, field.view.prefill), true);
      break;
  }
  return { ...state, fields: { ...state.fields, [action.path]: next } };
}

// ───────────────────────────── 제출 ─────────────────────────────

/** 저장할 값 하나. value 가 undefined 면 「값 지우기」. */
export interface SubmissionEntry {
  path: SlotPath;
  value: Value | undefined;
}

export interface Submission {
  /** 폼 순서대로. 미입력 필드는 없다 — 저장돼 있던 값을 지운 경우만 undefined 로 실린다. */
  values: SubmissionEntry[];
  /** 파싱 오류·깨진 enum 참조. 하나라도 있으면 저장하면 안 된다. */
  issues: Issue[];
}

/** 편집 상태 → 저장할 값 목록 + 최종 검증 Issue. */
export function toSubmission(state: FormState): Submission {
  const values: SubmissionEntry[] = [];
  const issues: Issue[] = [];
  for (const view of state.model.fields) {
    const f = state.fields[view.path];
    if (!f) continue;
    if (!f.entered) {
      // 저장소에 있던 값을 지웠을 때만 「값 지우기」로 제출한다
      if (view.state === "entered") values.push({ path: view.path, value: undefined });
      continue;
    }
    if (f.issue !== undefined || f.value === undefined) {
      issues.push(
        f.issue ?? {
          kind: "typeMismatch",
          message: "값을 해석할 수 없습니다",
          at: { refPath: view.path },
        },
      );
      continue;
    }
    const found = validateValue(view.type, f.value, lookupFromView(view), { refPath: view.path });
    if (found.length > 0) {
      issues.push(...found);
      continue;
    }
    values.push({ path: view.path, value: f.value });
  }
  return { values, issues };
}

// ───────────────────────────── zod ─────────────────────────────

/** 타입 하나의 값 스키마. enum 값은 코드. 없는 enum 은 어떤 값도 받지 않는다. */
export function zodValueSchema(type: FieldType, enums: EnumLookup): z.ZodType<Value> {
  switch (type.kind) {
    case "string":
      return z.string();
    case "number":
      return z.number();
    case "boolean":
      return z.boolean();
    case "date":
      return z.iso.date();
    case "enum": {
      const def = enums(type.enumCode);
      if (!def || def.values.length === 0) return z.never();
      return z.enum(def.values.map((v) => v.code));
    }
    case "list<enum>": {
      const def = enums(type.enumCode);
      if (!def || def.values.length === 0) return z.array(z.never());
      return z
        .array(z.enum(def.values.map((v) => v.code)))
        .refine((arr) => new Set(arr).size === arr.length, {
          message: "같은 enum 값을 두 번 고를 수 없습니다",
        });
    }
  }
}

/**
 * 제출 목록(`SubmissionEntry[]`) 스키마 — 서버 액션이 받은 입력을 이 정의의 자리·타입으로 검증한다.
 * value 없음은 「값 지우기」로 허용. 이 정의의 자리가 아닌 경로는 거부.
 */
export function zodSchemaFor(def: Discriminator, enums: EnumLookup) {
  const entries: { path: SlotPath; type: FieldType }[] =
    def.kind === "scalar"
      ? [{ path: slotPath(def.code), type: def.type }]
      : def.kind === "struct"
        ? def.fields.map((f) => ({ path: slotPath(def.code, f.code), type: f.type }))
        : [];
  if (entries.length === 0) return z.array(z.never()).max(0);
  const options = entries.map(({ path, type }) =>
    z.object({ path: z.literal(path), value: zodValueSchema(type, enums).optional() }),
  );
  return z.array(z.discriminatedUnion("path", options as [(typeof options)[number], ...typeof options]));
}
