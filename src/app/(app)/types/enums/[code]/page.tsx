import Link from "next/link";

import { usagesOf } from "@/domain/refs";
import { getServices } from "@/lib/services";

import { EnumEditor } from "./EnumEditor";

export const dynamic = "force-dynamic";

export default async function EnumDetailPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const services = getServices();
  const [item, graph] = await Promise.all([services.catalog.getEnum(code), services.refs.graph()]);
  if (!item) return <div><h2 className="ts-h1">선택지 {code}</h2><p className="ts-error-banner">찾을 수 없습니다.</p><Link href="/types/enums">← 선택지 목록</Link></div>;
  const usageCount = usagesOf(graph, { kind: "enum", enumCode: code }, { via: ["type"] }).length;
  const valueUsage = Object.fromEntries(item.values.map((value) => [value.code, usagesOf(graph, { kind: "enumValue", enumCode: code, valueCode: value.code }).length]));
  const signature = item.values.map((value) => value.code).join(":");
  return <div><EnumEditor key={`${code}:${signature}`} item={item} usageCount={usageCount} valueUsage={valueUsage} /></div>;
}
