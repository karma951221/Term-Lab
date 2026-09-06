import Link from "next/link";

import { EmptyState } from "@/app/_components/EmptyState";
import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { ListShell } from "@/app/_components/ListShell";
import { getServices } from "@/lib/services";

import { createGeneralAction } from "./actions";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; gq?: string; gpage?: string; sq?: string; spage?: string }>;
}) {
  const sp = await searchParams;
  const services = getServices();
  const generals = await services.document.list("general");
  const specials = await services.document.list("special");

  const gq = (sp.gq ?? "").trim();
  const gFiltered = gq ? generals.filter((d) => d.title.includes(gq)) : generals;
  const gTotal = gFiltered.length;
  const gPageCount = Math.max(1, Math.ceil(gTotal / PAGE_SIZE));
  const gPage = Math.min(Math.max(1, Number(sp.gpage) || 1), gPageCount);
  const gRows = gFiltered.slice((gPage - 1) * PAGE_SIZE, gPage * PAGE_SIZE);

  const sq = (sp.sq ?? "").trim();
  const sFiltered = sq ? specials.filter((d) => d.title.includes(sq)) : specials;
  const sTotal = sFiltered.length;
  const sPageCount = Math.max(1, Math.ceil(sTotal / PAGE_SIZE));
  const sPage = Math.min(Math.max(1, Number(sp.spage) || 1), sPageCount);
  const sRows = sFiltered.slice((sPage - 1) * PAGE_SIZE, sPage * PAGE_SIZE);

  return (
    <div>
      <h1 className="ts-h1">문면</h1>
      <ErrorBanner message={sp.error} />

      <ListShell
        heading={<h2 className="ts-h2">보통약관 마스터</h2>}
        toolbar={
          <form id="create-general-form" action={createGeneralAction} className="ts-form-row">
            <label className="ts-form-label" htmlFor="doc-title">
              제목
            </label>
            <div className="ts-form-control">
              <input id="doc-title" type="text" name="title" required />
              <button type="submit">생성</button>
            </div>
          </form>
        }
        filters={
          <label>
            검색
            <input type="text" name="gq" defaultValue={gq} placeholder="제목" />
          </label>
        }
        total={gTotal}
        page={gPage}
        pageSize={PAGE_SIZE}
        basePath="/documents"
        query={{ gq }}
        pageParam="gpage"
        empty={
          generals.length === 0 ? (
            <EmptyState
              what="보통약관 마스터는 여러 벌 존재하며 상품이 그중 하나를 선택해 쓰는 문서다."
              example="상해보험 표준약관"
              actionHref="#create-general-form"
              actionLabel="위 양식에서 새 보통약관 만들기"
            />
          ) : (
            <p className="ts-empty-what">이 조건에 맞는 보통약관이 없습니다.</p>
          )
        }
      >
        <table className="ts-table">
          <thead>
            <tr>
              <th className="col-flex">제목</th>
              <th className="col-fixed-md">최종수정</th>
            </tr>
          </thead>
          <tbody>
            {gRows.map((d) => (
              <tr key={d.id}>
                <td className="col-flex">
                  <Link href={`/documents/${d.id}`}>{d.title}</Link>
                </td>
                <td className="col-fixed-md ts-mono">{formatDate(d.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ListShell>

      <ListShell
        heading={<h2 className="ts-h2">담보약관 (특별약관)</h2>}
        filters={
          <label>
            검색
            <input type="text" name="sq" defaultValue={sq} placeholder="제목" />
          </label>
        }
        total={sTotal}
        page={sPage}
        pageSize={PAGE_SIZE}
        basePath="/documents"
        query={{ sq }}
        pageParam="spage"
        empty={
          specials.length === 0 ? (
            <EmptyState
              what="담보약관은 담보 하나가 소유하는 특별약관 문서다 — 문서를 여기서 직접 만들지 않는다."
              example="일반상해사망 특별약관"
              actionHref="/coverages"
              actionLabel="담보약관은 담보 상세 화면에서 생성하세요 — 담보 목록으로"
            />
          ) : (
            <p className="ts-empty-what">이 조건에 맞는 담보약관이 없습니다.</p>
          )
        }
      >
        <table className="ts-table">
          <thead>
            <tr>
              <th className="col-flex">제목</th>
              <th className="col-fixed-md">담보</th>
              <th className="col-fixed-md">대응 보통약관</th>
            </tr>
          </thead>
          <tbody>
            {sRows.map((d) => (
              <tr key={d.id}>
                <td className="col-flex">
                  <Link href={`/documents/${d.id}`}>{d.title}</Link>
                </td>
                <td className="col-fixed-md">{d.ownerId ? <Link href={`/coverages/${d.ownerId}`}>담보 열기</Link> : "—"}</td>
                <td className="col-fixed-md">
                  {d.generalDocumentId ? <Link href={`/documents/${d.generalDocumentId}`}>있음</Link> : <span className="ts-muted">없음</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ListShell>
    </div>
  );
}
