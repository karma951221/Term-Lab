import Link from "next/link";

import { IssueList } from "@/app/_components/IssueList";
import { RenderedDoc, RenderedGroupView } from "@/app/_components/RenderedDoc";
import type { RenderedDoc as RenderedDocType } from "@/domain/assembly";
import { currentActor, getServices } from "@/lib/services";

export const dynamic = "force-dynamic";

/** 조 수 — 오류 마커 노드는 조가 아니므로 빼고 센다. */
function articleCount(doc: RenderedDocType | undefined): number {
  return doc ? doc.children.filter((c) => c.kind === "article").length : 0;
}

export default async function ProductPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const services = getServices();
  await currentActor();
  const product = await services.product.getProduct(id);
  const result = await services.assembly.preview(id);

  if (!result.ok) {
    return (
      <div>
        <h1 className="ts-h1">조립 미리보기</h1>
        <p className="ts-error-banner">조립할 수 없습니다: {result.rejection.reason}</p>
      </div>
    );
  }
  const booklet = result.value;

  // 먼저 읽히는 숫자는 전체 규모다 (디자인원칙 §9.6) — 조립이 만들어 낸 것을 세고, 오류는 그 뒤에 온다.
  const specialDocs = booklet.specials.flatMap((g) => g.docs);
  const generalArticles = articleCount(booklet.general);
  const totalArticles = generalArticles + specialDocs.reduce((n, d) => n + articleCount(d), 0);
  const warnings = booklet.issues.filter((i) => i.severity === "warning").length;
  const errors = booklet.issues.length - warnings;
  const errorCount = (
    <span className="ts-count">
      <b>{errors}</b> / 조 {totalArticles}
      {warnings > 0 && <> · 경고 {warnings}</>}
    </span>
  );

  return (
    <div>
      <p className="ts-count">
        보통약관 {generalArticles}조 · 특약 {specialDocs.length}건 · 별표 {booklet.appendices.length} — 오류 {errorCount}
      </p>
      <div className="ts-page-head">
        <h1 className="ts-h1">{product?.name ?? id} — 조립 미리보기</h1>
        <Link href={`/products/${id}`}>← 상품으로</Link>
      </div>
      {!booklet.complete && <p className="ts-error-banner">「완성본 아님」 — 아래 오류 패널을 확인하세요.</p>}

      <section className="ts-section">
        <h2 className="ts-section-title">오류 {errorCount}</h2>
        {booklet.issues.length === 0 ? <p className="ts-ok">오류 없음.</p> : <IssueList issues={booklet.issues} />}
      </section>

      {booklet.omitted.length > 0 && (
        <section className="ts-section">
          <h2 className="ts-section-title">
            생략된 조 (조연결 + 리터럴 동일) <span className="ts-count">{booklet.omitted.length}건</span>
          </h2>
          <ul>
            {booklet.omitted.map((o, i) => (
              <li key={i}>
                {o.productCoverageName} — {o.articleTitle}
              </li>
            ))}
          </ul>
        </section>
      )}

      <h2 className="ts-h2">
        보통약관 <span className="ts-count">{generalArticles}조</span>
      </h2>
      {booklet.general ? <RenderedDoc doc={booklet.general} /> : <p className="ts-muted">보통약관 템플릿이 없습니다.</p>}

      <h2 className="ts-h2">
        특약 그룹 <span className="ts-count">{specialDocs.length}건</span>
      </h2>
      {booklet.specials.map((g) => (
        <RenderedGroupView key={g.id} group={g} />
      ))}

      <h2 className="ts-h2">
        별표 <span className="ts-count">{booklet.appendices.length}건</span>
      </h2>
      <ul>
        {booklet.appendices.map((a) => (
          <li key={a.code}>
            【별표{a.number}({a.name})】
          </li>
        ))}
      </ul>

      <p style={{ marginTop: 24 }}>
        <Link href={`/products/${id}`}>← 상품으로</Link>
      </p>
    </div>
  );
}
