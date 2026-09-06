import Link from "next/link";

import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { nodesOf } from "@/domain/coverage";
import { usagesOf } from "@/domain/refs";
import { buildForm } from "@/forms";
import { getServices } from "@/lib/services";

import { encodeNodeKey } from "../lib";
import { CoverageEditor, type EditorForm, type EditorNode } from "./CoverageEditor";

export const dynamic = "force-dynamic";

export default async function CoverageDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; tab?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const services = getServices();
  const tree = await services.coverage.get(id);
  if (!tree) {
    return (
      <div>
        <p className="ts-back"><Link href="/coverages">← 담보 목록</Link></p>
        <h2 className="ts-h1">담보</h2>
        <p className="ts-error-banner">찾을 수 없습니다.</p>
      </div>
    );
  }

  const [enumsList, graph, summaryResult, attributeKinds] = await Promise.all([
    services.catalog.listEnums(),
    services.refs.graph(),
    services.coverage.completenessSummary(tree.id),
    services.product.listAttributeKinds(),
  ]);
  const enumLookup = (code: string) => enumsList.find((e) => e.code === code);
  const byNode = summaryResult.ok ? summaryResult.value.byNode : [];

  // 트리 순서대로 노드를 편다 — 순번 · 급부 수 · 소속 세부보장 이름을 화면이 그대로 쓴다.
  const nodes: EditorNode[] = [];
  for (const node of nodesOf(tree)) {
    const key = encodeNodeKey(node.level, node.id);
    if (node.level === "coverage") {
      nodes.push({ key, level: node.level, id: node.id, name: node.name });
      continue;
    }
    if (node.level === "subCoverage") {
      const sub = tree.subCoverages.find((s) => s.id === node.id);
      nodes.push({ key, level: node.level, id: node.id, name: node.name, order: (sub?.order ?? 0) + 1, benefitCount: sub?.benefits.length ?? 0 });
      continue;
    }
    const parent = tree.subCoverages.find((s) => s.benefits.some((b) => b.id === node.id));
    const benefit = parent?.benefits.find((b) => b.id === node.id);
    nodes.push({ key, level: node.level, id: node.id, name: node.name, order: (benefit?.order ?? 0) + 1, parentName: parent?.name });
  }

  // 네 탭이 한 화면이므로 값 폼은 노드마다 미리 짓는다 (탭을 옮겨도 서버에 다시 안 간다).
  const formsByNode: Record<string, EditorForm[]> = {};
  const attachableByNode: Record<string, { code: string; label: string }[]> = {};
  await Promise.all(
    nodes.map(async (node) => {
      const owner = { level: node.level, id: node.id };
      const [forms, attachable] = await Promise.all([services.coverage.forms(owner), services.coverage.attachable(owner)]);
      formsByNode[node.key] = forms.ok
        ? forms.value.map((f) => ({
            code: f.def.code,
            label: f.def.label,
            alwaysExposed: f.def.alwaysExposed,
            model: buildForm(f.def, enumLookup, new Map(Object.entries(f.slots))),
          }))
        : [];
      attachableByNode[node.key] = attachable.ok ? attachable.value.map((d) => ({ code: d.code, label: d.label })) : [];
    }),
  );

  const usageCount = usagesOf(graph, { kind: "coverageNode", level: "coverage", id: tree.id }, { via: ["mount"] }).length;
  const attributeValueLabels = attributeKinds.flatMap((kind) => kind.values.map((value) => value.label));

  // 이름·부착이 바뀌면 초안을 새 진실로 다시 세운다 (EnumDetailPage 와 같은 패턴).
  const signature = nodes.map((n) => `${n.key}=${n.name}:${(formsByNode[n.key] ?? []).map((f) => f.code).join(",")}`).join("|");

  return (
    <div>
      <ErrorBanner message={sp.error} />
      <CoverageEditor
        key={signature}
        id={tree.id}
        initial={{ label: tree.name, description: tree.description, names: {}, values: {} }}
        nodes={nodes}
        byNode={byNode}
        formsByNode={formsByNode}
        attachableByNode={attachableByNode}
        usageCount={usageCount}
        documentId={tree.documentId}
        attributeValueLabels={attributeValueLabels}
        initialTab={sp.tab}
      />
    </div>
  );
}
