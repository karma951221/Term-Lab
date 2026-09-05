import { ErrorBanner } from "@/app/_components/ErrorBanner";

import { createClauseAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewClausePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div>
      <h1 className="ts-h1">새 공용조항</h1>
      <ErrorBanner message={error} />
      <form action={createClauseAction} className="ts-form">
        <label className="ts-field">
          <span>표시명</span>
          <input type="text" name="label" required />
        </label>
        <label className="ts-field">
          <span>모드</span>
          <select name="mode" required>
            <option value="inline">inline (문장 안)</option>
            <option value="block">block (항 자리)</option>
          </select>
        </label>
        <label className="ts-field">
          <span>본문 JSON (구조 편집기 최소형 — 문면 편집기와 같은 노드 모양)</span>
          <textarea name="body" className="ts-json" placeholder='inline 예: [{"id":"t1","kind":"text","text":"소멸합니다."}]' />
        </label>
        <label className="ts-field">
          <span>설명</span>
          <textarea name="description" rows={2} />
        </label>
        <div className="ts-form-actions">
          <button type="submit">생성</button>
        </div>
      </form>
    </div>
  );
}
