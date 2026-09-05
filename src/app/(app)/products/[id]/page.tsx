import Link from "next/link";
import type { ReactNode } from "react";

import { Confirm } from "@/app/_components/Confirm";
import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { IssueList } from "@/app/_components/IssueList";
import { ValueForm } from "@/app/_components/ValueForm";
import { previewOutcome } from "@/app/_lib/rejection";
import { planOptionLabel } from "@/domain/product";
import { buildForm } from "@/forms";
import { currentActor, getServices } from "@/lib/services";

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
  const [generals, defs, enumsList, planOptions, plans, coverages, attributeKinds, productCoverages, groups, unplaced, overrides, missing] = await Promise.all([
    services.document.list("general"),
    services.catalog.list(),
    services.catalog.listEnums(),
    services.product.listPlanOptions(id),
    services.product.listPlans(id),
    services.coverage.list(),
    services.product.listAttributeKinds(),
    services.product.listProductCoverages(id),
    services.product.listGroups(id),
    services.product.listUnplaced(id),
    services.product.listOptionOverrides({ kind: "product", id }),
    services.product.productMissing(id),
  ]);
  const productValues = await services.product.getProductValues(id);
  const enumLookup = (code: string) => enumsList.find((e) => e.code === code);
  const productDefs = defs.filter((d) => (d.kind === "scalar" || d.kind === "struct") && d.level === "product" && d.alwaysExposed);
  const baseCheck = await services.product.checkBaseContract(id);

  let confirmNode: ReactNode = null;
  const c = sp.confirm;
  if (c === "product") {
    const outcome = previewOutcome(await services.product.deleteProduct(actor, id));
    confirmNode = outcome.kind === "confirm" ? <Confirm impact={outcome.impact} action={deleteProductAction.bind(null, id)} /> : outcome.kind === "error" ? <p className="ts-error-banner">{outcome.message}</p> : null;
  } else if (c?.startsWith("pc:")) {
    const pcId = c.slice(3);
    const outcome = previewOutcome(await services.product.unmount(actor, pcId));
    confirmNode = outcome.kind === "confirm" ? <Confirm impact={outcome.impact} action={unmountAction.bind(null, id, pcId)} /> : outcome.kind === "error" ? <p className="ts-error-banner">{outcome.message}</p> : null;
  } else if (c?.startsWith("planOption:")) {
    const optionId = c.slice(11);
    const outcome = previewOutcome(await services.product.removePlanOption(actor, optionId));
    confirmNode = outcome.kind === "confirm" ? <Confirm impact={outcome.impact} action={removePlanOptionAction.bind(null, id, optionId)} /> : outcome.kind === "error" ? <p className="ts-error-banner">{outcome.message}</p> : null;
  } else if (c?.startsWith("plan:")) {
    const planId = c.slice(5);
    const outcome = previewOutcome(await services.product.removePlan(actor, planId));
    confirmNode = outcome.kind === "confirm" ? <Confirm impact={outcome.impact} action={removePlanAction.bind(null, id, planId)} /> : outcome.kind === "error" ? <p className="ts-error-banner">{outcome.message}</p> : null;
  } else if (c?.startsWith("detach:")) {
    const [, pcId, planId] = c.split(":");
    const outcome = previewOutcome(await services.product.detachPlan(actor, pcId, planId));
    confirmNode = outcome.kind === "confirm" ? <Confirm impact={outcome.impact} action={detachPlanAction.bind(null, id, pcId, planId)} /> : outcome.kind === "error" ? <p className="ts-error-banner">{outcome.message}</p> : null;
  }

  return (
    <div>
      <h1 className="ts-h1">{product.name}</h1>
      <ErrorBanner message={sp.error} />

      <h2 className="ts-h2">기본 정보</h2>
      <form action={renameProductAction.bind(null, id)} className="ts-form">
        <label className="ts-field">
          <span>상품명</span>
          <input type="text" name="name" defaultValue={product.name} required />
        </label>
        <div className="ts-form-actions">
          <button type="submit">저장</button>
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
          <button type="submit">저장</button>
        </div>
      </form>

      {productDefs.length > 0 && (
        <>
          <h2 className="ts-h2">상품 레벨 값</h2>
          {productDefs.map((d) => (
            <ValueForm key={d.code} model={buildForm(d, enumLookup, productValues)} action={writeProductValuesAction.bind(null, id)} />
          ))}
        </>
      )}

      <p>
        <Link href="/attributes">담보속성 카탈로그 →</Link>
      </p>

      <h2 className="ts-h2">세목</h2>
      <table className="ts-table">
        <thead>
          <tr>
            <th>선택지</th>
            <th>유형</th>
            <th>삭제</th>
          </tr>
        </thead>
        <tbody>
          {planOptions.map((o) => (
            <tr key={o.id}>
              <td>{planOptionLabel(o)}</td>
              <td>
                <code>{o.planTypeCode}</code>
              </td>
              <td>{c === `planOption:${o.id}` ? confirmNode : <Link href={`?confirm=planOption:${o.id}`}>삭제</Link>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <form action={addPlanOptionAction.bind(null, id)} className="ts-form">
        <h2 className="ts-form-title">선택지 추가</h2>
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
          <span>세목유형 구분자 코드 (plan 레벨 구조체)</span>
          <input type="text" name="planTypeCode" required className="ts-mono" />
        </label>
        <div className="ts-form-actions">
          <button type="submit">추가</button>
        </div>
      </form>

      <h3>상품세목 (유효 조합)</h3>
      <ul>
        {plans.map((p) => (
          <li key={p.id}>
            {p.options.map(planOptionLabel).join(" · ")}
            {" — "}
            {c === `plan:${p.id}` ? confirmNode : <Link href={`?confirm=plan:${p.id}`}>삭제</Link>}
          </li>
        ))}
      </ul>
      <form action={registerPlanAction.bind(null, id)} className="ts-form">
        <h2 className="ts-form-title">조합 등록</h2>
        {planOptions.map((o) => (
          <label key={o.id} className="ts-field" style={{ display: "inline-block", width: "auto", marginRight: 12 }}>
            <input type="checkbox" name="optionIds" value={o.id} /> {planOptionLabel(o)}
          </label>
        ))}
        <div className="ts-form-actions">
          <button type="submit">등록</button>
        </div>
      </form>

      <h2 className="ts-h2">탑재 (상품담보)</h2>
      <form action={mountAction.bind(null, id)} className="ts-form">
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
        <div className="ts-form-actions">
          <button type="submit">탑재</button>
        </div>
      </form>

      <h3>상품담보 목록</h3>
      <table className="ts-table">
        <thead>
          <tr>
            <th>이름</th>
            <th>담보</th>
            <th>조작</th>
          </tr>
        </thead>
        <tbody>
          {productCoverages.map((pc) => (
            <tr key={pc.id}>
              <td>
                <Link href={`/products/${id}/coverages/${pc.id}`}>{pc.name}</Link>
              </td>
              <td>{pc.coverageId}</td>
              <td>
                <form action={renameProductCoverageAction.bind(null, id, pc.id)} style={{ display: "inline-flex", gap: 4 }}>
                  <input type="text" name="name" defaultValue={pc.name} />
                  <button type="submit">이름 저장</button>
                </form>{" "}
                <form action={regenerateNameAction.bind(null, id, pc.id)} style={{ display: "inline" }}>
                  <button type="submit">작명 재생성</button>
                </form>{" "}
                <form action={attachPlanAction.bind(null, id, pc.id)} style={{ display: "inline-flex", gap: 4 }}>
                  <select name="planId">
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.options.map(planOptionLabel).join(",")}
                      </option>
                    ))}
                  </select>
                  <button type="submit">세목 부착</button>
                </form>{" "}
                {c === `pc:${pc.id}` ? confirmNode : <Link href={`?confirm=pc:${pc.id}`}>탑재 해제…</Link>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="ts-h2">기본계약</h2>
      {baseCheck.ok ? (
        <ul>
          {baseCheck.value.map((chk) => (
            <li key={chk.productCoverageId}>
              {productCoverages.find((p) => p.id === chk.productCoverageId)?.name ?? chk.productCoverageId}
              <IssueList issues={chk.issues} />
              <form action={releaseBaseContractAction.bind(null, id, chk.productCoverageId)} style={{ display: "inline" }}>
                <button type="submit">기본계약 해제</button>
              </form>
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
          <button type="submit">지정</button>
        </div>
      </form>

      <h2 className="ts-h2">특약 그룹</h2>
      {groups.map((g) => (
        <div key={g.id} className="ts-panel">
          <form action={renameGroupAction.bind(null, id, g.id)} style={{ display: "flex", gap: 4 }}>
            <input type="text" name="title" defaultValue={g.title} />
            <button type="submit">이름 저장</button>
          </form>
          <ul>
            {g.members.map((m) => (
              <li key={m.id}>
                {m.name}{" "}
                <form action={removeFromGroupAction.bind(null, id, m.id)} style={{ display: "inline" }}>
                  <button type="submit">배치 해제</button>
                </form>
              </li>
            ))}
          </ul>
          <form action={placeInGroupAction.bind(null, id, g.id)} style={{ display: "flex", gap: 4 }}>
            <select name="productCoverageId">
              {unplaced.map((pc) => (
                <option key={pc.id} value={pc.id}>
                  {pc.name}
                </option>
              ))}
            </select>
            <button type="submit">배치</button>
          </form>
          <form action={deleteGroupAction.bind(null, id, g.id)} style={{ marginTop: 4 }}>
            <button type="submit" className="danger">
              그룹 삭제
            </button>
          </form>
        </div>
      ))}
      <form action={createGroupAction.bind(null, id)} className="ts-form">
        <h2 className="ts-form-title">그룹 추가</h2>
        <label className="ts-field">
          <span>제목</span>
          <input type="text" name="title" required />
        </label>
        <div className="ts-form-actions">
          <button type="submit">추가</button>
        </div>
      </form>
      <p className="ts-muted">미배치 상품담보: {unplaced.map((p) => p.name).join(", ") || "없음"}</p>

      <h2 className="ts-h2">옵션 오버라이드</h2>
      <ul>
        {overrides.map((o) => (
          <li key={o.id}>
            {o.clauseCode} @ {o.nodeId.slice(0, 8)} — {JSON.stringify(o.options)}{" "}
            <form action={removeOptionOverrideAction.bind(null, id, { kind: "product", id }, o.nodeId, o.clauseCode)} style={{ display: "inline" }}>
              <button type="submit">제거</button>
            </form>
          </li>
        ))}
      </ul>
      <form action={setOptionOverrideAction.bind(null, id, { kind: "product", id })} className="ts-form">
        <h2 className="ts-form-title">오버라이드 설정</h2>
        <p className="ts-muted">nodeId 는 보통약관 문면의 공용조항 참조 노드 id (조 헤더에 표시된 8자리 접두를 참고).</p>
        <label className="ts-field">
          <span>노드 id</span>
          <input type="text" name="nodeId" required className="ts-mono" />
        </label>
        <label className="ts-field">
          <span>공용조항 코드</span>
          <input type="text" name="clauseCode" required className="ts-mono" />
        </label>
        <label className="ts-field">
          <span>옵션 JSON</span>
          <input type="text" name="options" placeholder='{"O01":"V01"}' />
        </label>
        <div className="ts-form-actions">
          <button type="submit">저장</button>
        </div>
      </form>

      <h2 className="ts-h2">완결성 ({missing.length})</h2>
      <ul>
        {missing.map((m, i) => (
          <li key={i}>
            {m.ownerName} · {m.path}
          </li>
        ))}
      </ul>
      {missing.length === 0 && <p className="ts-ok">미입력 없음.</p>}

      <p className="ts-toolbar">
        <Link href={`/products/${id}/preview`}>조립 미리보기 →</Link>
      </p>

      <h2 className="ts-h2">삭제</h2>
      {c === "product" ? confirmNode : <Link href="?confirm=product">상품 삭제…</Link>}

      <p style={{ marginTop: 24 }}>
        <Link href="/products">← 목록으로</Link>
      </p>
    </div>
  );
}
