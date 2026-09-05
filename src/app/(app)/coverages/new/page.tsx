import { ErrorBanner } from "@/app/_components/ErrorBanner";

import { createCoverageAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewCoveragePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div>
      <h1 className="ts-h1">새 담보</h1>
      <ErrorBanner message={error} />
      <form action={createCoverageAction} className="ts-form">
        <label className="ts-field">
          <span>담보명</span>
          <input type="text" name="name" required />
        </label>
        <label className="ts-field">
          <span>설명</span>
          <textarea name="description" rows={2} />
        </label>
        <label className="ts-field">
          <span>세부보장명 (비우면 담보명)</span>
          <input type="text" name="subCoverageName" />
        </label>
        <label className="ts-field">
          <span>급부명 (비우면 세부보장명)</span>
          <input type="text" name="benefitName" />
        </label>
        <p className="ts-muted">세부보장 1 · 급부 1 이 함께 생성됩니다 (최소 구조).</p>
        <div className="ts-form-actions">
          <button type="submit">생성</button>
        </div>
      </form>
    </div>
  );
}
