"use client";

/**
 * StructForm — 폼 모델(FormModel)을 받아 6 타입을 타입별 입력 컴포넌트 매핑 하나로 그린다.
 * 폼별 코드가 없다 (인수기준 「폼 렌더러 (P1)」).
 *
 * - 상호작용 로직은 전부 `formReducer`(순수)에 있다. 여기는 이벤트 → 액션 변환과 마크업뿐.
 * - 필드마다 「미입력」 배지 · 프리필이 있고 미입력이면 「기본값 채우기」 · 값이 있으면 「지우기」.
 * - 제출은 `toSubmission` 결과를 `onSubmit` 으로 넘긴다. 파싱 오류(issues)가 있으면 넘기지 않고 화면에 남긴다.
 * - 스타일은 클래스 이름만 (`ts-form` 접두) — 디자인은 리뷰 후.
 */
import { useId, useReducer, useState, type FormEvent, type ReactNode } from "react";

import type { Issue } from "@/domain/types";

import {
  formatValue,
  formReducer,
  initFormState,
  toSubmission,
  type Draft,
  type FieldState,
  type FormModel,
  type Submission,
} from "./model";

export interface StructFormProps {
  model: FormModel;
  /** 제출 — issues 가 없을 때만 불린다. */
  onSubmit: (submission: Submission) => void | Promise<void>;
  /** 제출 버튼 문구. 기본 「저장」. */
  submitLabel?: string;
  /** 서버 액션 진행 중 등 — 제출 버튼 비활성. */
  pending?: boolean;
  /** 폼 바깥에서 온 오류(서버 거부 등)를 필드 아래·폼 아래에 함께 보여준다. */
  issues?: Issue[];
}

// ───────────────────────────── 타입별 입력 ─────────────────────────────

interface InputProps {
  id: string;
  field: FieldState;
  onEdit: (draft: Draft) => void;
}

function textDraft(field: FieldState): string {
  return Array.isArray(field.draft) ? field.draft.join(",") : field.draft;
}

function StringInput({ id, field, onEdit }: InputProps) {
  return (
    <input
      id={id}
      type="text"
      name={field.view.path}
      value={textDraft(field)}
      onChange={(e) => onEdit(e.target.value)}
    />
  );
}

function NumberInput({ id, field, onEdit }: InputProps) {
  return (
    <input
      id={id}
      type="number"
      step="any"
      name={field.view.path}
      value={textDraft(field)}
      onChange={(e) => onEdit(e.target.value)}
    />
  );
}

function DateInput({ id, field, onEdit }: InputProps) {
  return (
    <input
      id={id}
      type="date"
      name={field.view.path}
      value={textDraft(field)}
      onChange={(e) => onEdit(e.target.value)}
    />
  );
}

function BooleanInput({ id, field, onEdit }: InputProps) {
  const draft = textDraft(field);
  return (
    <span className="ts-form-radios" role="radiogroup" aria-labelledby={`${id}-label`}>
      {(["true", "false"] as const).map((v) => (
        <label key={v} className="ts-form-radio">
          <input
            type="radio"
            name={field.view.path}
            value={v}
            checked={draft === v}
            onChange={() => onEdit(v)}
          />
          {v === "true" ? "예" : "아니오"}
        </label>
      ))}
    </span>
  );
}

