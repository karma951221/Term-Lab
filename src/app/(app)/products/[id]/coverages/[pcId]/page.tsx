import Link from "next/link";
import type { CSSProperties } from "react";

import { IssueList } from "@/app/_components/IssueList";
import { RenderedDoc } from "@/app/_components/RenderedDoc";
import { ValueForm } from "@/app/_components/ValueForm";
import { isValued } from "@/domain/catalog";
import { buildForm, type SnapshotContext } from "@/forms";
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
  const [values, defs, enumsList, preview, completeness, revertable, masterValues] = await Promise.all([
    services.product.getSnapshotValues(pcId),
    services.catalog.list(),
    services.catalog.listEnums(),
    services.assembly.previewSpecial(id, pcId),
    services.product.coverageCompleteness(pcId),
    services.product.snapshotDrift(pcId),
    services.product.getSnapshotMasterValues(pcId),
  ]);
  const enumLookup = (code: string) => enumsList.find((e) => e.code === code);
  const alwaysExposed = defs.filter(isValued).filter((d) => d.alwaysExposed);
  /** owner 하나의 스냅샷 문맥 — 마스터 값을 못 얻으면(빈 맵) undefined 로 빠져 direct 로 보인다. */
  const snapshotContextOf = (ownerId: string, masterLabel: string): SnapshotContext | undefined => {
    const own = masterValues.get(ownerId);
    return own && own.size > 0 ? { masterLabel, masterValues: own } : undefined;
  };

  // 헤더 한 줄이 이 화면에 남은 일을 말한다 (디자인원칙 §9.2 · §1.2).
  const entered = completeness.total - completeness.missing.length;
  const percent = completeness.total === 0 ? 100 : Math.round((entered / completeness.total) * 100);
  /** 값 자리 하나로 가는 앵커 — 미입력 목록의 「고치러 가기」. */
  const slotAnchor = (ownerId: string, path: string) => `#own-${ownerId}-def-${path.split(".")[0]}`;

  return (
    <div>
      <div className="ts-page-head">
        <h1 className="ts-h1">{pc.name}</h1>
        <span className="ts-count">
          완결성 — 값 자리 <b>{completeness.total}</b> 중 <b>{entered}</b> 입력
        </span>
        <span className="ts-progress" style={{ "--value": percent } as CSSProperties} aria-hidden="true" />
        <span className="ts-count">
          되돌릴 수 있는 필드 <b>{revertable}</b>
        </span>
        <Link href={`/products/${id}`} style={{ marginLeft: "auto" }}>
          ← 상품으로
        </Link>
      </div>
      <p className="ts-muted">
        담보 마스터: <Link href={`/coverages/${pc.coverageId}`}>{pc.coverageName}</Link>
      </p>

      {completeness.missing.length > 0 && (
        <section className="ts-section">
          <h2 className="ts-section-title">
            미입력
            <span className="ts-count">
              <b>{completeness.missing.length}</b> / 값 자리 {completeness.total}
            </span>
          </h2>
          <ul>
            {completeness.missing.map((m, i) => (
              <li key={i}>
                {m.ownerName} › {m.path} · <Link href={slotAnchor(m.owner.id, m.path)}>고치러 가기</Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="ts-section">
        <h2 className="ts-section-title">담보 레벨 값</h2>
        {alwaysExposed
          .filter((d) => d.level === "coverage")
          .map((d) => (
            <div key={d.code} id={`own-${pc.id}-def-${d.code}`}>
              <ValueForm
                model={buildForm(d, enumLookup, values.get(pc.id) ?? new Map(), snapshotContextOf(pc.id, `${pc.coverageName} (마스터)`))}
                action={writeSnapshotValuesAction.bind(null, pcId, { kind: "productCoverage", id: pc.id })}
              />
            </div>
          ))}
      </section>

      {pc.subCoverages.map((s) => (
        <section key={s.id} className="ts-section">
          <h2 className="ts-section-title">세부보장 — {s.name}</h2>
          {alwaysExposed
            .filter((d) => d.level === "subCoverage")
            .map((d) => (
              <div key={d.code} id={`own-${s.id}-def-${d.code}`}>
                <ValueForm
                  model={buildForm(d, enumLookup, values.get(s.id) ?? new Map(), snapshotContextOf(s.id, `${s.name} (마스터)`))}
                  action={writeSnapshotValuesAction.bind(null, pcId, { kind: "productSubCoverage", id: s.id })}
                />
              </div>
            ))}
          {s.benefits.map((b) => (
            <div key={b.id} style={{ paddingLeft: 16 }}>
              <h3 className="ts-form-title">급부 — {b.name}</h3>
              {alwaysExposed
                .filter((d) => d.level === "benefit")
                .map((d) => (
                  <div key={d.code} id={`own-${b.id}-def-${d.code}`}>
                    <ValueForm
                      model={buildForm(d, enumLookup, values.get(b.id) ?? new Map(), snapshotContextOf(b.id, `${b.name} (마스터)`))}
                      action={writeSnapshotValuesAction.bind(null, pcId, { kind: "productBenefit", id: b.id })}
                    />
                  </div>
                ))}
            </div>
          ))}
        </section>
      ))}

      <section className="ts-section">
        <h2 className="ts-section-title">
          상품담보 미리보기
          {preview.ok && (
            <span className="ts-count">
              오류 <b>{preview.value.issues.length}</b> / 조 {preview.value.doc.children.flatMap((n) => (n.kind === "section" ? n.children : [n])).filter((n) => n.kind === "article").length}
            </span>
          )}
        </h2>
        {preview.ok ? (
          <>
            {!preview.value.complete && <p className="ts-error-banner">완성본 아님 — 아래 오류를 확인하세요.</p>}
            <IssueList issues={preview.value.issues} />
            <RenderedDoc doc={preview.value.doc} />
          </>
        ) : (
          <p className="ts-error-banner">{preview.rejection.reason}</p>
        )}
      </section>

      <p style={{ marginTop: 24 }}>
        <Link href={`/products/${id}`}>← 상품으로</Link>
      </p>
    </div>
  );
}
