/**
 * 조립 진입점 — 9단계를 이어 붙여 책자(Booklet)를 만든다. 매번 재계산, 저장 없음 (조립_기획).
 *
 *   buildContexts → (문서마다) resolveDocument → substituteSlots → judgeOmission → numberDocument
 *   → placeSpecials(그룹별 sortInGroup) → collectAppendices(책자 순) → renderDocument
 *
 * - 부분 조립: 오류는 마커로 심고 끝까지 간다. `issues` 는 책자 등장 순 (D-P6-12). 하나라도 있으면 `complete=false`.
 * - 미배치 상품담보(문면 있음)는 `unplaced` 오류 + 책자에서 제외 (D-P6-5). 그 문서의 오류도 뒤이어 보고한다.
 * - 문면 없는 담보의 탑재분은 오류가 아니라 `undocumented` (D-P6-9).
 * - 특약 문서 제목 = 상품담보명 + 「 특별약관」 (임시 규칙 — 실물 조사 후 확정).
 * - `assembleSpecial` = 상품담보 미리보기 (문면_기획): 담보약관 하나를 그 상품담보 문맥으로, 보통약관과 함께.
 */

import type { OptionSelection } from "../clause/types";
import type { DocumentNode } from "../document/nodes";
import type { CompletenessFilter } from "../coverage/values";
import { sortInGroup } from "../product/groups";
import type { ClauseOptionOverride, ProductCoverage } from "../product/types";
import { type Id, type Issue, ok, reject, type Result } from "../types";
import { buildContexts, generalCoordinate, specialCoordinate, type AssemblyContext, type AssemblyContexts } from "./context";
import { judgeOmission } from "./omission";
import { collectAppendices, numberDocument, renderDocument } from "./render";
import { resolveDocument } from "./resolve";
import { substituteSlots } from "./substitute";
import type { AssemblyCoverage, AssemblyInput, Booklet, NumberedDoc, OmissionRecord, RenderedDoc, RenderedGroup, SpecialPreview, UndocumentedCoverage } from "./types";

// ───────────────────────────── 공통 ─────────────────────────────

/** 특약 문서 제목 — 임시 규칙. */
export function specialTitle(productCoverageName: string): string {
  return `${productCoverageName} 특별약관`;
}

function overrideMap(overrides: readonly ClauseOptionOverride[]): Map<Id, OptionSelection> {
  return new Map(overrides.map((o) => [o.nodeId, o.options]));
}

interface Shared {
  clauses: Map<string, AssemblyInput["clauses"][number]>;
  catalog: Map<string, AssemblyInput["catalog"][number]>;
  enums: Map<string, AssemblyInput["enums"][number]>;
}

function shared(input: AssemblyInput): Shared {
  return {
    clauses: new Map(input.clauses.map((c) => [c.code, c])),
    catalog: new Map(input.catalog.map((d) => [d.code, d])),
    enums: new Map(input.enums.map((e) => [e.code, e])),
  };
}

interface Built {
  numbered: NumberedDoc;
  issues: Issue[];
  omitted: OmissionRecord[];
}

/** 문서 하나를 해소 → 치환 → (생략) → 번호까지. */
function build(doc: DocumentNode, ctx: AssemblyContext, s: Shared, opts: { coordinate: ReturnType<typeof specialCoordinate>; overrides: readonly ClauseOptionOverride[]; general?: NumberedDoc; owner?: { productCoverageId: Id; productCoverageName: string }; title?: string }): Built {
  const resolved = resolveDocument({ ...doc, ...(opts.title !== undefined ? { title: opts.title } : {}) }, ctx, { clauses: s.clauses, overrides: overrideMap(opts.overrides), coordinate: opts.coordinate });
  const substituted = substituteSlots(resolved.doc, ctx, { catalog: s.catalog, enums: s.enums });
  const issues = [...resolved.issues, ...substituted.issues];
  if (!opts.owner) return { numbered: numberDocument(substituted.doc), issues, omitted: [] };
  const judged = judgeOmission(substituted.doc, opts.general?.doc, opts.owner);
  return { numbered: numberDocument(judged.doc), issues, omitted: judged.omitted };
}

