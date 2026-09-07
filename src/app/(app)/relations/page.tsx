/**
 * 관계정보 (L2) — 조회 대상 하나의 정·역방향 참조와 전체 무결성.
 *
 * - 좌표·노드는 **표시명으로 부른다** (ADR-0022 「키와 표시를 분리한다」 · 리뷰 #24) —
 *   id 는 `title=` tooltip 으로만 남긴다.
 * - 문제 개수에는 늘 분모가 붙는다 (디자인원칙 §9.6 · 리뷰 #39).
 * - 조회 폼은 `?kind=&code=&id=` 를 물려받는다 (§9.1 · 리뷰 #8) — 상세 화면이 「관계정보 →」로 넘어온다.
 */
import Link from "next/link";

import { formatCoordinate } from "@/domain/coordinate";
import { describeKey, nodeKey, type EdgeVia, type RefEdge, type RefGraph, type RefNodeKey, type RefNodeKind, type RefStats, type RelationView } from "@/domain/refs";
import { NODE_LEVEL_LABEL } from "@/app/_lib/labels";
import { getServices } from "@/lib/services";

import { GraphPanel } from "./GraphPanel";
import { KIND_OPTIONS, VIA_LABEL, parseRefTarget, refTargetParams, type RelationQuery } from "./lib";
import { parsePlotOptions, serializePlotOptions } from "./plot-options";
import { plotNeighborhood, type Plot, type PlotOptions } from "./plot";

export const dynamic = "force-dynamic";

/** 참조 한 줄 — 이름으로 부르고, 불변 키는 tooltip 에 둔다. */
function EdgeLine({ edge, side, graph }: { edge: RefEdge; side: "to" | "from"; graph: RefGraph }) {
  const key = side === "to" ? edge.to : edge.from;
  // 역방향·오버라이드 줄은 참조하는 쪽(조)을 이미 이름으로 부르므로 좌표에서 조를 뺀다 — 같은 이름을 두 번 적지 않는다.
  const where = formatCoordinate(edge.at, { source: true, omitOwner: true, omitArticle: side === "from" });
  return (
    <li>
      <span title={nodeKey(key)}>{describeKey(key, graph)}</span> <span className="ts-muted">({VIA_LABEL[edge.via]})</span>
      {where !== "(좌표 없음)" && <span className="ts-muted"> · {where}</span>}
    </li>
  );
}

const VIA_GROUPS = [
  { label: "본문 참조", values: ["when", "slot", "expression"] },
  { label: "구조 결합", values: ["clauseRef", "optionSelect", "articleRef", "link", "appendixRef", "generalDocument", "document", "override"] },
  { label: "부착 · 타입 · 탑재 · 조합", values: ["attach", "type", "mount", "combination"] },
] as const satisfies readonly { label: string; values: readonly EdgeVia[] }[];

function TargetHiddenFields({ target }: { target: RefNodeKey }) {
  return Object.entries(refTargetParams(target)).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />);
}

