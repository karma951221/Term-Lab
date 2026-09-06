"use client";

/**
 * 「새 구분자」 종류 선택 — 4개 폼을 세로로 늘어놓는 대신(리뷰 #1) 라디오 1줄로 골라
 * 고른 종류의 폼 하나만 보여준다. 서버 액션 4개(createScalarAction 등)는 그대로 두고
 * (actions.ts 안 건드림), 4개 폼을 전부 렌더해 두고 `hidden` 으로 스위칭한다 — 폼 자체는
 * 서버 컴포넌트(page.tsx)가 만들어 children 으로 넘긴다.
 */
import { useState, type ReactNode } from "react";

import { KIND_LABEL } from "@/app/_lib/labels";
import type { DiscriminatorKind } from "@/domain/catalog/types";

const KINDS: readonly DiscriminatorKind[] = ["scalar", "struct", "const", "derived"];

export function KindPicker({ forms, initialKind = "scalar" }: { forms: Record<DiscriminatorKind, ReactNode>; initialKind?: DiscriminatorKind }) {
  const [kind, setKind] = useState<DiscriminatorKind>(initialKind);

  return (
    <div>
      <div className="ts-form-radios" role="radiogroup" aria-label="구분자 종류">
        {KINDS.map((k) => (
          <label key={k} className="ts-form-radio">
            <input type="radio" name="kind-picker" value={k} checked={kind === k} onChange={() => setKind(k)} />
            {KIND_LABEL[k]}
          </label>
        ))}
      </div>
      {KINDS.map((k) => (
        <div key={k} hidden={kind !== k}>
          {forms[k]}
        </div>
      ))}
    </div>
  );
}
