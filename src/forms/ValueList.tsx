/**
 * ValueList — 폼 모델의 읽기 전용 뷰. 완결성 표시용 — 미입력을 배지로 강조하고 건수를 요약한다.
 *
 * 상태가 없어 서버 컴포넌트에서도 그대로 쓸 수 있다 ("use client" 없음).
 * 값은 표시명으로 보여준다 (ADR-0005). 기본값은 값이 아니므로 보여주지 않는다 (ADR-0004).
 */
import { formatValue, type FormModel } from "./model";

export interface ValueListProps {
  model: FormModel;
  /** 제목(구분자 표시명) 숨김. */
  hideTitle?: boolean;
}

export function ValueList({ model, hideTitle }: ValueListProps) {
  const missing = model.fields.filter((f) => f.state !== "entered").length;
  return (
    <section className="ts-values" data-discriminator={model.code}>
      {!hideTitle && <h3 className="ts-values-title">{model.label}</h3>}
      <p className={`ts-values-summary${missing > 0 ? " has-missing" : ""}`}>미입력 {missing}건</p>
      <dl className="ts-values-list">
        {model.fields.map((f) => {
          const text = formatValue(f);
          return (
            <div
              key={f.path}
              className={`ts-values-row${text === undefined ? " is-not-entered" : ""}`}
              data-path={f.path}
            >
              <dt className="ts-values-label">{f.label}</dt>
              <dd className="ts-values-value">
                {text === undefined ? <span className="ts-form-badge">미입력</span> : text}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
