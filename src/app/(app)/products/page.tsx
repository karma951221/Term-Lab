import Link from "next/link";

import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { getServices } from "@/lib/services";

export const dynamic = "force-dynamic";

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const products = await getServices().product.listProducts();

  return (
    <div>
      <h1 className="ts-h1">상품</h1>
      <ErrorBanner message={error} />
      <div className="ts-toolbar">
        <Link href="/products/new">+ 새 상품</Link>
      </div>
      <table className="ts-table">
        <thead>
          <tr>
            <th>상품명</th>
            <th>보통약관</th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.id}>
              <td>
                <Link href={`/products/${p.id}`}>{p.name}</Link>
              </td>
              <td>{p.generalDocumentId ? "지정됨" : <span className="ts-muted">미지정</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {products.length === 0 && <p className="ts-muted">아직 상품이 없습니다.</p>}
    </div>
  );
}
