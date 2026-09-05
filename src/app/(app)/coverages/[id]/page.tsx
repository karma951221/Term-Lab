import Link from "next/link";
import type { ReactNode } from "react";

import { Confirm } from "@/app/_components/Confirm";
import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { ValueForm } from "@/app/_components/ValueForm";
import { previewOutcome } from "@/app/_lib/rejection";
import type { Coverage, CoverageNodeRef } from "@/domain/coverage";
import { buildForm } from "@/forms";
import { currentActor, getServices } from "@/lib/services";

import {
  addBenefitAction,
  addSubCoverageAction,
  attachAction,
  createSpecialDocumentAction,
  detachAction,
  moveBenefitAction,
  moveSubCoverageAction,
  removeBenefitAction,
  removeCoverageAction,
  removeSubCoverageAction,
  renameBenefitAction,
  renameCoverageAction,
  renameSubCoverageAction,
  setDescriptionAction,
  writeCoverageValuesAction,
} from "../actions";
import { decodeNodeKey, encodeNodeKey } from "../lib";

export const dynamic = "force-dynamic";

interface SearchParams {
  error?: string;
  node?: string;
  del?: string; // "coverage" | "sub:<id>" | "benefit:<id>"
  detach?: string; // discriminator code to detach from the selected node
}

function label(tree: Coverage, ref: CoverageNodeRef): string {
  if (ref.level === "coverage") return tree.name;
  for (const s of tree.subCoverages) {
    if (ref.level === "subCoverage" && s.id === ref.id) return s.name;
    for (const b of s.benefits) if (ref.level === "benefit" && b.id === ref.id) return b.name;
  }
  return "?";
}

