import Link from "next/link";

import { EmptyState } from "@/app/_components/EmptyState";
import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { ListShell } from "@/app/_components/ListShell";
import { getServices } from "@/lib/services";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; q?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const products = await getServices().product.listProducts();

  const q = (sp.q ?? "").trim();
  const filtered = q ? products.filter((p) => p.name.includes(q)) : products;
  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, Number(sp.page) || 1), pageCount);
  const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <ErrorBanner message={sp.error} />
      {/* 상품 마스터에는 코드가 없다(src/domain/product/types.ts Product — id·name·generalDocumentId 뿐) —
       * 1열을 상품명(col-flex)으로 하고 나머지 고정 컬럼을 뒤에 둔다 (작업지시대로). */}
      <ListShell
        heading={<h1 className="ts-h1">상품</h1>}
        toolbar={
          <div className="ts-toolbar">
            <Link href="/products/new">+ 새 상품</Link>
          </div>
        }
        filters={
          <label>
            검색
            <input type="text" name="q" defaultValue={q} placeholder="상품명" />
          </label>
        }
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        basePath="/products"
        query={{ q }}
        empty={
          products.length === 0 ? (
            <EmptyState
              what="상품은 약관 책자 1권의 단위다 — 담보를 탑재하고 문면을 조립한다."
              example="알파Plus(축약)"
              actionHref="/products/new"
              actionLabel="새 상품 만들기"
            />
          ) : (
            <p className="ts-empty-what">이 조건에 맞는 상품이 없습니다.</p>
          )
        }
      >
        <table className="ts-table">
          <thead>
            <tr>
              <th className="col-flex">상품명</th>
              <th className="col-fixed-md">보통약관</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td className="col-flex">
                  <Link href={`/products/${p.id}`}>{p.name}</Link>
                </td>
                <td className="col-fixed-md">{p.generalDocumentId ? "지정됨" : <span className="ts-muted">미지정</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ListShell>
    </div>
  );
}
