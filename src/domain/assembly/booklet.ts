/**
 * 조립 진입점 — 단계별 순수 변환을 이어 붙여 책자(Booklet)를 만든다. 매번 재계산, 저장 없음 (조립_기획).
 *
 *   buildContexts → resolveDocument → substituteSlots → replaceGeneralWithBase → ensureApplicationArticle
 *   → judgeOmission → numberDocument → placeSpecials → collectAppendices → renderDocument
 *
 * - 부분 조립: 오류는 마커로 심고 끝까지 간다. `issues` 는 책자 등장 순 (D-P6-12). error가 있으면 `complete=false`, warning만 있으면 완성본이다.
 * - 미배치 상품담보(문면 있음)는 `unplaced` 오류 + 책자에서 제외 (D-P6-5). 그 문서의 오류도 뒤이어 보고한다.
 * - 문면 없는 담보의 탑재분은 오류가 아니라 `undocumented` (D-P6-9).
 * - 특약 문서 제목 = 상품담보명 + 「 특별약관」 (임시 규칙 — 실물 조사 후 확정).
 * - `assembleSpecial` = 상품담보 미리보기 (문면_기획): 담보약관 하나를 그 상품담보 문맥으로, 보통약관과 함께.
 */

import type { OptionSelection } from "../clause/types";
import type { ArticleNode, DocumentNode } from "../document/nodes";
import type { CompletenessFilter } from "../coverage/values";
import { sortInGroup } from "../product/groups";
import type { ClauseOptionOverride, ProductCoverage } from "../product/types";
import { type Coordinate, type Id, type Issue, ok, reject, type Result } from "../types";
import { buildContexts, generalCoordinate, specialCoordinate, type AssemblyContext, type AssemblyContexts } from "./context";
import { ensureApplicationArticle } from "./application";
import { replaceGeneralWithBase } from "./base";
import { judgeOmission } from "./omission";
import { collectAppendices, locateIssues, numberDocument, renderDocument } from "./render";
import { resolveDocument } from "./resolve";
import { substituteSlots } from "./substitute";
import type { AssemblyCoverage, AssemblyInput, Booklet, NumberedDoc, OmissionRecord, RArticle, RenderedDoc, RenderedGroup, SInline, SpecialPreview, SubstitutedDoc, UndocumentedCoverage } from "./types";
import { articlesOf } from "./walk";

/**
 * 대치되는 보통약관 조의 항·호·목 → 같은 자리(순번)의 기본계약 항·호·목 별칭.
 * 마스터 본문이 다른 조에서 「제4조(…) 제4항」처럼 대치될 조의 항을 가리킬 수 있다 (실물 제8조) — 대치 뒤 그 id 는
 * 사라지므로 순번으로 기본계약 쪽 id 에 잇는다. 마스터의 조건 블록 안 항은 세지 않는다 (마스터 제3·4조는 평문).
 */
function positionAliases(master: ArticleNode, base: RArticle<SInline>): [Id, Id][] {
  const out: [Id, Id][] = [];
  const masterParagraphs = master.children.filter((c) => c.kind === "paragraph");
  const baseParagraphs = base.children.filter((c) => c.kind === "paragraph");
  masterParagraphs.forEach((mp, i) => {
    const bp = baseParagraphs[i];
    if (!bp) return;
    out.push([mp.id, bp.id]);
    const masterItems = (mp.items ?? []).filter((c) => c.kind === "item");
    const baseItems = (bp.items ?? []).filter((c) => c.kind === "item");
    masterItems.forEach((mi, j) => {
      const bi = baseItems[j];
      if (!bi) return;
      out.push([mi.id, bi.id]);
      (mi.subitems ?? []).filter((c) => c.kind === "subitem").forEach((mu, k) => {
        const bu = (bi.subitems ?? []).filter((c) => c.kind === "subitem")[k];
        if (bu) out.push([mu.id, bu.id]);
      });
    });
  });
  return out;
}

