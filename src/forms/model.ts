/**
 * 폼 모델 — 「폼 = 구조체 = 구분자 하나」(ADR-0001) 를 화면 없이 표현한 순수층.
 *
 * - `buildForm`     : 구분자 정의 + enum 조회 + 저장소 값 (+ 스냅샷 문맥) → 폼 모델 (직렬화 가능한 데이터만).
 * - `formReducer`   : 편집 상태 전이 — 문자열 입력을 타입에 맞게 파싱, 오류는 필드 단위.
 * - `toSubmission`  : 저장할 값 목록. 빈 자리는 제출하지 않고, 읽기 전용 출처(const·derived)는 아예 빠진다.
 * - `formProgress`  : 「값 자리 N 중 M 입력」 — 저장소 기준 카운트 (디자인원칙 §9.2 · §9.6).
 * - `zodSchemaFor`  : 서버 액션 입력 검증용 zod 스키마.
 *
 * 기본값(prefill)은 폼이 열릴 때 **입력칸에 이미 들어가 있다** (ADR-0004 「폼을 미리 채워 보여주는
 * 제안」 · 리뷰 #3). 저장소로 자동 유입되는 경로는 여전히 없다 — 사람이 그 값을 보고 「저장」을
 * 눌러야 명시 값이 된다. 저장 전까지 그 자리는 「미입력 + 제안값」 두 배지를 단다.
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

/**
 * 값이 어디서 왔는가 — 디자인원칙 §1.2 출처 문법. 색이 아니라 **형태**가 말한다.
 *
 * - `direct`   : 사람이 여기서 정하는 값 → 실선 테두리 입력 필드
 * - `derived`  : 식으로 계산 → 테두리 없음 + 옅은 바탕 + ƒ 표식 + 식 노출 (고칠 수 없다)
 * - `const`    : 마스터 소유 → 테두리 없음 + 옅은 바탕 + 자물쇠 + 마스터 라벨
 * - `snapshot` : 탑재 스냅샷을 손댔다 → 입력 필드 오른쪽 끝에 되돌리기 버튼. 마스터 값은 tooltip 으로만
 */
export type FieldSource = "direct" | "derived" | "const" | "snapshot";

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
  /** 기본값 — 프리필 제안. 폼이 열릴 때 입력칸에 들어가지만 저장 전까지는 미입력이다. */
  prefill?: Value;
  /** 출처 (§1.2). 구분자 종류와 스냅샷 문맥에서 유도된다. */
  source: FieldSource;
  /** derived 만 — 식 원문. mono 로 그대로 노출한다. */
  expression?: string;
  /** const · snapshot 만 — 마스터가 갖고 있는 값. */
  masterValue?: Value;
  /** const · snapshot 만 — 마스터의 이름 「표시명 (코드)」 (ADR-0005 · §9.4). */
  masterLabel?: string;
}

/**
 * 탑재 스냅샷 문맥 — 「이 값 자리의 마스터는 무엇이고 무슨 값을 갖고 있나」.
 * 넘기면 마스터와 달라진 자리가 `source: "snapshot"` 이 되고 되돌리기 버튼이 붙는다 (ADR-0002 · §1.2).
 */
export interface SnapshotContext {
  /** 마스터 실체의 이름 — 「수술비(1~7종)[상해]」. tooltip 에 그대로 실린다. */
  masterLabel: string;
  /** 마스터가 가진 값 — 같은 경로 체계. */
  masterValues: Map<SlotPath, ValueSlot>;
}

export interface FormModel {
  /** 구분자 코드 (폼 = 구분자 하나). */
  code: Code;
  /** 구분자 표시명. */
  label: string;
  /** 렌더 순서대로. const·derived 는 「고칠 수 없는 자리」 1개 (값 자리는 아니다). */
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

/** 값 동치 — list<enum> 은 순서까지 같아야 같다. */
function valueEquals(a: Value | undefined, b: Value | undefined): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}

