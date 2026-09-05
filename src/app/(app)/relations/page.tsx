import { describeKey } from "@/domain/refs";
import { getServices } from "@/lib/services";

import { parseRefTarget, type RelationQuery } from "./lib";

export const dynamic = "force-dynamic";

function coordText(at: { document?: string; ownerName?: string; ownerId?: string; articleTitle?: string; refPath?: string }): string {
  return [at.document, at.ownerName ?? at.ownerId, at.articleTitle, at.refPath].filter(Boolean).join(" · ") || "—";
}

export default async function RelationsPage({ searchParams }: { searchParams: Promise<RelationQuery> }) {
  const q = await searchParams;
  const services = getServices();
  const target = parseRefTarget(q);
  const integrity = await services.refs.integrity();

  return (
    <div>
      <h1 className="ts-h1">관계정보</h1>

      <h2 className="ts-h2">조회 대상</h2>
      <form method="get" className="ts-form">
        <label className="ts-field">
          <span>종류</span>
          <select name="kind" defaultValue={q.kind ?? ""}>
            <option value="">— 선택 —</option>
            <option value="discriminator">구분자</option>
            <option value="field">구분자 필드</option>
            <option value="enum">enum</option>
            <option value="enumValue">enum 값</option>
            <option value="clause">공용조항</option>
            <option value="appendix">별표</option>
            <option value="coverageNode">담보 노드</option>
            <option value="attribute">담보속성</option>
            <option value="attributeValue">담보속성 값</option>
            <option value="product">상품</option>
            <option value="productCoverage">상품담보</option>
            <option value="document">문서</option>
          </select>
        </label>
        <label className="ts-field">
          <span>코드</span>
          <input type="text" name="code" defaultValue={q.code ?? ""} placeholder="D0001 · C0001 · APX1 …" />
        </label>
        <label className="ts-field">
          <span>id (문서·담보노드·상품 등)</span>
          <input type="text" name="id" defaultValue={q.id ?? ""} />
        </label>
        <label className="ts-field">
          <span>레벨 (담보 노드일 때)</span>
          <select name="level" defaultValue={q.level ?? ""}>
            <option value="">—</option>
            <option value="coverage">coverage</option>
            <option value="subCoverage">subCoverage</option>
            <option value="benefit">benefit</option>
          </select>
        </label>
        <label className="ts-field">
          <span>필드 코드 (field 일 때)</span>
          <input type="text" name="fieldCode" defaultValue={q.fieldCode ?? ""} />
        </label>
        <label className="ts-field">
          <span>값 코드 (enumValue·attributeValue 일 때)</span>
          <input type="text" name="valueCode" defaultValue={q.valueCode ?? ""} />
        </label>
        <div className="ts-form-actions">
          <button type="submit">조회</button>
        </div>
      </form>

      {q.kind && !target && <p className="ts-error-banner">입력을 확인하세요 (필수 항목 누락).</p>}

      {target && <RelationResult targetKey={target} />}

      <h2 className="ts-h2">무결성 요약</h2>
      <p>
        고아: {integrity.orphans.length} · 순환: {integrity.cycles.length} · 깨진 참조: {integrity.broken.length}
      </p>
      {integrity.orphans.length > 0 && (
        <>
          <h3>고아</h3>
          <ul>
            {integrity.orphans.map((n, i) => (
              <li key={i}>{n.label}</li>
            ))}
          </ul>
        </>
      )}
      {integrity.cycles.length > 0 && (
        <>
          <h3>순환</h3>
          <ul>
            {integrity.cycles.map((c, i) => (
              <li key={i}>{c.nodes.map(describeKey).join(" → ")}</li>
            ))}
          </ul>
        </>
      )}
      {integrity.broken.length > 0 && (
        <>
          <h3>깨진 참조</h3>
          <ul className="ts-issues">
            {integrity.broken.map((e, i) => (
              <li key={i}>
                {describeKey(e.from)} → {describeKey(e.to)} ({e.via}) · {coordText(e.at)}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

async function RelationResult({ targetKey }: { targetKey: NonNullable<ReturnType<typeof parseRefTarget>> }) {
  const view = await getServices().refs.relation(targetKey);
  return (
    <>
      <h2 className="ts-h2">{view.node ? view.node.label : `${describeKey(targetKey)} (삭제된 대상 — 참조만 남음)`}</h2>

      <h3>정방향 — 이것이 참조하는 것 ({view.outgoing.length})</h3>
      <ul>
        {view.outgoing.map((e, i) => (
          <li key={i}>
            {describeKey(e.to)} ({e.via}) · {coordText(e.at)}
          </li>
        ))}
      </ul>

      <h3>역방향 — 이것을 참조하는 것 ({view.incoming.length})</h3>
      <ul>
        {view.incoming.map((e, i) => (
          <li key={i}>
            {describeKey(e.from)} ({e.via}) · {coordText(e.at)}
          </li>
        ))}
      </ul>

      <h3>옵션 오버라이드 사용처 ({view.overrides.length})</h3>
      <ul>
        {view.overrides.map((e, i) => (
          <li key={i}>
            {describeKey(e.from)} · {coordText(e.at)}
          </li>
        ))}
      </ul>

      {view.broken.length > 0 && (
        <>
          <h3>깨진 정방향 참조</h3>
          <ul className="ts-issues">
            {view.broken.map((e, i) => (
              <li key={i}>{describeKey(e.to)}</li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