function masterArticles(doc: DocumentNode): Map<Id, ArticleNode> {
  const out = new Map<Id, ArticleNode>();
  for (const c of doc.children) {
    if (c.kind === "article") out.set(c.id, c);
    else if (c.kind === "section") for (const a of c.children) if (a.kind === "article") out.set(a.id, a);
  }
  return out;
}

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
  /** 보통약관: 대치된 기본계약 조 id → 보통약관 조 id (렌더의 자기 참조 해소). */
  aliases?: ReadonlyMap<Id, Id>;
}

interface Prepared {
  doc: SubstitutedDoc;
  issues: Issue[];
}

function omissionAliases(records: readonly OmissionRecord[]): ReadonlyMap<Id, Id> {
  return new Map(records.filter((record) => record.disposition === "omitted").map((record) => [record.articleId, record.linkedArticleId]));
}

function prepare(
  doc: DocumentNode,
  ctx: AssemblyContext,
  s: Shared,
  opts: { coordinate: ReturnType<typeof specialCoordinate>; overrides: readonly ClauseOptionOverride[]; source: Coordinate; valueSource: Coordinate; title?: string },
): Prepared {
  const resolved = resolveDocument({ ...doc, ...(opts.title !== undefined ? { title: opts.title } : {}) }, ctx, { clauses: s.clauses, overrides: overrideMap(opts.overrides), coordinate: opts.coordinate });
  const substituted = substituteSlots(resolved.doc, ctx, { catalog: s.catalog, enums: s.enums });
  const issues = [...resolved.issues, ...substituted.issues].map((issue): Issue => {
    if (issue.source) return issue;
    if (issue.kind === "notEntered" || issue.kind === "notAttached") {
      return { ...issue, source: { ...opts.valueSource, nodeKind: "value", refPath: issue.at.refPath } };
    }
    const nodeKind = issue.kind === "unusedAttribute" || issue.kind === "syntax" || issue.kind === "typeMismatch"
      ? "condition"
      : issue.kind === "optionInvalid" || issue.kind === "optionUnselected"
        ? "option"
        : issue.kind === "articleGone"
          ? "articleRef"
          : undefined;
    return { ...issue, source: { ...opts.source, articleId: issue.at.articleId, articleTitle: issue.at.articleTitle, nodePath: issue.at.nodePath, ...(nodeKind ? { nodeKind } : {}), refPath: issue.at.refPath } };
  });
  return { doc: substituted.doc, issues };
}

function prepareCoordinates(input: AssemblyInput, doc: DocumentNode, coverage?: AssemblyCoverage): { source: Coordinate; valueSource: Coordinate } {
  return {
    source: coverage
      ? { document: "coverageMaster", ownerId: doc.id, ownerName: coverage.snapshot.coverageName }
      : { document: "general", ownerId: doc.id, ownerName: doc.title },
    valueSource: {
      document: "product",
      ownerId: input.product.id,
      ownerName: input.product.name,
      ...(coverage ? { subjectName: coverage.snapshot.name, nodePath: [coverage.snapshot.id] } : {}),
    },
  };
}