function GraphControls({ target, options }: { target: RefNodeKey; options: PlotOptions }) {
  return (
    <form method="get" className="ts-graph-controls">
      <TargetHiddenFields target={target} />
      <fieldset>
        <legend>깊이</legend>
        {[1, 2, 3].map((depth) => (
          <label key={depth}>
            <input type="radio" name="depth" value={depth} defaultChecked={options.depth === depth} /> {depth}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>방향</legend>
        {([
          ["both", "양방향"],
          ["in", "역방향만"],
          ["out", "정방향만"],
        ] as const).map(([value, label]) => (
          <label key={value}>
            <input type="radio" name="dir" value={value} defaultChecked={options.direction === value} /> {label}
          </label>
        ))}
      </fieldset>
      <fieldset className="is-wide">
        <legend>종류</legend>
        <input type="hidden" name="kinds" value="" />
        {KIND_OPTIONS.map(({ value, label }) => (
          <label key={value}>
            <input type="checkbox" name="kinds" value={value} defaultChecked={options.kinds.has(value as RefNodeKind)} /> {label}
          </label>
        ))}
      </fieldset>
      <fieldset className="is-wide">
        <legend>형태</legend>
        <input type="hidden" name="vias" value="" />
        {VIA_GROUPS.map((group) => (
          <label key={group.label}>
            <input type="checkbox" name="vias" value={group.values.join(",")} defaultChecked={group.values.every((via) => options.vias.has(via))} /> {group.label}
          </label>
        ))}
        <input type="hidden" name="containment" value="false" />
        <label>
          <input type="checkbox" name="containment" value="true" defaultChecked={options.containment} /> 포함 관계
        </label>
      </fieldset>
      <button type="submit">적용</button>
    </form>
  );
}

function graphHref(target: RefNodeKey, options: PlotOptions): string {
  const params = serializePlotOptions(options);
  for (const [name, value] of Object.entries(refTargetParams(target))) params.set(name, value);
  return `/relations?${params.toString()}`;
}

function GraphSection({ target, plot, options, stats }: { target: RefNodeKey; plot: Plot; options: PlotOptions; stats: RefStats }) {
  const optionQuery = serializePlotOptions(options).toString();
  const edgeCount = plot.status === "ok" ? plot.edges.reduce((sum, edge) => sum + edge.count, 0) : plot.edgeCount;
  const nodeCount = plot.status === "ok" ? plot.nodes.length : plot.nodeCount;
  return (
    <section className="ts-section ts-graph-section">
      <h2 className="ts-section-title">
        이웃 그래프{" "}
        <span className="ts-count">
          노드 <b>{nodeCount}</b> / {stats.nodes} · 간선 <b>{edgeCount}</b> / {stats.edges}
        </span>
      </h2>
      <GraphControls target={target} options={options} />
      {plot.status === "tooLarge" ? (
        <div className="ts-graph-too-large">
          <p>이웃이 노드 {plot.nodeCount}개 · 간선 {plot.edgeCount}건이다 — 깊이를 줄이거나 종류를 걸러라.</p>
          {options.depth > 1 && <Link href={graphHref(target, { ...options, depth: options.depth - 1 })}>깊이 {options.depth - 1}로 낮춰 보기</Link>}
        </div>
      ) : (
        <GraphPanel key={`${nodeKey(target)}?${optionQuery}`} plot={plot} optionQuery={optionQuery} />
      )}
    </section>
  );
}

function RelationResult({ target, view, graph }: { target: RefNodeKey; view: RelationView; graph: RefGraph }) {
  return (
    <>
      <section className="ts-section">
        <h2 className="ts-section-title" title={nodeKey(target)}>
          {view.node ? describeKey(target, graph) : `${describeKey(target)} — 삭제된 대상, 참조만 남았다`}
        </h2>

        <h3 className="ts-h2">
          정방향 — 이것이 참조하는 것 <span className="ts-count"><b>{view.outgoing.length}</b>건</span>
        </h3>
        {view.outgoing.length === 0 ? (
          <p className="ts-muted">참조하는 것이 없다.</p>
        ) : (
          <ul>
            {view.outgoing.map((e, i) => (
              <EdgeLine key={i} edge={e} side="to" graph={graph} />
            ))}
          </ul>
        )}

        <h3 className="ts-h2">
          역방향 — 이것을 참조하는 것 <span className="ts-count"><b>{view.incoming.length}</b>건</span>
        </h3>
        {view.incoming.length === 0 ? (
          <p className="ts-muted">이것을 참조하는 곳이 없다.</p>
        ) : (
          <ul>
            {view.incoming.map((e, i) => (
              <EdgeLine key={i} edge={e} side="from" graph={graph} />
            ))}
          </ul>
        )}

        <h3 className="ts-h2">
          옵션 오버라이드 사용처 <span className="ts-count"><b>{view.overrides.length}</b>건</span>
        </h3>
        {view.overrides.length === 0 ? (
          <p className="ts-muted">오버라이드가 없다.</p>
        ) : (
          <ul>
            {view.overrides.map((e, i) => (
              <EdgeLine key={i} edge={e} side="from" graph={graph} />
            ))}
          </ul>
        )}

        {view.broken.length > 0 && (
          <>
            <h3 className="ts-h2">
              깨진 정방향 참조 <span className="ts-count"><b>{view.broken.length}</b> / {view.outgoing.length}건</span>
            </h3>
            <ul className="ts-issues">
              {view.broken.map((e, i) => (
                <li key={i} title={nodeKey(e.to)}>
                  {describeKey(e.to)} ({VIA_LABEL[e.via]})
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </>
  );
}

export default async function RelationsPage({ searchParams }: { searchParams: Promise<RelationQuery> }) {
  const q = await searchParams;
  const services = getServices();
  const target = parseRefTarget(q);
  const { graph, integrity, relation } = await services.refs.overview(target);
  const { stats } = integrity;
  const plotOptions = parsePlotOptions(q);
  const plot = target ? plotNeighborhood(graph, target, plotOptions) : undefined;
  const serializedOptions = serializePlotOptions(plotOptions);

  return (
    <div>
      <h1 className="ts-h1">관계정보</h1>

      {/* 전체 규모가 먼저 오고 문제 개수가 뒤에 온다 (§9.6) */}
      <p className="ts-count">
        참조 노드 <b>{stats.orphanCandidates}</b>개 중 고아 <b>{integrity.orphans.length}</b> · 참조 <b>{stats.edges}</b>건 중 깨짐{" "}
        <b>{integrity.broken.length}</b> · 순환 <b>{integrity.cycles.length}</b>
      </p>
      <p className="ts-muted" style={{ fontSize: 11 }}>
        고아 분모는 고아가 될 수 있는 종류(구분자 · 공용조항 · 별표) {stats.orphanCandidates}개, 깨짐 분모는 그래프의 참조 {stats.edges}건이다.
      </p>

      <section className="ts-section">
        <h2 className="ts-section-title">조회 대상</h2>
        <form method="get">
          {[...serializedOptions].map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
          <div className="ts-form-row">
            <label htmlFor="rel-kind">종류</label>
            <select id="rel-kind" name="kind" defaultValue={q.kind ?? ""}>
              <option value="">— 선택 —</option>
              {KIND_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="ts-form-row">
            <label htmlFor="rel-code">코드</label>
            <input id="rel-code" type="text" name="code" defaultValue={q.code ?? ""} placeholder="D0001 · C0001 · APX1 …" className="ts-mono" />
          </div>
          <div className="ts-form-row">
            <label htmlFor="rel-id">id</label>
            <input id="rel-id" type="text" name="id" defaultValue={q.id ?? ""} placeholder="문서 · 담보 노드 · 상품 · 상품담보" className="ts-mono" />
          </div>
          <div className="ts-form-row">
            <label htmlFor="rel-level">레벨</label>
            <select id="rel-level" name="level" defaultValue={q.level ?? ""}>
              <option value="">—</option>
              {(Object.keys(NODE_LEVEL_LABEL) as (keyof typeof NODE_LEVEL_LABEL)[]).map((level) => (
                <option key={level} value={level}>
                  {NODE_LEVEL_LABEL[level]}
                </option>
              ))}
            </select>
          </div>
          <div className="ts-form-row">
            <label htmlFor="rel-field">필드 코드</label>
            <input id="rel-field" type="text" name="fieldCode" defaultValue={q.fieldCode ?? ""} placeholder="구분자 필드일 때 — F01" className="ts-mono" />
          </div>
          <div className="ts-form-row">
            <label htmlFor="rel-value">값 코드</label>
            <input id="rel-value" type="text" name="valueCode" defaultValue={q.valueCode ?? ""} placeholder="선택형 값 · 담보속성 값일 때 — V01" className="ts-mono" />
          </div>
          <div className="ts-form-actions">
            <button type="submit" className="primary">
              조회
            </button>
          </div>
        </form>
      </section>

      {q.kind && !target && <p className="ts-error-banner">조회에 필요한 값이 비어 있다 — 고른 종류에 맞는 코드나 id 를 채워라.</p>}

      {target && plot && <GraphSection target={target} plot={plot} options={plotOptions} stats={stats} />}

      {target && relation && <RelationResult target={target} view={relation} graph={graph} />}

      <section className="ts-section">
        <h2 className="ts-section-title">
          고아 — 어디서도 참조되지 않는 것{" "}
          <span className="ts-count">
            <b>{integrity.orphans.length}</b> / {stats.orphanCandidates}
          </span>
        </h2>
        {integrity.orphans.length === 0 ? (
          <p className="ts-muted">고아 없음.</p>
        ) : (
          <ul>
            {integrity.orphans.map((n, i) => (
              <li key={i} title={nodeKey(n.key)}>
                {describeKey(n.key, graph)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="ts-section">
        <h2 className="ts-section-title">
          순환{" "}
          <span className="ts-count">
            <b>{integrity.cycles.length}</b> / {stats.edges}건
          </span>
        </h2>
        {integrity.cycles.length === 0 ? (
          <p className="ts-muted">순환 없음.</p>
        ) : (
          <ul>
            {integrity.cycles.map((c, i) => (
              <li key={i}>{c.nodes.map((n) => describeKey(n, graph)).join(" → ")}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="ts-section">
        <h2 className="ts-section-title">
          깨진 참조{" "}
          <span className="ts-count">
            <b>{integrity.broken.length}</b> / {stats.edges}건
          </span>
        </h2>
        {integrity.broken.length === 0 ? (
          <p className="ts-muted">깨진 참조 없음.</p>
        ) : (
          <ul className="ts-issues">
            {integrity.broken.map((e, i) => (
              <li key={i}>
                <span title={nodeKey(e.from)}>{describeKey(e.from, graph)}</span> → <span title={nodeKey(e.to)}>{describeKey(e.to, graph)}</span>{" "}
                <span className="ts-muted">({VIA_LABEL[e.via]})</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
