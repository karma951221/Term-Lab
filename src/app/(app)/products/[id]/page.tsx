import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import { Confirm } from "@/app/_components/Confirm";
import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { IconButton, IconCheck, IconClose, IconLink, IconPlus, IconRevert, IconTrash } from "@/app/_components/icons";
import { IssueList } from "@/app/_components/IssueList";
import { ValueForm } from "@/app/_components/ValueForm";
import { previewOutcome } from "@/app/_lib/rejection";
import { articleRefLabel } from "@/domain/document";
import { defaultCoverageName, planOptionLabel } from "@/domain/product";
import { buildForm } from "@/forms";
import { currentActor, getServices } from "@/lib/services";

import { OptionOverrideForm, type OverrideTarget } from "./_components/OptionOverrideForm";
import {
  attachPlanAction,
  createGroupAction,
  deleteGroupAction,
  deleteProductAction,
  designateBaseContractAction,
  detachPlanAction,
  mountAction,
  placeInGroupAction,
  regenerateNameAction,
  registerPlanAction,
  releaseBaseContractAction,
  removeFromGroupAction,
  removeOptionOverrideAction,
  removePlanAction,
  removePlanOptionAction,
  renameGroupAction,
  renameProductAction,
  renameProductCoverageAction,
  setOptionOverrideAction,
  setProductGeneralDocumentAction,
  unmountAction,
  writeProductValuesAction,
  addPlanOptionAction,
} from "../actions";

export const dynamic = "force-dynamic";

/** 좁은 섹션 두 개를 한 줄에 — L2 「한눈에」(디자인원칙 §2 L2 · 리뷰 #52). */
function Pair({ children }: { children: ReactNode }) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "0 32px", alignItems: "start" }}>{children}</div>;
}