function buildGeneral(input: AssemblyInput, contexts: AssemblyContexts, s: Shared): Built | undefined {
  const g = input.product.general;
  if (!g) return undefined;
  return build(g, contexts.general, s, { coordinate: generalCoordinate(input.product), overrides: input.product.overrides });
}

function buildSpecial(input: AssemblyInput, contexts: AssemblyContexts, s: Shared, c: AssemblyCoverage, general: Built | undefined): Built | undefined {
  const doc = input.specialDocuments.get(c.snapshot.coverageId);
  const ctx = contexts.specials.get(c.snapshot.id);
  if (!doc || !ctx) return undefined;
  return build(doc, ctx, s, {
    coordinate: specialCoordinate(c),
    overrides: c.overrides,
    general: general?.numbered,
    owner: { productCoverageId: c.snapshot.id, productCoverageName: c.snapshot.name },
    title: specialTitle(c.snapshot.name),
  });
}

// ───────────────────────────── 9. 특약 배치 ─────────────────────────────

export interface Placement {
  /** 그룹 순 → 그룹 안 자동 정렬 순. */
  groups: { id: Id; title: string; members: AssemblyCoverage[] }[];
  /** 어느 그룹에도 속하지 않은 상품담보 (문면 있는 것만 — 없는 것은 undocumented). */
  unplaced: AssemblyCoverage[];
  undocumented: UndocumentedCoverage[];
}

export function placeSpecials(input: AssemblyInput): Placement {
  const documented = input.coverages.filter((c) => input.specialDocuments.has(c.snapshot.coverageId));
  const undocumented = input.coverages
    .filter((c) => !input.specialDocuments.has(c.snapshot.coverageId))
    .map((c) => ({ productCoverageId: c.snapshot.id, name: c.snapshot.name, coverageId: c.snapshot.coverageId }));
  // 담보 순서 = 담보명 순 (B4 groupViews 와 같은 규칙 — B1 마스터 순서는 통합 때 어댑터로)
  const names = [...new Set(documented.map((c) => c.snapshot.coverageName))].sort((a, b) => a.localeCompare(b));
  const nameOf = new Map(documented.map((c) => [c.snapshot.coverageId, c.snapshot.coverageName]));
  const coverageOrder = (id: Id) => names.indexOf(nameOf.get(id) ?? "");
  const byId = new Map(documented.map((c) => [c.snapshot.id, c]));

  const groups = [...input.groups]
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map((g) => {
      const members = documented.filter((c) => c.groupId === g.id).map((c) => c.snapshot as ProductCoverage);
      return { id: g.id, title: g.title, members: sortInGroup(members, input.attributeKinds, coverageOrder).map((m) => byId.get(m.id)!) };
    });
  const placed = new Set(groups.flatMap((g) => g.members.map((m) => m.snapshot.id)));
  return { groups, unplaced: documented.filter((c) => !placed.has(c.snapshot.id)), undocumented };
}

// ───────────────────────────── 조립 ─────────────────────────────

