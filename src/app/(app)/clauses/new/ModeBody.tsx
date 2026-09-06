"use client";

/**
 * 모드 select + 본문 JSON textarea (리뷰 #10). 빈 textarea 대신 모드에 맞는 최소 유효 노드를
 * 프리필한다 — 모드를 바꾸면 그 모드의 프리필로 다시 채운다, **단 사람이 본문을 직접 고친 뒤로는
 * 안 건드린다** (NameFollow 와 같은 「직접 고치면 추종을 멈춘다」 규칙, §9.1).
 *
 * 두 프리필 모두 `npx tsx` 로 `analyzeBody("inline"|"block", …)` 를 돌려 통과를 확인했다
 * (src/domain/clause/body.ts) — 화면에 보이는 예시가 실제로 저장 가능한 최소형이다.
 */
import { useState, type ChangeEvent } from "react";

import type { ClauseMode } from "@/domain/clause/types";

const PREFILL: Record<ClauseMode, string> = {
  inline: JSON.stringify([{ id: "t1", kind: "text", text: "예시 문구." }], null, 2),
  block: JSON.stringify([{ id: "p1", kind: "paragraph", children: [{ id: "t1", kind: "text", text: "예시 문구." }] }], null, 2),
};

export function ModeBody() {
  const [mode, setMode] = useState<ClauseMode>("inline");
  const [body, setBody] = useState(PREFILL.inline);
  const [touched, setTouched] = useState(false);

  function onModeChange(e: ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value as ClauseMode;
    setMode(next);
    if (!touched) setBody(PREFILL[next]);
  }
  function onBodyChange(e: ChangeEvent<HTMLTextAreaElement>) {
    setTouched(true);
    setBody(e.target.value);
  }

  return (
    <>
      <div className="ts-form-row">
        <label className="ts-form-label" htmlFor="clause-mode">
          모드
        </label>
        <div className="ts-form-control">
          <select id="clause-mode" name="mode" required value={mode} onChange={onModeChange}>
            <option value="inline">문장 안</option>
            <option value="block">조 단위</option>
          </select>
        </div>
      </div>
      <div className="ts-form-row">
        <label className="ts-form-label" htmlFor="clause-body">
          본문 JSON
        </label>
        <div className="ts-form-control">
          <textarea
            id="clause-body"
            name="body"
            className="ts-json"
            value={body}
            onChange={onBodyChange}
            title="모드에 맞는 최소 예시로 채워져 있다 — 고치면 이 예시는 더 안 따라온다"
          />
        </div>
      </div>
    </>
  );
}
