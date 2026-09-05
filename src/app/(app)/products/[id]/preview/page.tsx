import Link from "next/link";

import { RenderedDoc, RenderedGroupView } from "@/app/_components/RenderedDoc";
import { currentActor, getServices } from "@/lib/services";

export const dynamic = "force-dynamic";

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

  return (
    <div>
      <h1 className="ts-h1">{product?.name ?? id} — 조립 미리보기</h1>
      {!booklet.complete && <p className="ts-error-banner">「완성본 아님」 — 아래 오류 패널을 확인하세요.</p>}

      <h2 className="ts-h2">오류 패널 ({booklet.issues.length})</h2>
      {booklet.issues.length === 0 ? (
        <p className="ts-ok">오류 없음.</p>
      ) : (
        <ul className="ts-issues">
          {booklet.issues.map((issue, i) => (
            <li key={i}>
              [{issue.kind}] {issue.message}
              {issue.at.articleTitle && ` · ${issue.at.articleTitle}`}
              {issue.at.refPath && ` · ${issue.at.refPath}`}
              {issue.at.nodePath && issue.at.nodePath.length > 0 && (
                <>
                  {" "}
                  <a href={`#node-${issue.at.nodePath.at(-1)}`}>해당 자리로 이동</a>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {booklet.omitted.length > 0 && (
        <>
          <h2 className="ts-h2">생략된 조 (조연결 + 리터럴 동일)</h2>
          <ul>
            {booklet.omitted.map((o, i) => (
              <li key={i}>
                {o.productCoverageName} — {o.articleTitle}
              </li>
            ))}
          </ul>
        </>
      )}

      <h2 className="ts-h2">보통약관</h2>
      {booklet.general ? <RenderedDoc doc={booklet.general} /> : <p className="ts-muted">보통약관 템플릿이 없습니다.</p>}

      <h2 className="ts-h2">특약 그룹</h2>
      {booklet.specials.map((g) => (
        <RenderedGroupView key={g.id} group={g} />
      ))}

      <h2 className="ts-h2">별표 ({booklet.appendices.length})</h2>
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