export default async function CoverageDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const services = getServices();
  const tree = await services.coverage.get(id);
  if (!tree) {
    return (
      <div>
        <h1 className="ts-h1">담보</h1>
        <p className="ts-error-banner">찾을 수 없습니다.</p>
      </div>
    );
  }
  const actor = await currentActor();
  const selected: CoverageNodeRef = decodeNodeKey(sp.node) ?? { level: "coverage", id: tree.id };
  const enumsList = await services.catalog.listEnums();
  const enumLookup = (code: string) => enumsList.find((e) => e.code === code);

  const forms = await services.coverage.forms(selected);
  const attachable = await services.coverage.attachable(selected);
  const completenessResult = await services.coverage.completeness(tree.id);
  const missing = completenessResult.ok ? completenessResult.value : [];

  let detachNode: ReactNode = null;
  if (sp.detach) {
    const outcome = previewOutcome(await services.coverage.detach(actor, selected, sp.detach));
    detachNode =
      outcome.kind === "confirm" ? (
        <Confirm impact={outcome.impact} action={detachAction.bind(null, id, selected, sp.detach)} />
      ) : outcome.kind === "error" ? (
        <p className="ts-error-banner">{outcome.message}</p>
      ) : null;
  }

  let deleteNode: ReactNode = null;
  if (sp.del === "coverage") {
    const outcome = previewOutcome(await services.coverage.remove(actor, tree.id));
    deleteNode =
      outcome.kind === "confirm" ? (
        <Confirm impact={outcome.impact} action={removeCoverageAction.bind(null, tree.id)} />
      ) : outcome.kind === "error" ? (
        <p className="ts-error-banner">{outcome.message}</p>
      ) : null;
  } else if (sp.del?.startsWith("sub:")) {
    const subId = sp.del.slice(4);
    const outcome = previewOutcome(await services.coverage.removeSubCoverage(actor, subId));
    deleteNode =
      outcome.kind === "confirm" ? (
        <Confirm impact={outcome.impact} action={removeSubCoverageAction.bind(null, id, subId)} />
      ) : outcome.kind === "error" ? (
        <p className="ts-error-banner">{outcome.message}</p>
      ) : null;
  } else if (sp.del?.startsWith("benefit:")) {
    const benefitId = sp.del.slice(8);
    const outcome = previewOutcome(await services.coverage.removeBenefit(actor, benefitId));
    deleteNode =
      outcome.kind === "confirm" ? (
        <Confirm impact={outcome.impact} action={removeBenefitAction.bind(null, id, benefitId)} />
      ) : outcome.kind === "error" ? (
        <p className="ts-error-banner">{outcome.message}</p>
      ) : null;
  }

  return (
    <div>
      <h1 className="ts-h1">{tree.name}</h1>
      <ErrorBanner message={sp.error} />

      <div style={{ display: "flex", gap: 24 }}>
        <div style={{ flex: "0 0 260px" }}>
          <h2 className="ts-h2">트리</h2>
          <ul className="ts-tree">
            <li>
              <div className="ts-tree-row">
                <Link href={`?node=${encodeNodeKey("coverage", tree.id)}`} className={selected.level === "coverage" ? "ts-badge" : undefined}>
                  {tree.name}
                </Link>
              </div>
              <ul className="ts-tree">
                {tree.subCoverages.map((s, i) => (
                  <li key={s.id}>
                    <div className="ts-tree-row">
                      <Link href={`?node=${encodeNodeKey("subCoverage", s.id)}`} className={selected.level === "subCoverage" && selected.id === s.id ? "ts-badge" : undefined}>
                        {s.name}
                      </Link>
                      <form action={moveSubCoverageAction.bind(null, tree.id, s.id, -1)}>
                        <button type="submit" disabled={i === 0} title="위로">
                          ↑
                        </button>
                      </form>
                      <form action={moveSubCoverageAction.bind(null, tree.id, s.id, 1)}>
                        <button type="submit" disabled={i === tree.subCoverages.length - 1} title="아래로">
                          ↓
                        </button>
                      </form>
                      <Link href={`?del=sub:${s.id}`}>삭제</Link>
                    </div>
                    <ul className="ts-tree">
                      {s.benefits.map((b, j) => (
                        <li key={b.id}>
                          <div className="ts-tree-row">
                            <Link href={`?node=${encodeNodeKey("benefit", b.id)}`} className={selected.level === "benefit" && selected.id === b.id ? "ts-badge" : undefined}>
                              {b.name}
                            </Link>
                            <form action={moveBenefitAction.bind(null, tree.id, s.id, b.id, -1)}>
                              <button type="submit" disabled={j === 0} title="위로">
                                ↑
                              </button>
                            </form>
                            <form action={moveBenefitAction.bind(null, tree.id, s.id, b.id, 1)}>
                              <button type="submit" disabled={j === s.benefits.length - 1} title="아래로">
                                ↓
                              </button>
                            </form>
                            <Link href={`?del=benefit:${b.id}`}>삭제</Link>
                          </div>
                        </li>
                      ))}
                    </ul>
                    <form action={addBenefitAction.bind(null, tree.id, s.id)} style={{ display: "flex", gap: 4 }}>
                      <input type="text" name="name" placeholder="새 급부명" required />
                      <button type="submit">급부 추가</button>
                    </form>
                  </li>
                ))}
              </ul>
              <form action={addSubCoverageAction.bind(null, tree.id)} style={{ display: "flex", gap: 4 }}>
                <input type="text" name="name" placeholder="새 세부보장명" required />
                <button type="submit">세부보장 추가</button>
              </form>
            </li>
          </ul>

          {sp.del?.startsWith("sub:") || sp.del?.startsWith("benefit:") ? deleteNode : null}

          <h2 className="ts-h2">완결성 ({missing.length})</h2>
          <ul>
            {missing.map((m, i) => (
              <li key={i}>
                {m.ownerName} · {m.label}
              </li>
            ))}
          </ul>
          {missing.length === 0 && <p className="ts-ok">미입력 없음.</p>}

          <h2 className="ts-h2">담보약관 문면</h2>
          {tree.documentId ? (
            <Link href={`/documents/${tree.documentId}`}>문면 열기</Link>
          ) : (
            <form action={createSpecialDocumentAction.bind(null, tree.id)} style={{ display: "flex", gap: 4 }}>
              <input type="text" name="title" placeholder="문면 제목" defaultValue={`${tree.name} 특별약관`} />
              <button type="submit">문면 생성</button>
            </form>
          )}

          <h2 className="ts-h2">삭제</h2>
          {sp.del === "coverage" ? deleteNode : <Link href="?del=coverage">담보 삭제…</Link>}
        </div>

        <div style={{ flex: 1 }}>
          <h2 className="ts-h2">{label(tree, selected)} — 값</h2>

          <form action={renameCoverageAction.bind(null, tree.id)} className="ts-form" style={{ display: selected.level === "coverage" ? undefined : "none" }}>
            <label className="ts-field">
              <span>담보명</span>
              <input type="text" name="name" defaultValue={tree.name} required />
            </label>
            <div className="ts-form-actions">
              <button type="submit">이름 저장</button>
            </div>
          </form>
          {selected.level === "coverage" && (
            <form action={setDescriptionAction.bind(null, tree.id)} className="ts-form">
              <label className="ts-field">
                <span>설명</span>
                <textarea name="description" rows={2} defaultValue={tree.description} />
              </label>
              <div className="ts-form-actions">
                <button type="submit">저장</button>
              </div>
            </form>
          )}
          {selected.level === "subCoverage" && (
            <form action={renameSubCoverageAction.bind(null, tree.id, selected.id)} className="ts-form">
              <label className="ts-field">
                <span>세부보장명</span>
                <input type="text" name="name" defaultValue={label(tree, selected)} required />
              </label>
              <div className="ts-form-actions">
                <button type="submit">저장</button>
              </div>
            </form>
          )}
          {selected.level === "benefit" && (
            <form action={renameBenefitAction.bind(null, tree.id, selected.id)} className="ts-form">
              <label className="ts-field">
                <span>급부명</span>
                <input type="text" name="name" defaultValue={label(tree, selected)} required />
              </label>
              <div className="ts-form-actions">
                <button type="submit">저장</button>
              </div>
            </form>
          )}

          {forms.ok &&
            forms.value.map((f) => (
              <div key={f.def.code}>
                <ValueForm
                  model={buildForm(f.def, enumLookup, new Map(Object.entries(f.slots)))}
                  action={writeCoverageValuesAction.bind(null, selected)}
                />
                {!f.def.alwaysExposed && (
                  <p>
                    {sp.detach === f.def.code ? (
                      detachNode
                    ) : (
                      <Link href={`?node=${encodeNodeKey(selected.level, selected.id)}&detach=${f.def.code}`}>부착 해제…</Link>
                    )}
                  </p>
                )}
              </div>
            ))}

          {attachable.ok && attachable.value.length > 0 && (
            <div className="ts-panel">
              <h2 className="ts-form-title">부착 가능</h2>
              {attachable.value.map((d) => (
                <form key={d.code} action={attachAction.bind(null, tree.id, selected, d.code)} style={{ display: "inline-block", marginRight: 8 }}>
                  <button type="submit">+ {d.label}</button>
                </form>
              ))}
            </div>
          )}
        </div>
      </div>

      <p style={{ marginTop: 24 }}>
        <Link href="/coverages">← 목록으로</Link>
      </p>
    </div>
  );
}
