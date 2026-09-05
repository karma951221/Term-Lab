import { ErrorBanner } from "@/app/_components/ErrorBanner";

import { createProductAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewProductPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div>
      <h1 className="ts-h1">새 상품</h1>
      <ErrorBanner message={error} />
      <form action={createProductAction} className="ts-form">
        <label className="ts-field">
          <span>상품명</span>
          <input type="text" name="name" required />
        </label>
        <div className="ts-form-actions">
          <button type="submit">생성</button>
        </div>
      </form>
    </div>
  );
}
