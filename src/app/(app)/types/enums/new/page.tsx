import Link from "next/link";

import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { createTypeEnumAction } from "../../actions";

export default async function NewEnumPage({ searchParams }: { searchParams: Promise<{ error?: string; q?: string }> }) {
  const sp = await searchParams;
  const suggested = (sp.q ?? "").trim();
  return <div>
    <p className="ts-back"><Link href="/types/enums">← 선택지 목록</Link></p>
    <h2 className="ts-h1">새 선택지</h2>
    <ErrorBanner message={sp.error} />
    <form action={createTypeEnumAction} className="ts-form">
      <div className="ts-form-row"><label htmlFor="enum-label">표시명</label><div className="ts-form-control"><input id="enum-label" name="label" defaultValue={suggested} required />{suggested ? <span className="ts-badge proposed">제안</span> : null}</div></div>
      <div className="ts-form-row"><label htmlFor="enum-values">값</label><div className="ts-form-control"><textarea id="enum-values" name="values" rows={6} placeholder={'일반심사\n간편심사\n무심사'} /></div></div>
      <div className="ts-form-row"><label htmlFor="enum-description">설명</label><div className="ts-form-control"><textarea id="enum-description" name="description" rows={2} /></div></div>
      <p className="ts-muted">값은 한 줄에 하나씩 입력한다.</p>
      <div className="ts-form-actions"><button type="submit" className="primary">생성</button></div>
    </form>
  </div>;
}