function EnumInput({ id, field, onEdit }: InputProps) {
  return (
    <select
      id={id}
      name={field.view.path}
      value={textDraft(field)}
      onChange={(e) => onEdit(e.target.value)}
    >
      <option value="">— 선택 —</option>
      {(field.view.enumOptions ?? []).map((o) => (
        <option key={o.code} value={o.code}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function ListEnumInput({ id, field, onEdit }: InputProps) {
  const selected = Array.isArray(field.draft) ? field.draft : [];
  const toggle = (code: string, on: boolean) => {
    // 선택지 순서를 유지한 채 켜고 끈다
    const order = (field.view.enumOptions ?? []).map((o) => o.code);
    const next = new Set(selected);
    if (on) next.add(code);
    else next.delete(code);
    onEdit(order.filter((c) => next.has(c)));
  };
  return (
    <span className="ts-form-checks" role="group" aria-labelledby={`${id}-label`}>
      {(field.view.enumOptions ?? []).map((o) => (
        <label key={o.code} className="ts-form-check">
          <input
            type="checkbox"
            name={field.view.path}
            value={o.code}
            checked={selected.includes(o.code)}
            onChange={(e) => toggle(o.code, e.target.checked)}
          />
          {o.label}
        </label>
      ))}
    </span>
  );
}

/** 타입 → 입력 컴포넌트. 이 표 하나로 모든 폼이 그려진다. */
const INPUT_BY_KIND: Record<FieldState["view"]["type"]["kind"], (p: InputProps) => ReactNode> = {
  string: StringInput,
  number: NumberInput,
  boolean: BooleanInput,
  date: DateInput,
  enum: EnumInput,
  "list<enum>": ListEnumInput,
};

// ───────────────────────────── 필드 행 ─────────────────────────────

interface FieldRowProps {
  idBase: string;
  field: FieldState;
  externalIssues: Issue[];
  onEdit: (draft: Draft) => void;
  onClear: () => void;
  onApplyPrefill: () => void;
}

function FieldRow({ idBase, field, externalIssues, onEdit, onClear, onApplyPrefill }: FieldRowProps) {
  const { view } = field;
  const id = `${idBase}-${view.path.replace(".", "-")}`;
  const Input = INPUT_BY_KIND[view.type.kind];
  const prefillText =
    view.prefill === undefined
      ? undefined
      : formatValue({ ...view, state: "entered", value: view.prefill });
  const showPrefill = view.prefill !== undefined && !field.entered;
  return (
    <div className={`ts-form-row${field.entered ? "" : " is-not-entered"}`} data-path={view.path}>
      <label id={`${id}-label`} htmlFor={id} className="ts-form-label">
        {view.label}
      </label>
      <div className="ts-form-control">
        <Input id={id} field={field} onEdit={onEdit} />
        {!field.entered && <span className="ts-form-badge">미입력</span>}
        {showPrefill && (
          <button
            type="button"
            className="ts-form-prefill"
            onClick={onApplyPrefill}
            title={`기본값 ${prefillText} 채우기`}
          >
            기본값 채우기 ({prefillText})
          </button>
        )}
        {field.entered && (
          <button type="button" className="ts-form-clear" onClick={onClear} title={`${view.label} 지우기`}>
            지우기
          </button>
        )}
        {field.error !== undefined && (
          <span className="ts-form-error" role="alert">
            {field.error}
          </span>
        )}
        {externalIssues.map((issue, i) => (
          <span key={i} className="ts-form-error" role="alert">
            {issue.message}
          </span>
        ))}
      </div>
    </div>
  );
}

// ───────────────────────────── 폼 ─────────────────────────────

export function StructForm({ model, onSubmit, submitLabel = "저장", pending, issues = [] }: StructFormProps) {
  const [state, dispatch] = useReducer(formReducer, model, initFormState);
  const [submitIssues, setSubmitIssues] = useState<Issue[]>([]);
  const idBase = useId();

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const submission = toSubmission(state);
    if (submission.issues.length > 0) {
      setSubmitIssues(submission.issues);
      return;
    }
    setSubmitIssues([]);
    void onSubmit(submission);
  };

  const allIssues = [...submitIssues, ...issues];
  const issuesAt = (path: string) => allIssues.filter((i) => i.at.refPath === path);
  const unplaced = allIssues.filter((i) => !i.at.refPath || !state.fields[i.at.refPath]);

  return (
    <form className="ts-form" data-discriminator={model.code} onSubmit={handleSubmit}>
      <h2 className="ts-form-title">{model.label}</h2>
      {model.fields.length === 0 && <p className="ts-form-empty">입력할 값 자리가 없습니다.</p>}
      {model.fields.map((view) => {
        const field = state.fields[view.path];
        return (
          <FieldRow
            key={view.path}
            idBase={idBase}
            field={field}
            externalIssues={issuesAt(view.path)}
            onEdit={(draft) => dispatch({ type: "edit", path: view.path, draft })}
            onClear={() => dispatch({ type: "clear", path: view.path })}
            onApplyPrefill={() => dispatch({ type: "applyPrefill", path: view.path })}
          />
        );
      })}
      {unplaced.length > 0 && (
        <ul className="ts-form-issues" role="alert">
          {unplaced.map((issue, i) => (
            <li key={i}>{issue.message}</li>
          ))}
        </ul>
      )}
      <div className="ts-form-actions">
        <button type="submit" disabled={pending}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