export function assemble(input: AssemblyInput): Booklet {
  const s = shared(input);
  const contexts = buildContexts(input);
  const issues: Issue[] = [];
  const omitted: OmissionRecord[] = [];

  const general = buildGeneral(input, contexts, s);
  if (!general) {
    issues.push({ kind: "brokenRef", message: "보통약관 템플릿이 선택되지 않았습니다", at: { document: "product", ownerId: input.product.id, ownerName: input.product.name } });
  }

  const placement = placeSpecials(input);
  const builtGroups = placement.groups.map((g) => ({
    ...g,
    docs: g.members.flatMap((c) => {
      const b = buildSpecial(input, contexts, s, c, general);
      return b ? [{ c, b }] : [];
    }),
  }));

  // 8. 별표 — 책자 순
  const inOrder = [...(general ? [general.numbered.doc] : []), ...builtGroups.flatMap((g) => g.docs.map((d) => d.b.numbered.doc))];
  const appendices = collectAppendices(inOrder, input.appendices);

  // 7. 참조 해소 + 렌더 (책자 순으로 issues 를 모은다)
  let renderedGeneral: RenderedDoc | undefined;
  if (general) {
    const r = renderDocument(general.numbered, { document: "general", ownerId: generalCoordinate(input.product).ownerId!, appendices });
    renderedGeneral = r.doc;
    issues.push(...general.issues, ...r.issues);
  }
  const specials: RenderedGroup[] = builtGroups.map((g) => ({
    id: g.id,
    title: g.title,
    docs: g.docs.map(({ c, b }) => {
      const r = renderDocument(b.numbered, { document: "special", ownerId: c.snapshot.id, general: general?.numbered, appendices });
      issues.push(...b.issues, ...r.issues);
      omitted.push(...b.omitted);
      return r.doc;
    }),
  }));

  // 미배치 — 오류 + (책자엔 안 실리지만) 그 문서의 오류도 드러낸다
  for (const c of placement.unplaced) {
    issues.push({ kind: "unplaced", message: `상품담보 「${c.snapshot.name}」 이(가) 어느 특약 그룹에도 배치되지 않았습니다`, at: specialCoordinate(c) });
    const b = buildSpecial(input, contexts, s, c, general);
    if (b) {
      issues.push(...b.issues);
      omitted.push(...b.omitted);
    }
  }

  return { general: renderedGeneral, specials, appendices, issues, complete: issues.length === 0, omitted, undocumented: placement.undocumented, trace: contexts.traces };
}

/** 상품담보 미리보기 — 배치와 무관하게 그 담보약관 하나를 조립한다. */
export function assembleSpecial(input: AssemblyInput, productCoverageId: Id): Result<SpecialPreview> {
  const c = input.coverages.find((x) => x.snapshot.id === productCoverageId);
  if (!c) return reject({ reason: "notFound", what: `상품담보 ${productCoverageId}` });
  if (!input.specialDocuments.has(c.snapshot.coverageId)) return reject({ reason: "notFound", what: `담보 ${c.snapshot.coverageName} 의 담보약관 문서` });

  const s = shared(input);
  const contexts = buildContexts(input);
  const general = buildGeneral(input, contexts, s);
  const b = buildSpecial(input, contexts, s, c, general)!;
  const appendices = collectAppendices([...(general ? [general.numbered.doc] : []), b.numbered.doc], input.appendices);
  const issues: Issue[] = [];
  let renderedGeneral: RenderedDoc | undefined;
  if (general) {
    const r = renderDocument(general.numbered, { document: "general", ownerId: generalCoordinate(input.product).ownerId!, appendices });
    renderedGeneral = r.doc;
    issues.push(...general.issues, ...r.issues);
  }
  const r = renderDocument(b.numbered, { document: "special", ownerId: c.snapshot.id, general: general?.numbered, appendices });
  issues.push(...b.issues, ...r.issues);
  const trace = contexts.traces.filter((t) => t.productCoverageId === productCoverageId || t.productCoverageId === input.product.baseContractId);
  return ok({ doc: r.doc, general: renderedGeneral, appendices, issues, complete: issues.length === 0, omitted: b.omitted, trace });
}

// ───────────────────────────── 실행 기반 완결성 필터 ─────────────────────────────

/**
 * 담보 마스터 완결성(부착 기반 전체)을 「이 책자의 실행이 실제로 읽은 자리」로 좁힌다 (구분자_기획 · ADR-0016).
 * 상품담보 스냅샷 노드는 마스터 노드 id 로 대응시킨다. 어떤 탑재분도 읽지 않은 자리는 이 상품의 미입력이 아니다.
 */
export function executionBasedFilter(booklet: Booklet): CompletenessFilter {
  return (items, tree) => {
    const read = new Set<string>();
    for (const t of booklet.trace) {
      if (t.coverageId !== tree.id) continue;
      for (const r of t.reads) read.add(`${r.masterId}|${r.path}`);
    }
    return items.filter((m) => read.has(`${m.owner.id}|${m.path}`));
  };
}
