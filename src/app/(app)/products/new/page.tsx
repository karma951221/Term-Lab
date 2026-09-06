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
        <div className="ts-form-row">
          <label className="ts-form-label" htmlFor="product-name">
            상품명
          </label>
          <div className="ts-form-control">
            <input id="product-name" type="text" name="name" required />
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
