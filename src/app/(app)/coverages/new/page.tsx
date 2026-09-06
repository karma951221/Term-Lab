import { ErrorBanner } from "@/app/_components/ErrorBanner";

import { createCoverageAction } from "../actions";
import { NameFollow } from "./NameFollow";

export const dynamic = "force-dynamic";

export default async function NewCoveragePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div>
      <h1 className="ts-h1">새 담보</h1>
      <ErrorBanner message={error} />
      <form action={createCoverageAction} className="ts-form">
        <NameFollow />
        <div className="ts-form-row">
          <label className="ts-form-label" htmlFor="cov-desc">
            설명
          </label>
          <div className="ts-form-control">
            <textarea id="cov-desc" name="description" rows={2} />
          </div>
        </div>
        <p className="ts-muted">세부보장 1 · 급부 1 이 함께 생성됩니다 (최소 구조).</p>
        <div className="ts-form-actions">
          <button type="submit" className="primary">
            생성
          </button>
        </div>
      </form>
    </div>
  );
}