export default async function ProductDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; confirm?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const services = getServices();
  const product = await services.product.getProduct(id);
  if (!product) {
    return (
      <div>
        <h1 className="ts-h1">상품</h1>
        <p className="ts-error-banner">찾을 수 없습니다.</p>
      </div>
    );
  }
  const actor = await currentActor();
  const [generals, defs, enumsList, planOptions, plans, coverages, attributeKinds, productCoverages, baseContractIds, groups, unplaced, overrides, completeness, namingTemplate, clauses] =
    await Promise.all([
      services.document.list("general"),
      services.catalog.list(),
      services.catalog.listEnums(),
      services.product.listPlanOptions(id),
      services.product.listPlans(id),
      services.coverage.list(),
      services.product.listAttributeKinds(),
      services.product.listProductCoverages(id),
      services.product.listBaseContractIds(id),
      services.product.listGroups(id),
      services.product.listUnplaced(id),
      services.product.listOptionOverrides({ kind: "product", id }),
      services.product.productCompleteness(id),
      services.product.getNamingTemplate(),
      services.clause.list(),
    ]);
  const productValues = await services.product.getProductValues(id);
  const enumLookup = (code: string) => enumsList.find((e) => e.code === code);
  const productDefs = defs.filter((d) => (d.kind === "scalar" || d.kind === "struct") && d.level === "product" && d.alwaysExposed);
  const renderedDefs = new Set(productDefs.map((d) => d.code));
  const planTypeDefs = defs.filter((d) => d.kind === "struct" && d.level === "plan");
  const baseCheck = await services.product.checkBaseContract(id);
  const baseContractSet = new Set(baseContractIds);
  const coverageName = new Map(coverages.map((c) => [c.id, c.name]));
  const coverageSections = [
    { key: "base", title: "기본계약 담보", items: productCoverages.filter((coverage) => baseContractSet.has(coverage.id)) },
    { key: "special", title: "특약 담보", items: productCoverages.filter((coverage) => !baseContractSet.has(coverage.id)) },
  ] as const;

  // 완결성은 채운 것을 센다 (디자인원칙 §9.2) — 분모는 노출된 값 자리 수.
  const entered = completeness.total - completeness.missing.length;
  const percent = completeness.total === 0 ? 100 : Math.round((entered / completeness.total) * 100);

  /** 작명 규칙이 지금 지어 줄 이름 — 누르기 전에 결과를 보여준다 (리뷰 #27 · §9.3). */
  const wouldBeName = (pc: (typeof productCoverages)[number]) => defaultCoverageName(coverageName.get(pc.coverageId) ?? "", pc.attributes, attributeKinds, namingTemplate);

  // 보통약관 문면의 공용조항 참조 자리(block · inline 둘 다 노드 id 로 오버라이드된다) = 고를 수 있는 자리 (리뷰 #7).
  const overrideTargets: OverrideTarget[] = [];
  if (product.generalDocumentId) {
    const gid = product.generalDocumentId;
    const [refs, numbering] = await Promise.all([services.document.refs(gid), services.document.numbering(gid)]);
    const clauseByCode = new Map(clauses.map((c) => [c.code, c]));
    for (const ref of refs) {
      if (ref.kind !== "clause") continue;
      const nodeId = ref.at.nodePath?.at(-1);
      if (!nodeId) continue;
      const clause = clauseByCode.get(ref.clauseCode);
      const n = ref.at.articleId ? numbering.get(ref.at.articleId) : undefined;
      const where = n && ref.at.articleTitle ? articleRefLabel(n.n, ref.at.articleTitle) : (ref.at.articleTitle ?? "보통약관");
      overrideTargets.push({
        nodeId,
        clauseCode: ref.clauseCode,
        label: `${where} › 공용조항 ${clause?.label ?? ref.clauseCode}(${ref.clauseCode})`,
        options: (clause?.options ?? []).map((o) => ({ code: o.code, label: o.label, values: o.values.map((v) => ({ code: v.code, label: v.label })) })),
      });
    }
  }
  const targetByNode = new Map(overrideTargets.map((t) => [t.nodeId, t]));
  /** 저장된 오버라이드를 사람 말로 — 「제4조(…) › 공용조항 …: 옵션명 = 선택지명」. */
  function describeOverride(nodeId: string, clauseCode: string, options: Record<string, string>): { where: string; choices: string } {
    const target = targetByNode.get(nodeId);
    const clause = clauses.find((c) => c.code === clauseCode);
    const choices = Object.entries(options)
      .map(([optionCode, valueCode]) => {
        const o = clause?.options.find((x) => x.code === optionCode);
        const v = o?.values.find((x) => x.code === valueCode);
        return `${o?.label ?? optionCode} = ${v?.label ?? valueCode}`;
      })
      .join(" · ");
    return { where: target?.label ?? `공용조항 ${clause?.label ?? clauseCode}(${clauseCode})`, choices: choices || "선택 없음" };
  }

  let confirmNode: ReactNode = null;
  const c = sp.confirm;
  if (c === "product") {
    const outcome = previewOutcome(await services.product.deleteProduct(actor, id));
    confirmNode =
      outcome.kind === "confirm" ? (
        <Confirm impact={outcome.impact} action={deleteProductAction.bind(null, id)} targetLabel={`상품 ${product.name}`} actionLabel={`${product.name} 삭제`} />
      ) : outcome.kind === "error" ? (
        <p className="ts-error-banner">{outcome.message}</p>
      ) : null;
  } else if (c?.startsWith("pc:")) {
    const pcId = c.slice(3);
    const pc = productCoverages.find((p) => p.id === pcId);
    const outcome = previewOutcome(await services.product.unmount(actor, pcId));
    confirmNode =
      outcome.kind === "confirm" ? (
        <Confirm impact={outcome.impact} action={unmountAction.bind(null, id, pcId)} targetLabel={`상품담보 ${pc?.name ?? pcId}`} actionLabel={`${pc?.name ?? "상품담보"} 탑재 해제`} />
      ) : outcome.kind === "error" ? (
        <p className="ts-error-banner">{outcome.message}</p>
      ) : null;
  } else if (c?.startsWith("planOption:")) {
    const optionId = c.slice(11);
    const option = planOptions.find((o) => o.id === optionId);
    const outcome = previewOutcome(await services.product.removePlanOption(actor, optionId));
    confirmNode =
      outcome.kind === "confirm" ? (
        <Confirm
          impact={outcome.impact}
          action={removePlanOptionAction.bind(null, id, optionId)}
          targetLabel={`세목 선택지 ${option ? planOptionLabel(option) : optionId}`}
          actionLabel={`${option ? planOptionLabel(option) : "선택지"} 삭제`}
        />
      ) : outcome.kind === "error" ? (
        <p className="ts-error-banner">{outcome.message}</p>
      ) : null;
  } else if (c?.startsWith("plan:")) {
    const planId = c.slice(5);
    const plan = plans.find((p) => p.id === planId);
    const planName = plan ? plan.options.map(planOptionLabel).join(" · ") : planId;
    const outcome = previewOutcome(await services.product.removePlan(actor, planId));
    confirmNode =
      outcome.kind === "confirm" ? (
        <Confirm impact={outcome.impact} action={removePlanAction.bind(null, id, planId)} targetLabel={`상품세목 ${planName}`} actionLabel={`${planName} 삭제`} />
      ) : outcome.kind === "error" ? (
        <p className="ts-error-banner">{outcome.message}</p>
      ) : null;
  } else if (c?.startsWith("detach:")) {
    const [, pcId, planId] = c.split(":");
    const pc = productCoverages.find((p) => p.id === pcId);
    const outcome = previewOutcome(await services.product.detachPlan(actor, pcId, planId));
    confirmNode =
      outcome.kind === "confirm" ? (
        <Confirm impact={outcome.impact} action={detachPlanAction.bind(null, id, pcId, planId)} targetLabel={`${pc?.name ?? pcId} 의 세목 부착`} actionLabel="세목 부착 해제" />
      ) : outcome.kind === "error" ? (
        <p className="ts-error-banner">{outcome.message}</p>
      ) : null;
  } else if (c?.startsWith("group:")) {
    // 그룹 삭제도 다른 파괴 조작과 같은 확인 경로를 탄다 (리뷰 #34). 값은 안 사라지고 소속만 풀린다 —
    // 잃는 것을 계산된 대로만 적는다 (디자인원칙 §9.5).
    const groupId = c.slice(6);
    const group = groups.find((g) => g.id === groupId);
    confirmNode = group ? (
      <Confirm
        impact={{ valueRowsLost: 0, cascade: group.members.map((m) => `상품담보 ${m.name} 의 배치 (미배치로 돌아간다)`), brokenRefs: [] }}
        action={deleteGroupAction.bind(null, id, groupId)}
        targetLabel={`특약 그룹 ${group.title}`}
        actionLabel={`${group.title} 삭제 · 상품담보 ${group.members.length}건 미배치로`}
      />
    ) : (
      <p className="ts-error-banner">그룹을 찾을 수 없습니다.</p>
    );
  }

  return (
    <div>
      <div className="ts-page-head">
        <h1 className="ts-h1">{product.name}</h1>
        <span className="ts-count">
          완결성 — 값 자리 <b>{completeness.total}</b> 중 <b>{entered}</b> 입력
        </span>
        <Link href={`/products/${id}/preview`} className="primary" style={{ marginLeft: "auto" }}>
          조립 미리보기 →
        </Link>
      </div>
      <ErrorBanner message={sp.error} />

      <Pair>
        <section className="ts-section">
          <h2 className="ts-section-title">기본 정보</h2>
          <form action={renameProductAction.bind(null, id)} className="ts-form">
            <label className="ts-field">
              <span>상품명</span>
              <input type="text" name="name" defaultValue={product.name} required />
            </label>
            <div className="ts-form-actions">
              <button type="submit">상품명 저장</button>
            </div>
          </form>
          <form action={setProductGeneralDocumentAction.bind(null, id)} className="ts-form">
            <label className="ts-field">
              <span>보통약관 템플릿</span>
              <select name="generalDocumentId" defaultValue={product.generalDocumentId ?? ""}>
                <option value="">— 미지정 —</option>
                {generals.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                  </option>
                ))}
              </select>
            </label>
            <div className="ts-form-actions">
              <button type="submit">템플릿 저장</button>
              <Link href="/attributes">담보속성 카탈로그 →</Link>
            </div>
          </form>
        </section>

        {productDefs.length > 0 && (
          <section className="ts-section">
            <h2 className="ts-section-title">상품 레벨 값</h2>
            {productDefs.map((d) => (
              <div key={d.code} id={`def-${d.code}`}>
                <ValueForm model={buildForm(d, enumLookup, productValues)} action={writeProductValuesAction.bind(null, id)} />
              </div>
            ))}
          </section>
        )}
      </Pair>

      <section className="ts-section">
        <h2 className="ts-section-title">
          세목
          <span className="ts-count">
            선택지 {planOptions.length} · 유효 조합 {plans.length}
          </span>
        </h2>
        <Pair>
          <div>
            <table className="ts-table">
              <thead>
                <tr>
                  <th className="col-flex">선택지</th>
                  <th className="col-code">세목유형</th>
                  <th className="col-act">조작</th>
                </tr>
              </thead>
              <tbody>
                {planOptions.map((o) => (
                  <tr key={o.id}>
                    <td className="col-flex">{planOptionLabel(o)}</td>
                    <td className="col-code">{planTypeDefs.find((d) => d.code === o.planTypeCode)?.label ?? o.planTypeCode}</td>
                    <td className="col-act">
                      <Link href={`?confirm=planOption:${o.id}`} className="ts-iconbtn danger" title={`선택지 삭제 · ${planOptionLabel(o)}`} aria-label={`선택지 삭제 · ${planOptionLabel(o)}`}>
                        <IconTrash />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {c?.startsWith("planOption:") && confirmNode}
            <form action={addPlanOptionAction.bind(null, id)} className="ts-form">
              <h3 className="ts-form-title">선택지 추가</h3>
              <label className="ts-field">
                <span>축</span>
                <select name="axis">
                  <option value="type">종</option>
                  <option value="form">형</option>
                </select>
              </label>
              <label className="ts-field">
                <span>번호</span>
                <input type="number" name="number" min={1} required />
              </label>
              <label className="ts-field">
                <span>이름</span>
                <input type="text" name="name" required />
              </label>
              <label className="ts-field">
                <span>세목유형</span>
                <select name="planTypeCode" required defaultValue={planTypeDefs[0]?.code ?? ""}>
                  {planTypeDefs.length === 0 && <option value="">— 세목 레벨 폼 구분자가 없다 —</option>}
                  {planTypeDefs.map((d) => (
                    <option key={d.code} value={d.code}>
                      {d.label} ({d.code})
                    </option>
                  ))}
                </select>
              </label>
              <div className="ts-form-actions">
                <button type="submit">선택지 추가</button>
              </div>
            </form>
          </div>

          <div>
            <table className="ts-table">
              <thead>
                <tr>
                  <th className="col-flex">상품세목 (유효 조합)</th>
                  <th className="col-act">조작</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.id}>
                    <td className="col-flex">{p.options.map(planOptionLabel).join(" · ")}</td>
                    <td className="col-act">
                      <Link
                        href={`?confirm=plan:${p.id}`}
                        className="ts-iconbtn danger"
                        title={`상품세목 삭제 · ${p.options.map(planOptionLabel).join(" · ")}`}
                        aria-label={`상품세목 삭제 · ${p.options.map(planOptionLabel).join(" · ")}`}
                      >
                        <IconTrash />
                      </Link>
                    </td>
                  </tr>
                ))}
                {plans.length === 0 && (
                  <tr>
                    <td className="col-flex ts-muted" colSpan={2}>
                      등록된 조합이 없다. 아래에서 선택지를 골라 등록한다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {c?.startsWith("plan:") && confirmNode}
            <form action={registerPlanAction.bind(null, id)} className="ts-form">
              <h3 className="ts-form-title">조합 등록</h3>
              <div className="ts-form-checks">
                {planOptions.map((o) => (
                  <label key={o.id} className="ts-form-check">
                    <input type="checkbox" name="optionIds" value={o.id} /> {planOptionLabel(o)}
                  </label>
                ))}
              </div>
              <div className="ts-form-actions">
                <button type="submit">조합 등록</button>
              </div>
            </form>
          </div>
        </Pair>
      </section>

      <section className="ts-section">
        <h2 className="ts-section-title">
          탑재 (상품담보) <span className="ts-count">{productCoverages.length}건</span>
        </h2>
        {coverageSections.map((section) => (
          <div key={section.key}>
            <h3 className="ts-form-title">
              {section.title} <span className="ts-count">{section.items.length}건</span>
            </h3>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)", gap: "0 32px", alignItems: "start" }}>
            <table className="ts-table">
              <thead>
                <tr>
                  <th className="col-flex">상품담보명</th>
                  <th className="col-fixed-md">담보</th>
                  <th className="col-fixed-md">세목 부착</th>
                  <th className="col-act">조작</th>
                </tr>
              </thead>
              <tbody>
                {section.items.map((pc) => {
                  const suggested = wouldBeName(pc);
                  return (
                    <tr key={pc.id}>
                      <td className="col-flex">
                        <form action={renameProductCoverageAction.bind(null, id, pc.id)} style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                          <input type="text" name="name" defaultValue={pc.name} style={{ width: 200 }} />
                          <IconButton type="submit" label={`이름 저장 · ${pc.name}`} icon={<IconCheck />} />
                        </form>{" "}
                        <Link href={`/products/${id}/coverages/${pc.id}`} title={`상품담보 값 열기 · ${pc.name}`}>
                          값 →
                        </Link>
                      </td>
                      <td className="col-fixed-md">
                        <Link href={`/coverages/${pc.coverageId}`} title={`담보 마스터 열기 · ${coverageName.get(pc.coverageId) ?? "담보"}`}>
                          {coverageName.get(pc.coverageId) ?? "(삭제된 담보)"}
                        </Link>
                      </td>
                      <td className="col-fixed-md">
                        <form action={attachPlanAction.bind(null, id, pc.id)} style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                          <select name="planId" style={{ maxWidth: 150 }}>
                            {plans.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.options.map(planOptionLabel).join(",")}
                              </option>
                            ))}
                          </select>
                          <IconButton type="submit" label={`세목 부착 · ${pc.name}`} icon={<IconPlus />} disabled={plans.length === 0} />
                        </form>
                      </td>
                      <td className="col-act">
                        <span style={{ display: "inline-flex", gap: 2, alignItems: "center" }}>
                          {suggested !== pc.name && suggested !== "" && <span className="ts-muted">작명: {suggested}</span>}
                          <form action={regenerateNameAction.bind(null, id, pc.id)} style={{ display: "inline" }}>
                            <IconButton type="submit" label={`작명 규칙으로 다시 짓기 · ${pc.name} → ${suggested || "(빈 이름)"}`} icon={<IconRevert />} />
                          </form>
                          <Link href={`?confirm=pc:${pc.id}`} className="ts-iconbtn danger" title={`탑재 해제 · ${pc.name}`} aria-label={`탑재 해제 · ${pc.name}`}>
                            <IconTrash />
                          </Link>
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {section.items.length === 0 && (
                  <tr>
                    <td className="col-flex ts-muted" colSpan={4}>
                      아직 {section.title}가 없다. 아래에서 담보를 골라 탑재한다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            <form action={mountAction.bind(null, id)} className="ts-form" style={{ borderTop: 0, marginTop: 0 }}>
              <input type="hidden" name="section" value={section.key} />
              <>
                <label className="ts-field">
                  <span>담보</span>
                  <select name="coverageId" required>
                    {coverages.map((cov) => (
                      <option key={cov.id} value={cov.id}>
                        {cov.name}
                      </option>
                    ))}
                  </select>
                </label>
                {attributeKinds.map((k) => (
                  <label key={k.code} className="ts-field">
                    <span>{k.label}</span>
                    <select name={`attr:${k.code}`} defaultValue="">
                      <option value="">—</option>
                      {k.values.map((v) => (
                        <option key={v.code} value={v.code}>
                          {v.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </>
              <div className="ts-form-actions">
                <button type="submit" className="primary">
                  {section.title}에 탑재
                </button>
              </div>
            </form>
            </div>
          </div>
        ))}
        {(c?.startsWith("pc:") || c?.startsWith("detach:")) && confirmNode}
      </section>

      <Pair>
        <section className="ts-section">
          <h2 className="ts-section-title">기본계약</h2>
          {baseCheck.ok ? (
            <ul>
              {baseCheck.value.map((chk) => (
                <li key={chk.productCoverageId}>
                  {productCoverages.find((p) => p.id === chk.productCoverageId)?.name ?? chk.productCoverageId}{" "}
                  <form action={releaseBaseContractAction.bind(null, id, chk.productCoverageId)} style={{ display: "inline" }}>
                    <IconButton
                      type="submit"
                      danger
                      label={`기본계약 해제 · ${productCoverages.find((p) => p.id === chk.productCoverageId)?.name ?? "상품담보"}`}
                      icon={<IconLink />}
                    />
                  </form>
                  <IssueList issues={chk.issues} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="ts-muted">{baseCheck.rejection.reason === "invalid" ? baseCheck.rejection.issues[0]?.message : "기본계약 미지정."}</p>
          )}
          <form action={designateBaseContractAction.bind(null, id)} className="ts-form">
            <label className="ts-field">
              <span>기본계약으로 지정</span>
              <select name="productCoverageId" required>
                {productCoverages.map((pc) => (
                  <option key={pc.id} value={pc.id}>
                    {pc.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="ts-form-actions">
              <button type="submit">기본계약 지정</button>
            </div>
          </form>
        </section>

        <section className="ts-section">
          <h2 className="ts-section-title">
            특약 그룹 <span className="ts-count">{groups.length}개</span>
          </h2>
          {groups.map((g) => (
            <div key={g.id} className="ts-panel">
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <form action={renameGroupAction.bind(null, id, g.id)} style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                  <input type="text" name="title" defaultValue={g.title} />
                  <IconButton type="submit" label={`그룹 이름 저장 · ${g.title}`} icon={<IconCheck />} />
                </form>
                <Link href={`?confirm=group:${g.id}`} className="ts-iconbtn danger" title={`그룹 삭제 · ${g.title} (상품담보 ${g.members.length}건 미배치로)`} aria-label={`그룹 삭제 · ${g.title}`}>
                  <IconTrash />
                </Link>
              </div>
              {c === `group:${g.id}` && confirmNode}
              <ul>
                {g.members.map((m) => (
                  <li key={m.id}>
                    {m.name}{" "}
                    <form action={removeFromGroupAction.bind(null, id, m.id)} style={{ display: "inline" }}>
                      <IconButton type="submit" danger label={`배치 해제 · ${m.name} 를 ${g.title} 에서`} icon={<IconClose />} />
                    </form>
                  </li>
                ))}
                {g.members.length === 0 && <li className="ts-muted">배치된 상품담보 없음</li>}
              </ul>
              <form action={placeInGroupAction.bind(null, id, g.id)} style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <select name="productCoverageId">
                  {unplaced.map((pc) => (
                    <option key={pc.id} value={pc.id}>
                      {pc.name}
                    </option>
                  ))}
                </select>
                <IconButton type="submit" label={`배치 · ${g.title} 에`} icon={<IconPlus />} disabled={unplaced.length === 0} />
              </form>
            </div>
          ))}
          <form action={createGroupAction.bind(null, id)} className="ts-form">
            <label className="ts-field">
              <span>새 그룹 제목</span>
              <input type="text" name="title" required />
            </label>
            <div className="ts-form-actions">
              <button type="submit">그룹 추가</button>
            </div>
          </form>
          <p className="ts-muted">미배치 상품담보: {unplaced.map((p) => p.name).join(", ") || "없음"}</p>
        </section>
      </Pair>

      <section className="ts-section">
        <h2 className="ts-section-title">
          옵션 오버라이드 <span className="ts-count">{overrides.length}건</span>
        </h2>
        <Pair>
          <div>
            <table className="ts-table">
              <thead>
                <tr>
                  <th className="col-flex">자리</th>
                  <th className="col-fixed-md">선택</th>
                  <th className="col-act">조작</th>
                </tr>
              </thead>
              <tbody>
                {overrides.map((o) => {
                  const d = describeOverride(o.nodeId, o.clauseCode, o.options);
                  return (
                    <tr key={o.id}>
                      <td className="col-flex">{d.where}</td>
                      <td className="col-fixed-md">{d.choices}</td>
                      <td className="col-act">
                        <form action={removeOptionOverrideAction.bind(null, id, { kind: "product", id }, o.nodeId, o.clauseCode)} style={{ display: "inline" }}>
                          <IconButton type="submit" danger label={`오버라이드 제거 · ${d.where}`} icon={<IconTrash />} />
                        </form>
                      </td>
                    </tr>
                  );
                })}
                {overrides.length === 0 && (
                  <tr>
                    <td className="col-flex ts-muted" colSpan={3}>
                      오버라이드 없음 — 보통약관의 공용조항은 문면이 정한 선택지를 그대로 쓴다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {overrideTargets.length > 0 ? (
            <OptionOverrideForm targets={overrideTargets} action={setOptionOverrideAction.bind(null, id, { kind: "product", id })} />
          ) : (
            <p className="ts-muted">{product.generalDocumentId ? "보통약관 문면에 공용조항 참조 자리가 없다." : "보통약관 템플릿을 먼저 고른다."}</p>
          )}
        </Pair>
      </section>

      <Pair>
        <section className="ts-section" id="completeness">
          <h2 className="ts-section-title">
            완결성
            <span className="ts-count">
              값 자리 <b>{completeness.total}</b> 중 <b>{entered}</b> 입력
            </span>
          </h2>
          <p>
            <span className="ts-progress" style={{ "--value": percent } as CSSProperties} aria-hidden="true" />
          </p>
          {completeness.missing.length === 0 ? (
            <p className="ts-ok">{completeness.total === 0 ? "상품 레벨에 노출된 값 자리가 없다." : "상품 레벨 값이 모두 입력됐다."}</p>
          ) : (
            <ul>
              {completeness.missing.map((m, i) => (
                <li key={i}>
                  {m.ownerName} › {m.path}
                  {renderedDefs.has(m.path.split(".")[0]) && (
                    <>
                      {" · "}
                      <Link href={`#def-${m.path.split(".")[0]}`}>고치러 가기</Link>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="ts-section">
          <h2 className="ts-section-title">위험 구역</h2>
          {c === "product" ? confirmNode : <Link href="?confirm=product">상품 삭제…</Link>}
          <p style={{ marginTop: 12 }}>
            <Link href="/products">← 목록으로</Link>
          </p>
        </section>
      </Pair>
    </div>
  );
}
