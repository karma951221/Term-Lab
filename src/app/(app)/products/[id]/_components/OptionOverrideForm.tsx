"use client";

/**
 * 옵션 오버라이드 설정 폼 — 노드 id·공용조항 코드·옵션 JSON 을 사람이 옮겨 적던 자리를 select 로 바꾼다
 * (리뷰 #7 · #65 · 디자인원칙 §9.1). 고르는 것은 둘뿐이다:
 *   ① 보통약관 문면의 공용조항 참조 자리 (「제4조(…) › 공용조항 …」)
 *   ② 그 공용조항이 가진 옵션마다의 선택지
 * 서버 액션은 그대로 `nodeId` · `clauseCode` · `options`(JSON) 를 받으므로 hidden 으로 조립해 넘긴다.
 */
import { useState } from "react";

export interface OverrideOptionValue {
  code: string;
  label: string;
}

export interface OverrideOption {
  code: string;
  label: string;
  values: OverrideOptionValue[];
}

export interface OverrideTarget {
  nodeId: string;
  clauseCode: string;
  /** 「제4조(보험금의 지급사유) › 공용조항 면책 보충(C0002)」 */
  label: string;
  options: OverrideOption[];
}

export function OptionOverrideForm({ targets, action }: { targets: OverrideTarget[]; action: (formData: FormData) => void | Promise<void> }) {
  const [nodeId, setNodeId] = useState(targets[0]?.nodeId ?? "");
  const [selection, setSelection] = useState<Record<string, string>>({});
  const target = targets.find((t) => t.nodeId === nodeId) ?? targets[0];

  if (!target) return null;

  const chosen = Object.fromEntries(Object.entries(selection).filter(([, v]) => v !== ""));

  return (
    <form action={action} className="ts-form">
      <h3 className="ts-form-title">오버라이드 설정</h3>
      <input type="hidden" name="nodeId" value={target.nodeId} />
      <input type="hidden" name="clauseCode" value={target.clauseCode} />
      <input type="hidden" name="options" value={JSON.stringify(chosen)} />

      <label className="ts-field">
        <span>공용조항 자리</span>
        <select
          value={target.nodeId}
          onChange={(e) => {
            setNodeId(e.target.value);
            setSelection({});
          }}
        >
          {targets.map((t) => (
            <option key={t.nodeId} value={t.nodeId}>
              {t.label}
            </option>
          ))}
        </select>
      </label>

      {target.options.length === 0 ? (
        <p className="ts-form-empty">이 공용조항에는 고를 옵션이 없다.</p>
      ) : (
        target.options.map((o) => (
          <label key={o.code} className="ts-field">
            <span>{o.label}</span>
            <select value={selection[o.code] ?? ""} onChange={(e) => setSelection((prev) => ({ ...prev, [o.code]: e.target.value }))}>
              <option value="">— 그대로 —</option>
              {o.values.map((v) => (
                <option key={v.code} value={v.code}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
        ))
      )}

      <div className="ts-form-actions">
        <button type="submit" className="primary" disabled={target.options.length === 0}>
          오버라이드 저장
        </button>
      </div>
    </form>
  );
}
