import Link from "next/link";

import { IssueList } from "@/app/_components/IssueList";
import { RenderedDoc } from "@/app/_components/RenderedDoc";
import { ValueForm } from "@/app/_components/ValueForm";
import { isValued } from "@/domain/catalog";
import { buildForm } from "@/forms";
import { currentActor, getServices } from "@/lib/services";

import { writeSnapshotValuesAction } from "../../../actions";

export const dynamic = "force-dynamic";

export default async function ProductCoverageDetailPage({ params }: { params: Promise<{ id: string; pcId: string }> }) {
  const { id, pcId } = await params;
  const services = getServices();
  await currentActor();

  const snap = await services.product.getSnapshot(pcId);
  if (!snap.ok) {
    return (
      <div>
        <h1 className="ts-h1">상품담보</h1>
        <p className="ts-error-banner">찾을 수 없습니다.</p>
      </div>
    );
  }
  const pc = snap.value;
  const [values, defs, enumsList, preview] = await Promise.all([
    services.product.getSnapshotValues(pcId),
    services.catalog.list(),
    services.catalog.listEnums(),
    services.assembly.previewSpecial(id, pcId),
  ]);
  const enumLookup = (code: string) => enumsList.find((e) => e.code === code);
  const alwaysExposed = defs.filter(isValued).filter((d) => d.alwaysExposed);

  return (
    <div>
      <h1 className="ts-h1">{pc.name}</h1>
      <p className="ts-muted">담보: {pc.coverageName}</p>

      <h2 className="ts-h2">담보 레벨 값</h2>
      {alwaysExposed
        .filter((d) => d.level === "coverage")
        .map((d) => (
          <ValueForm key={d.code} model={buildForm(d, enumLookup, values.get(pc.id) ?? new Map())} action={writeSnapshotValuesAction.bind(null, pcId, { kind: "productCoverage", id: pc.id })} />
        ))}

      {pc.subCoverages.map((s) => (
        <div key={s.id}>
          <h2 className="ts-h2">세부보장 — {s.name}</h2>
          {alwaysExposed
            .filter((d) => d.level === "subCoverage")
            .map((d) => (
              <ValueForm key={d.code} model={buildForm(d, enumLookup, values.get(s.id) ?? new Map())} action={writeSnapshotValuesAction.bind(null, pcId, { kind: "productSubCoverage", id: s.id })} />
            ))}
          {s.benefits.map((b) => (
            <div key={b.id} style={{ paddingLeft: 16 }}>
              <h3>급부 — {b.name}</h3>
              {alwaysExposed
                .filter((d) => d.level === "benefit")
                .map((d) => (
                  <ValueForm key={d.code} model={buildForm(d, enumLookup, values.get(b.id) ?? new Map())} action={writeSnapshotValuesAction.bind(null, pcId, { kind: "productBenefit", id: b.id })} />
                ))}
            </div>
          ))}
        </div>
      ))}

      <h2 className="ts-h2">상품담보 미리보기</h2>
      {preview.ok ? (
        <>
          {!preview.value.complete && <p className="ts-error-banner">완성본 아님 — 아래 오류를 확인하세요.</p>}
          <IssueList issues={preview.value.issues} />
          <RenderedDoc doc={preview.value.doc} />
        </>
      ) : (
        <p className="ts-error-banner">{preview.rejection.reason}</p>
      )}

      <p style={{ marginTop: 24 }}>
        <Link href={`/products/${id}`}>← 상품으로</Link>
      </p>
    </div>
  );
}