function fieldView(
  path: SlotPath,
  label: string,
  type: FieldType,
  defaultValue: Value | undefined,
  enums: EnumLookup,
  current: Map<SlotPath, ValueSlot>,
  snapshot?: SnapshotContext,
): FieldView {
  const slot = current.get(path);
  const view: FieldView = { path, label, type, state: "notEntered", source: "direct" };
  const options = enumOptionsOf(type, enums);
  if (options) view.enumOptions = options;
  if (slot?.entered) {
    view.state = "entered";
    view.value = slot.value;
  }
  if (defaultValue !== undefined) view.prefill = defaultValue;
  // 탑재 스냅샷을 손댄 자리만 「스냅샷 · 변경됨」 — 마스터와 같으면 평범한 직접값이다 (§1.2)
  const master = snapshot?.masterValues.get(path);
  if (snapshot && master?.entered && !valueEquals(master.value, view.value)) {
    view.source = "snapshot";
    view.masterValue = master.value;
    view.masterLabel = snapshot.masterLabel;
  }
  return view;
}

/**
 * 구분자 정의만으로 폼 모델을 만든다 — 폼별 코드 없음.
 *
 * - scalar : 값 자리 1개 · struct : order 순 값 자리 목록 (출처 `direct`, 스냅샷 문맥이 있으면 `snapshot`)
 * - const  : 마스터가 소유한 값 1개 (출처 `const` — 여기서 못 고친다)
 * - derived: 식 1개 (출처 `derived` — 값 자리가 아니다)
 *
 * const·derived 도 자리를 하나 내놓는 이유는 §1.2 의 출처 문법을 **화면에서 볼 수 있게** 하기 위해서다.
 * 값 자리로 세지 않고(`formProgress`), 제출하지도 않는다(`toSubmission`).
 */
export function buildForm(
  def: Discriminator,
  enums: EnumLookup,
  current: Map<SlotPath, ValueSlot>,
  snapshot?: SnapshotContext,
): FormModel {
  const base = { code: def.code, label: def.label };
  switch (def.kind) {
    case "scalar":
      return {
        ...base,
        fields: [
          fieldView(slotPath(def.code), def.label, def.type, def.defaultValue, enums, current, snapshot),
        ],
      };
    case "struct":
      return {
        ...base,
        fields: [...def.fields]
          .sort((a, b) => a.order - b.order)
          .map((f) =>
            fieldView(slotPath(def.code, f.code), f.label, f.type, f.defaultValue, enums, current, snapshot),
          ),
      };
    case "const":
      return {
        ...base,
        fields: [
          {
            path: slotPath(def.code),
            label: def.label,
            type: { kind: "string" },
            state: "entered",
            value: def.value,
            source: "const",
            masterValue: def.value,
            masterLabel: `${def.label} (${def.code})`,
          },
        ],
      };
    case "derived":
      return {
        ...base,
        fields: [
          {
            path: slotPath(def.code),
            label: def.label,
            type: { kind: "string" },
            state: "notEntered",
            source: "derived",
            expression: def.expression,
          },
        ],
      };
  }
}

/** 값 자리 — 사람이 채울 수 있는 자리만. const·derived 는 값 자리가 아니다. */
export function valueSlotsOf(model: FormModel): FieldView[] {
  return model.fields.filter((f) => f.source === "direct" || f.source === "snapshot");
}

/**
 * 진행 카운트 — 「값 자리 N 중 M 입력」. **저장소 기준**이다 (§9.2 「카운트는 진짜여야 한다」).
 * 화면에 프리필이 채워져 있어도 저장 전에는 세지 않는다.
 */
export function formProgress(model: FormModel): { total: number; entered: number; percent: number } {
  const slots = valueSlotsOf(model);
  const entered = slots.filter((f) => f.state === "entered").length;
  return {
    total: slots.length,
    entered,
    percent: slots.length === 0 ? 0 : Math.round((entered / slots.length) * 100),
  };
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
  /**
   * 지금 칸에 든 것이 「제안값」인가 — 기본값이 프리필된 채 아직 사람이 손대지도 저장하지도 않았다.
   * 배지 「제안값 · 저장해야 확정」의 근거 (ADR-0004).
   */
  proposed: boolean;
}

