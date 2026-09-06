/**
 * ValueList — 폼 모델의 읽기 전용 뷰. 완결성 표시용.
 *
 * 요약은 **해낸 것을 센다** — 「3개 중 2개 입력」 + 진행 괘선 (디자인원칙 §9.2 · §9.6, 리뷰 #13).
 * 「미입력 N」을 단독으로 두지 않는다: 분모 없는 숫자는 정보가 아니다.
 *
 * 상태가 없어 서버 컴포넌트에서도 그대로 쓸 수 있다 ("use client" 없음).
 * 값은 표시명으로 보여준다 (ADR-0005). 기본값은 값이 아니므로 보여주지 않는다 (ADR-0004).
 */
import type { CSSProperties } from "react";

import { IconFx, IconLock } from "@/app/_components/icons";

import { formatValue, formProgress, type FieldView, type FormModel } from "./model";

export interface ValueListProps {
  model: FormModel;
  /** 제목(구분자 표시명) 숨김. */
  hideTitle?: boolean;
}

/** 값 자리가 아닌 자리(파생·const)는 값 대신 출처를 보여준다 (§1.2). */
function SourceMark({ field }: { field: FieldView }) {
  if (field.source === "derived") {
    return (
      <span className="ts-field-derived" title={`파생값 — 식으로 계산된다 · 식: ${field.expression ?? ""}`}>
        <span className="ts-src-mark" aria-hidden="true">
          <IconFx />
        </span>
        <span className="ts-expr">{field.expression}</span>
      </span>
    );
  }
  return (
    <span className="ts-field-const" title={`마스터가 소유한 값 · 마스터: ${field.masterLabel ?? ""}`}>
      <span className="ts-src-lock" aria-hidden="true">
        <IconLock />
      </span>
      <span>{formatValue(field) ?? ""}</span>
    </span>
  );
}

export function ValueList({ model, hideTitle }: ValueListProps) {
  const progress = formProgress(model);
  return (
    <section className="ts-values" data-discriminator={model.code}>
      {!hideTitle && <h3 className="ts-values-title">{model.label}</h3>}
      <p className={`ts-values-summary${progress.entered < progress.total ? " has-missing" : ""}`}>
        <span className="ts-count">
          {progress.total}개 중 <b>{progress.entered}개 입력</b>
        </span>{" "}
        <span className="ts-progress" style={{ "--value": progress.percent } as CSSProperties} aria-hidden="true" />
      </p>
      <dl className="ts-values-list">
        {model.fields.map((f) => {
          const readOnly = f.source === "const" || f.source === "derived";
          const text = formatValue(f);
          return (
            <div
              key={f.path}
              className={`ts-values-row${!readOnly && text === undefined ? " is-not-entered" : ""}`}
              data-path={f.path}
              data-source={f.source}
            >
              <dt className="ts-values-label">{f.label}</dt>
              <dd className="ts-values-value">
                {readOnly ? (
                  <SourceMark field={f} />
                ) : text === undefined ? (
                  <span className="ts-badge missing">미입력</span>
                ) : (
                  text
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
