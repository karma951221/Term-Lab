import Link from "next/link";

import { previewOutcome } from "@/app/_lib/rejection";
import { usagesOf } from "@/domain/refs";
import { currentActor, getServices } from "@/lib/services";

import { FormEditor } from "./FormEditor";

export const dynamic = "force-dynamic";

export default async function FormDetailPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const services = getServices();
  const [loaded, enums, graph, actor] = await Promise.all([services.catalog.get(code), services.catalog.listEnums(), services.refs.graph(), currentActor()]);
  if (!loaded || loaded.kind !== "struct") return <div><h2 className="ts-h1">폼 {code}</h2><p className="ts-error-banner">찾을 수 없습니다.</p><Link href="/types/forms">← 폼 목록</Link></div>;
  const usageCount = usagesOf(graph, { kind: "discriminator", code }).length;
  const fieldUsage = Object.fromEntries(loaded.fields.map((field) => [field.code, usagesOf(graph, { kind: "field", code, fieldCode: field.code }).length]));
  const preview = previewOutcome(await services.catalog.remove(actor, code));
  const valueRows = preview.kind === "confirm" ? preview.impact.valueRowsLost : 0;
  const signature = loaded.fields.map((field) => field.code).join(":");
  return <div><FormEditor key={`${code}:${signature}`} def={loaded} initialEnums={enums} usageCount={usageCount} fieldUsage={fieldUsage} valueRows={valueRows} /></div>;
}