export interface FormState {
  model: FormModel;
  fields: Record<SlotPath, FieldState>;
}

export type FormAction =
  | { type: "edit"; path: SlotPath; draft: Draft }
  | { type: "clear"; path: SlotPath }
  /** 폼 전체 비우기 — 프리필 제안까지 걷어낸다 (버튼 「비우기」). */
  | { type: "clearAll" }
  /** 스냅샷을 마스터 값으로 되돌리기. 확인을 거친 뒤에만 (§1.2). */
  | { type: "revertToMaster"; path: SlotPath }
  /** 서버가 새 모델을 내려보냈다 (저장 직후) — 편집 상태를 새 진실로 다시 세운다. */
  | { type: "reset"; model: FormModel };

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

function fieldStateOf(view: FieldView, draft: Draft, dirty: boolean, proposed = false): FieldState {
  const base = { view, draft, dirty, proposed, value: undefined, error: undefined, issue: undefined };
  if (isEmptyDraft(draft)) return { ...base, entered: false, proposed: false };
  const parsed = parseDraft(view, draft);
  return "value" in parsed
    ? { ...base, entered: true, value: parsed.value }
    : { ...base, entered: true, error: parsed.issue.message, issue: parsed.issue };
}

/** 읽기 전용 출처 — 편집 상태를 갖지 않는다 (값이 여기 있지 않다). */
function isReadOnly(view: FieldView): boolean {
  return view.source === "const" || view.source === "derived";
}

/**
 * 편집 상태의 초기값 — 저장 값이 있으면 그것을, 없으면 **기본값을 제안으로 채워** 보여준다
 * (ADR-0004 「폼을 미리 채워 보여주는 제안」 · 리뷰 #3). 상태는 여전히 미입력이다.
 */
export function initFormState(model: FormModel): FormState {
  const fields: Record<SlotPath, FieldState> = {};
  for (const view of model.fields) {
    if (isReadOnly(view)) {
      fields[view.path] = fieldStateOf(view, emptyDraft(view.type), false);
      continue;
    }
    if (view.state === "entered" && view.value !== undefined) {
      fields[view.path] = fieldStateOf(view, draftOf(view.type, view.value), false);
      continue;
    }
    if (view.prefill !== undefined) {
      fields[view.path] = fieldStateOf(view, draftOf(view.type, view.prefill), false, true);
      continue;
    }
    fields[view.path] = fieldStateOf(view, emptyDraft(view.type), false);
  }
  return { model, fields };
}

export function formReducer(state: FormState, action: FormAction): FormState {
  if (action.type === "reset") return initFormState(action.model);
  if (action.type === "clearAll") {
    const fields: Record<SlotPath, FieldState> = {};
    for (const view of state.model.fields) {
      const f = state.fields[view.path];
      if (!f) continue;
      fields[view.path] = isReadOnly(view) ? f : fieldStateOf(view, emptyDraft(view.type), true);
    }
    return { ...state, fields };
  }
  const field = state.fields[action.path];
  if (!field || isReadOnly(field.view)) return state;
  let next: FieldState;
  switch (action.type) {
    case "edit":
      next = fieldStateOf(field.view, action.draft, true);
      break;
    case "clear":
      next = fieldStateOf(field.view, emptyDraft(field.view.type), true);
      break;
    case "revertToMaster":
      if (field.view.masterValue === undefined) return state;
      next = fieldStateOf(field.view, draftOf(field.view.type, field.view.masterValue), true);
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
  /** 폼 순서대로. 빈 칸은 없다 — 저장돼 있던 값을 비운 경우만 undefined 로 실린다. */
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
    if (isReadOnly(view)) continue; // 마스터·식이 소유한 자리는 여기서 저장하지 않는다
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
