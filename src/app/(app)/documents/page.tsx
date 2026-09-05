import Link from "next/link";

import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { getServices } from "@/lib/services";

import { createGeneralAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const services = getServices();
  const generals = await services.document.list("general");
  const specials = await services.document.list("special");

  return (
    <div>
      <h1 className="ts-h1">문면</h1>
      <ErrorBanner message={error} />

      <h2 className="ts-h2">보통약관 마스터</h2>
      <form action={createGeneralAction} className="ts-form">
        <label className="ts-field">
          <span>제목</span>
          <input type="text" name="title" required />
        </label>
        <div className="ts-form-actions">
          <button type="submit">생성</button>
        </div>
      </form>
      <table className="ts-table">
        <thead>
          <tr>
            <th>제목</th>
            <th>최종수정</th>
          </tr>
        </thead>
        <tbody>
          {generals.map((d) => (
            <tr key={d.id}>
              <td>
                <Link href={`/documents/${d.id}`}>{d.title}</Link>
              </td>
              <td className="ts-muted">{d.updatedAt.toISOString().slice(0, 10)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {generals.length === 0 && <p className="ts-muted">아직 보통약관 마스터가 없습니다.</p>}

      <h2 className="ts-h2">담보약관 (특별약관)</h2>
      <table className="ts-table">
        <thead>
          <tr>
            <th>제목</th>
            <th>담보</th>
            <th>대응 보통약관</th>
          </tr>
        </thead>
        <tbody>
          {specials.map((d) => (
            <tr key={d.id}>
              <td>
                <Link href={`/documents/${d.id}`}>{d.title}</Link>
              </td>
              <td>{d.ownerId ? <Link href={`/coverages/${d.ownerId}`}>담보 열기</Link> : "—"}</td>
              <td>{d.generalDocumentId ? <Link href={`/documents/${d.generalDocumentId}`}>있음</Link> : <span className="ts-muted">없음</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {specials.length === 0 && <p className="ts-muted">아직 담보약관이 없습니다 — 담보 상세 화면에서 생성하세요.</p>}
    </div>
  );
}