function buildGeneral(input: AssemblyInput, contexts: AssemblyContexts, s: Shared): Built | undefined {
  const g = input.product.general;
  if (!g) return undefined;
  if (input.product.baseContractIds.length === 1) {
    const base = input.coverages.find((coverage) => coverage.snapshot.id === input.product.baseContractIds[0]);
    const doc = base && input.specialDocuments.get(base.snapshot.coverageId);
    const ctx = base && contexts.specials.get(base.snapshot.id);
    if (base && doc && ctx) {
      const basePrepared = prepare(doc, ctx, s, { coordinate: specialCoordinate(base), overrides: base.overrides, ...prepareCoordinates(input, doc, base) });
      const replacedArticleIds = new Set(articlesOf(basePrepared.doc).flatMap((node) => (node.linkedArticleId ? [node.linkedArticleId] : [])));
      // 대치될 보통약관 본문은 실행 경로가 아니다. 먼저 비운 뒤 해소해야 사라질 슬롯의 오류·조회 흔적이 남지 않는다.
      const emptyReplaced = (node: DocumentNode["children"][number]): DocumentNode["children"][number] => {
        if (node.kind === "article") return replacedArticleIds.has(node.id) ? { ...node, children: [] } : node;
        if (node.kind === "section") return { ...node, children: node.children.map((c) => (c.kind === "article" && replacedArticleIds.has(c.id) ? { ...c, children: [] } : c)) };
        return node;
      };
      const generalSource: DocumentNode = { ...g, children: g.children.map(emptyReplaced) };
      const generalPrepared = prepare(generalSource, contexts.general, s, { coordinate: generalCoordinate(input.product), overrides: input.product.overrides, ...prepareCoordinates(input, g) });
      const replaced = replaceGeneralWithBase(generalPrepared.doc, basePrepared.doc, { productCoverageId: base.snapshot.id, productCoverageName: base.snapshot.name });
      const originals = masterArticles(g);
      for (const baseArticle of articlesOf(basePrepared.doc)) {
        const original = baseArticle.linkedArticleId ? originals.get(baseArticle.linkedArticleId) : undefined;
        if (original) for (const [from, to] of positionAliases(original, baseArticle)) replaced.aliases.set(from, to);
      }
      const replacementIssues = replaced.issues.map((issue) => ({ ...issue, source: { document: "coverageMaster" as const, ownerId: doc.id, ownerName: base.snapshot.coverageName, articleId: issue.at.articleId, articleTitle: issue.at.articleTitle, nodePath: issue.at.articleId ? [doc.id, issue.at.articleId] : undefined } }));
      return { numbered: numberDocument(replaced.doc), issues: [...generalPrepared.issues, ...basePrepared.issues, ...replacementIssues], omitted: [], aliases: replaced.aliases };
    }
  }
  const prepared = prepare(g, contexts.general, s, { coordinate: generalCoordinate(input.product), overrides: input.product.overrides, ...prepareCoordinates(input, g) });
  return { numbered: numberDocument(prepared.doc), issues: prepared.issues, omitted: [] };
}

function buildSpecial(input: AssemblyInput, contexts: AssemblyContexts, s: Shared, c: AssemblyCoverage, general: Built | undefined): Built | undefined {
  const doc = input.specialDocuments.get(c.snapshot.coverageId);
  const ctx = contexts.specials.get(c.snapshot.id);
  if (!doc || !ctx) return undefined;
  const prepared = prepare(doc, ctx, s, {
    coordinate: specialCoordinate(c),
    overrides: c.overrides,
    ...prepareCoordinates(input, doc, c),
    title: specialTitle(c.snapshot.name),
  });
  const withApplication = ensureApplicationArticle(prepared.doc);
  const judged = judgeOmission(withApplication, general?.numbered.doc, { productCoverageId: c.snapshot.id, productCoverageName: c.snapshot.name });
  return { numbered: numberDocument(judged.doc), issues: prepared.issues, omitted: judged.records };
}

// ───────────────────────────── 9. 특약 배치 ─────────────────────────────

export interface Placement {
  /** 그룹 순 → 그룹 안 자동 정렬 순. */
  groups: { id: Id; title: string; members: AssemblyCoverage[] }[];
  /** 어느 그룹에도 속하지 않은 상품담보 (문면 있는 것만 — 없는 것은 undocumented). */
  unplaced: AssemblyCoverage[];
  undocumented: UndocumentedCoverage[];
  baseContracts: Booklet["baseContracts"];
}

export function placeSpecials(input: AssemblyInput): Placement {
  const baseIds = new Set(input.product.baseContractIds);
  const baseContracts = input.coverages
    .filter((c) => baseIds.has(c.snapshot.id))
    .map((c) => ({ productCoverageId: c.snapshot.id, name: c.snapshot.name, coverageId: c.snapshot.coverageId }));
  const specials = input.coverages.filter((c) => !baseIds.has(c.snapshot.id));
  const documented = specials.filter((c) => input.specialDocuments.has(c.snapshot.coverageId));
  const undocumented = specials
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
  return { groups, unplaced: documented.filter((c) => !placed.has(c.snapshot.id)), undocumented, baseContracts };
}

