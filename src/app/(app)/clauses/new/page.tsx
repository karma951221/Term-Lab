import { ErrorBanner } from "@/app/_components/ErrorBanner";

import { createClauseAction } from "../actions";
import { ModeBody } from "./ModeBody";

export const dynamic = "force-dynamic";

export default async function NewClausePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div>
      <h1 className="ts-h1">새 공용조항</h1>
      <ErrorBanner message={error} />
      <form action={createClauseAction} className="ts-form">
        <div className="ts-form-row">
          <label className="ts-form-label" htmlFor="clause-label">
            표시명
          </label>
          <div className="ts-form-control">
            <input id="clause-label" type="text" name="label" required />
          </div>
        </div>
        <ModeBody />
        <div className="ts-form-row">
          <label className="ts-form-label" htmlFor="clause-desc">
            설명
          </label>
          <div className="ts-form-control">
            <textarea id="clause-desc" name="description" rows={2} />
          </div>
        </div>
        <div className="ts-form-actions">
          <button type="submit" className="primary">
            생성
          </button>
        </div>
      </form>
    </div>
  );
}
