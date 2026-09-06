import Link from "next/link";

import { coordinateHref } from "@/app/_components/coordinateHref";
import { formatCoordinate } from "@/domain/coordinate";
import { refStats, usagesOf, type EdgeVia } from "@/domain/refs";
import { currentActor, getServices } from "@/lib/services";
import { previewOutcome } from "@/app/_lib/rejection";

import { CatalogEditor } from "./CatalogEditor";

export const dynamic = "force-dynamic";

const VIA_LABEL = {
  when: "조건식", slot: "치환 슬롯", expression: "파생식", clauseRef: "공용조항 참조", optionSelect: "옵션 선택",
  override: "옵션 오버라이드", articleRef: "조 참조", link: "조연결", appendixRef: "별표 참조", generalDocument: "보통약관 연결",
  document: "담보약관", type: "타입", attach: "부착", mount: "탑재", combination: "조합",
} as const satisfies Record<EdgeVia, string>;

export default async function CatalogDetailPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const services = getServices();
  const def = await services.catalog.get(code);
  if (!def) return <div><h1 className="ts-h1">구분자 {code}</h1><p className="ts-error-banner">찾을 수 없습니다.</p><Link href="/catalog">← 구분자 목록</Link></div>;
  const [enums, graph, actor] = await Promise.all([services.catalog.listEnums(), services.refs.graph(), currentActor()]);
  const usages = usagesOf(graph, { kind: "discriminator", code });
  const totalRefs = refStats(graph).edges;
  const preview = previewOutcome(await services.catalog.remove(actor, code));
  const valueRows = preview.kind === "confirm" ? preview.impact.valueRowsLost : 0;
  const usage = <div>
    <p className="ts-l2-side-title">사용처 <span className="ts-count"><b>{usages.length}</b> / 전체 참조 {totalRefs}</span></p>
    {usages.length === 0 ? <div className="ts-empty"><p className="ts-empty-what">아무 문면 · 식도 이 구분자를 읽지 않는다.</p><p className="ts-empty-action"><Link href="/documents">문면에서 쓰러 가기 →</Link></p></div> : <table className="ts-table"><thead><tr><th className="col-fixed-md">형태</th><th className="col-flex">좌표</th></tr></thead><tbody>{usages.map((usage, index) => { const href = coordinateHref(usage.at); return <tr key={index}><td>{VIA_LABEL[usage.via]}</td><td>{href ? <Link href={href}>{formatCoordinate(usage.at, { source: true })}</Link> : formatCoordinate(usage.at, { source: true })}</td></tr>; })}</tbody></table>}
  </div>;
  return <div><CatalogEditor def={def} enums={enums} valueRows={valueRows} usage={usage} usageCount={usages.length} /></div>;
}
