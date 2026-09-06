"use client";

/**
 * StructForm — 폼 모델(FormModel)을 받아 6 타입을 타입별 입력 컴포넌트 매핑 하나로 그린다.
 * 폼별 코드가 없다 (인수기준 「폼 렌더러 (P1)」).
 *
 * 화면 규칙 —
 * - **2열 그리드**: 라벨은 좌측 120px 고정 열, 값은 우측 (디자인원칙 §2 L2). 라벨을 값 위에 두지 않는다.
 * - **출처 문법 (§1.2)**: 직접값은 실선 테두리, 파생은 ƒ + 옅은 바탕 + 식, const 는 자물쇠 + 마스터 라벨,
 *   손댄 스냅샷은 입력칸 오른쪽 끝에 되돌리기 버튼 (마스터 값은 tooltip 으로만). 색은 쓰지 않는다.
 * - **프리필은 보이는 제안 (ADR-0004 · 리뷰 #3)**: 기본값이 처음부터 칸에 들어가 있고 「미입력」 +
 *   「제안값 · 저장해야 확정」 배지가 함께 선다. 저장해야 명시 값이 된다. 폼마다 「비우기」 하나.
 * - **진행은 해낸 것을 센다 (§9.2)**: 제목 옆에 「입력 M / N」 + 진행 괘선. 저장소 기준 카운트다.
 *
 * 상호작용 로직은 전부 `formReducer`(순수)에 있다. 여기는 이벤트 → 액션 변환과 마크업뿐.
 */