// ───────────────────────────── 조립 ─────────────────────────────

export function assemble(input: AssemblyInput): Booklet {
  const s = shared(input);
  const contexts = buildContexts(input);
  const issues: Issue[] = [];
  const omitted: OmissionRecord[] = [];

  if (input.product.baseContractIds.length === 0) {
    issues.push({ kind: "noBaseContract", severity: "error", message: "기본계약이 지정되지 않았습니다", at: { document: "product", ownerId: input.product.id, ownerName: input.product.name }, source: { document: "product", ownerId: input.product.id, ownerName: input.product.name } });
  } else if (input.product.baseContractIds.length > 1) {
    issues.push({ kind: "unsupported", severity: "error", message: "기본계약 2개 이상은 MVP 이후에 지원합니다", at: { document: "product", ownerId: input.product.id, ownerName: input.product.name }, source: { document: "product", ownerId: input.product.id, ownerName: input.product.name } });
  }

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

  // 8. 별표 — 상품 별표 목록 순서 (ADR-0030)
  const appendices = collectAppendices(input.product.appendixOrder, input.appendices);

  // 7. 참조 해소 + 렌더 (책자 순으로 issues 를 모은다)
  let renderedGeneral: RenderedDoc | undefined;
  if (general) {
    const r = renderDocument(general.numbered, { document: "general", ownerId: generalCoordinate(input.product).ownerId!, appendices, aliases: general.aliases });
    renderedGeneral = r.doc;
    issues.push(...locateIssues(general.issues, general.numbered), ...r.issues);
  }
  const specials: RenderedGroup[] = builtGroups.map((g) => ({
    id: g.id,
    title: g.title,
    docs: g.docs.map(({ c, b }) => {
      const r = renderDocument(b.numbered, { document: "special", ownerId: c.snapshot.id, general: general?.numbered, aliases: omissionAliases(b.omitted), appendices });
      issues.push(...locateIssues(b.issues, b.numbered), ...r.issues);
      omitted.push(...b.omitted);
      return r.doc;
    }),
  }));

  // 미배치 — 오류 + (책자엔 안 실리지만) 그 문서의 오류도 드러낸다
  for (const c of placement.unplaced) {
    issues.push({ kind: "unplaced", message: `상품담보 「${c.snapshot.name}」 이(가) 어느 특약 그룹에도 배치되지 않았습니다`, at: specialCoordinate(c) });
    const b = buildSpecial(input, contexts, s, c, general);
    if (b) {
      issues.push(...locateIssues(b.issues, b.numbered));
      omitted.push(...b.omitted);
    }
  }

  return { general: renderedGeneral, specials, appendices, issues, complete: !issues.some((item) => (item.severity ?? "error") === "error"), omitted, undocumented: placement.undocumented, baseContracts: placement.baseContracts, trace: contexts.traces };
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
  const appendices = collectAppendices(input.product.appendixOrder, input.appendices);
  const issues: Issue[] = [];
  let renderedGeneral: RenderedDoc | undefined;
  if (general) {
    const r = renderDocument(general.numbered, { document: "general", ownerId: generalCoordinate(input.product).ownerId!, appendices, aliases: general.aliases });
    renderedGeneral = r.doc;
    issues.push(...locateIssues(general.issues, general.numbered), ...r.issues);
  }
  const r = renderDocument(b.numbered, { document: "special", ownerId: c.snapshot.id, general: general?.numbered, aliases: omissionAliases(b.omitted), appendices });
  issues.push(...locateIssues(b.issues, b.numbered), ...r.issues);
  const trace = contexts.traces.filter((t) => t.productCoverageId === productCoverageId || input.product.baseContractIds.includes(t.productCoverageId));
  return ok({ doc: r.doc, general: renderedGeneral, appendices, issues, complete: !issues.some((item) => (item.severity ?? "error") === "error"), omitted: b.omitted, trace });
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