import { useEffect, useId, useReducer, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";

import { IconButton, IconFx, IconLock, IconRevert } from "@/app/_components/icons";
import type { Issue } from "@/domain/types";

import {
  formatValue,
  formProgress,
  formReducer,
  initFormState,
  toSubmission,
  type Draft,
  type FieldState,
  type FieldView,
  type FormModel,
  type Submission,
} from "./model";

export interface StructFormProps {
  model: FormModel;
  /** 제출 — issues 가 없을 때만 불린다. `embedded` 면 안 쓴다. */
  onSubmit?: (submission: Submission) => void | Promise<void>;
  /**
   * 바깥 편집 흐름(EditShell)에 얹혀 쓰는 모드 — 자기 저장 버튼을 내리고 초안을 `onChange` 로 올려보낸다.
   * 「저장 하나가 화면의 변경을 다 담는다」(디자인원칙 §2 L2)를 값 폼에도 적용하기 위한 자리.
   */
  embedded?: boolean;
  /** `embedded` 일 때 초안이 바뀔 때마다. 바깥이 모아서 한 번에 저장한다. */
  onChange?: (submission: Submission) => void;
  /** `embedded` 읽기 모드 — 입력칸을 잠근다. */
  readOnly?: boolean;
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
  /** 출처 문법 클래스 — 테두리 있는 입력에만 붙는다 (라디오·체크박스 묶음에는 그릴 상자가 없다). */
  className?: string;
}

function textDraft(field: FieldState): string {
  return Array.isArray(field.draft) ? field.draft.join(",") : field.draft;
}

function StringInput({ id, field, onEdit, className }: InputProps) {
  return (
    <input
      id={id}
      type="text"
      className={className}
      name={field.view.path}
      value={textDraft(field)}
      onChange={(e) => onEdit(e.target.value)}
    />
  );
}

function NumberInput({ id, field, onEdit, className }: InputProps) {
  return (
    <input
      id={id}
      type="number"
      step="any"
      className={className}
      name={field.view.path}
      value={textDraft(field)}
      onChange={(e) => onEdit(e.target.value)}
    />
  );
}

function DateInput({ id, field, onEdit, className }: InputProps) {
  return (
    <input
      id={id}
      type="date"
      className={className}
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

function EnumInput({ id, field, onEdit, className }: InputProps) {
  return (
    <select
      id={id}
      className={className}
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

// ───────────────────────────── 출처 표시 (§1.2) ─────────────────────────────

/** 읽기 전용 값 표시 문자열 — 표시명으로 (ADR-0005). */
function displayOf(view: FieldView, value: FieldView["value"]): string {
  return formatValue({ ...view, state: "entered", value }) ?? "";
}

/** 파생값 — 테두리 없음 + 옅은 바탕 + ƒ 표식 + 식 노출. 여기서는 못 고친다. */
function DerivedField({ view }: { view: FieldView }) {
  const tip = `파생값 — 식으로 계산된다 · 식: ${view.expression ?? ""}`;
  return (
    <span className="ts-field-derived" title={tip}>
      <span className="ts-src-mark" aria-hidden="true">
        <IconFx />
      </span>
      <span className="ts-expr">{view.expression}</span>
      <span className="ts-badge locked">계산값</span>
    </span>
  );
}

/** const — 테두리 없음 + 옅은 바탕 + 자물쇠 + 마스터 라벨. */
function ConstField({ view }: { view: FieldView }) {
  const text = displayOf(view, view.masterValue);
  const tip = `마스터가 소유한 값 — 여기서 고칠 수 없다 · 마스터: ${view.masterLabel ?? ""}`;
  return (
    <span className="ts-field-const" title={tip}>
      <span className="ts-src-lock" aria-hidden="true">
        <IconLock />
      </span>
      <span>{text}</span>
      <span className="ts-master-link">{view.masterLabel}</span>
    </span>
  );
}

// ───────────────────────────── 필드 행 ─────────────────────────────

interface FieldRowProps {
  idBase: string;
  field: FieldState;
  externalIssues: Issue[];
  onEdit: (draft: Draft) => void;
  onRevert: () => void;
}

function FieldRow({ idBase, field, externalIssues, onEdit, onRevert }: FieldRowProps) {
  const { view } = field;
  const [askRevert, setAskRevert] = useState(false);
  const id = `${idBase}-${view.path.replace(".", "-")}`;
  const Input = INPUT_BY_KIND[view.type.kind];
  const readOnly = view.source === "const" || view.source === "derived";
  const notEntered = view.state !== "entered";
  const masterText = displayOf(view, view.masterValue);
  const revertTip = `마스터 값으로 되돌리기 · 마스터: ${view.masterLabel ?? ""} = ${masterText}`;

  const control =
    view.source === "derived" ? (
      <DerivedField view={view} />
    ) : view.source === "const" ? (
      <ConstField view={view} />
    ) : view.source === "snapshot" ? (
      <span className="ts-field-snapshot">
        <Input id={id} field={field} onEdit={onEdit} className="ts-field-direct" />
        <IconButton
          className="ts-revert"
          label={revertTip}
          icon={<IconRevert />}
          onClick={() => setAskRevert(true)}
        />
      </span>
    ) : (
      <Input id={id} field={field} onEdit={onEdit} className="ts-field-direct" />
    );

  return (
    <div className={`ts-form-row${field.entered ? "" : " is-not-entered"}`} data-path={view.path} data-source={view.source}>
      <label id={`${id}-label`} htmlFor={id} className="ts-form-label">
        {view.label}
      </label>
      <div className="ts-form-control">
        {control}
        {!readOnly && notEntered && <span className="ts-badge missing">미입력</span>}
        {!readOnly && field.proposed && <span className="ts-badge proposed">제안값 · 저장해야 확정</span>}
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
      {askRevert && (
        // 되돌리기는 사람이 쓴 값을 지운다 → 확인을 거친다 (§1.2 · §1.5). 버튼은 텍스트다 (§1.6 예외 ②)
        <div className="ts-form-full">
          <section className="ts-confirm">
            <p className="ts-confirm-title">{view.label} 을(를) 마스터 값으로 되돌린다</p>
            <ul className="ts-confirm-loss">
              <li>지금 칸에 있는 「{textDraft(field) === "" ? "빈 값" : displayOf(view, field.value)}」 이(가) 사라진다</li>
              <li>
                마스터 {view.masterLabel} 의 값 「{masterText}」 이(가) 들어온다 — 저장해야 확정된다
              </li>
            </ul>
            <div className="ts-confirm-actions">
              <button
                type="button"
                className="danger"
                onClick={() => {
                  onRevert();
                  setAskRevert(false);
                }}
              >
                마스터 값으로 되돌리기
              </button>
              <button type="button" onClick={() => setAskRevert(false)}>
                취소
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── 폼 ─────────────────────────────

/** 저장소 기준 값 상태의 지문 — 서버가 새 모델을 내려보내면(저장 직후) 편집 상태를 그것에 맞춘다. */
function savedSignature(model: FormModel): string {
  return JSON.stringify(model.fields.map((f) => [f.path, f.state, f.value ?? null]));
}

export function StructForm({ model, onSubmit, submitLabel = "저장", pending, issues = [], embedded, onChange, readOnly }: StructFormProps) {
  const [state, dispatch] = useReducer(formReducer, model, initFormState);
  const [submitIssues, setSubmitIssues] = useState<Issue[]>([]);
  const [signature, setSignature] = useState(() => savedSignature(model));
  const idBase = useId();

  // 저장이 끝나 서버 값이 바뀌면 초안을 새 진실로 다시 세운다 (배지·카운트가 옛 상태로 남지 않게).
  // 렌더 중 상태 조정 — React 의 「props 가 바뀌면 상태를 맞추기」 패턴.
  const nextSignature = savedSignature(model);
  if (signature !== nextSignature) {
    setSignature(nextSignature);
    dispatch({ type: "reset", model });
  }
  const live = state;

  const progress = formProgress(model);

  // embedded: 초안이 바뀔 때마다 바깥(EditShell)으로 올린다. 저장은 바깥이 한 번에 한다.
  // 읽기 모드에서는 올리지 않는다 — 안 고쳤는데 「변경됨」으로 잡히면 안 된다.
  useEffect(() => {
    if (embedded && onChange && !readOnly) onChange(toSubmission(live));
    // onChange 는 매 렌더 새 함수일 수 있어 의존성에서 뺀다 — 초안(live)이 바뀔 때만 올린다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedded, live]);

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const submission = toSubmission(live);
    if (submission.issues.length > 0) {
      setSubmitIssues(submission.issues);
      return;
    }
    setSubmitIssues([]);
    void onSubmit?.(submission);
  };

  const allIssues = [...submitIssues, ...issues];
  const issuesAt = (path: string) => allIssues.filter((i) => i.at.refPath === path);
  const unplaced = allIssues.filter((i) => !i.at.refPath || !live.fields[i.at.refPath]);

  return (
    <form className={readOnly ? "ts-form ts-form-read" : "ts-form"} data-discriminator={model.code} onSubmit={handleSubmit} inert={readOnly}>
      <h2 className="ts-form-title">
        {model.label}
        {progress.total > 0 && (
          <>
            <span className="ts-count">
              <b>입력 {progress.entered}</b> / {progress.total}
            </span>
            <span
              className="ts-progress"
              style={{ "--value": progress.percent } as CSSProperties}
              aria-hidden="true"
            />
          </>
        )}
      </h2>
      {model.fields.length === 0 && <p className="ts-form-empty">입력할 값 자리가 없습니다.</p>}
      {model.fields.map((view) => {
        const field = live.fields[view.path];
        return (
          <FieldRow
            key={view.path}
            idBase={idBase}
            field={field}
            externalIssues={issuesAt(view.path)}
            onEdit={(draft) => dispatch({ type: "edit", path: view.path, draft })}
            onRevert={() => dispatch({ type: "revertToMaster", path: view.path })}
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
      {progress.total > 0 && !embedded && (
        <div className="ts-form-actions">
          <button type="submit" className="primary" disabled={pending}>
            {submitLabel}
          </button>
          <button
            type="button"
            className="ts-form-clear"
            onClick={() => dispatch({ type: "clearAll" })}
            title={`${model.label} 의 입력칸을 모두 비운다 (제안값도 걷어낸다)`}
            disabled={pending}
          >
            비우기
          </button>
        </div>
      )}
    </form>
  );
}
