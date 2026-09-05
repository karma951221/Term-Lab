/**
 * 참조 그래프 서비스 — DB 재료로 `buildGraph` 하고, 각 영역이 주입받는 「사용처·영향」 소스를 그래프 위에서 구현한다.
 *
 * - `createRefsService(db)` : usages(역방향) · relation(관계정보 뷰) · integrity(고아·순환·깨진 참조).
 * - 주입 소스 (각 영역 서비스의 deps 에 꽂는다 — container.ts):
 *   - `catalogImpactSource(db)`   : catalog `ImpactSource` = 값 저장소(`valuesImpactSource`) + 그래프 역조회.
 *     enum·enum 값 타깃은 정의로 자리를 구해 discriminator/field 로 바꿔 값 행을 세고 지운다 (enum 값은 그 값을 고른 행만).
 *   - `coverageUsageSource(db)`   : coverage `UsageSource.findUsages` — 부착 해제·노드 삭제가 깨뜨릴 문면 사용처.
 *   - `clauseUsageSource(db)`     : clause `UsageSource.documentsReferencing` — 참조 문서(ownerKind coverage/general) + 옵션 선택.
 *   - `documentUsageSource(db)`   : document `UsageSource` — 문서 서비스가 스스로 못 보는 외부 사용처(상품 템플릿 · 담보 문서 연결 ·
 *     옵션 오버라이드 · 공용조항 본문의 별표 참조).
 *   - `attributeRefSource(db)`    : product `AttributeRefSource.findExpressionRefs` — 식이 읽는 담보속성(유효값) 사용처.
 * - 「참조 추가 시점 검증」은 각 영역이 한다. 여기는 조회·영향뿐이다.
 *
 * 트랜잭션: 서비스들은 이 소스를 tx 안에서 부르면서 tx 를 넘기지 않는다. 그래서 `db` 에는 `contextualDb()` 프록시를
 * 넘겨야 한다 (container.ts) — 그러면 그래프 로딩이 같은 tx 위에서 돈다. document 의 소스만 tx 를 직접 받는다.
 */
import type { ImpactSource, ImpactTarget } from "@/domain/catalog";
import { enumReferences } from "@/domain/catalog";
import type { Usage, UsageOwnerKind } from "@/domain/clause";
import type { UsageQuery, UsageSource as CoverageUsageSource } from "@/domain/coverage";
import type { AttributeRefSource } from "@/domain/product";
import {
  brokenEdges,
  brokenIssues,
  buildGraph,
  cycles,
  nodeKey,
  orphans,
  referencesFrom,
  relationView,
  usagesOf,
  type EdgeVia,
  type ProductInput,
  type RefCycle,
  type RefEdge,
  type RefGraph,
  type RefNodeInfo,
  type RefNodeKey,
  type RelationView,
  type UsageOptions,
} from "@/domain/refs";
import type { Code, Coordinate, Id, Issue } from "@/domain/types";

import * as catalogRepo from "@/db/repo/catalog";
import * as clauseRepo from "@/db/repo/clause";
import * as coverageRepo from "@/db/repo/coverage";
import * as documentRepo from "@/db/repo/document";
import * as productRepo from "@/db/repo/product";
import * as refsRepo from "@/db/repo/refs";
import type { Db } from "@/db/repo/types";
import { valuesImpactSource } from "@/db/repo/values";

import type { UsageSource as ClauseUsageSource } from "./clause";
import type { UsageSource as DocumentUsageSource } from "./document";

// ───────────────────────────── 그래프 로딩 ─────────────────────────────

/** DB 전체를 재료로 그래프를 만든다. 주어진 핸들(db 또는 tx)로만 읽는다. */
export async function loadGraph(db: Db): Promise<RefGraph> {
  const [discriminators, enums, clauses, documents, appendices, coverages, attachments, attributeKinds, productRows] = await Promise.all([
    catalogRepo.listDiscriminators(db),
    catalogRepo.listEnums(db),
    clauseRepo.listClauses(db),
    documentRepo.listDocumentRecords(db),
    documentRepo.listAppendices(db),
    coverageRepo.listCoverages(db),
    refsRepo.listAllAttachments(db),
    productRepo.listAttributeKinds(db),
    productRepo.listProducts(db),
  ]);
  const products: ProductInput[] = [];
  for (const p of productRows) {
    const pcs = await productRepo.listProductCoverages(db, p.id);
    const overrides = [...(await productRepo.listOverrides(db, { kind: "product", id: p.id }))];
    for (const pc of pcs) overrides.push(...(await productRepo.listOverrides(db, { kind: "productCoverage", id: pc.id })));
    products.push({ id: p.id, name: p.name, ...(p.generalDocumentId ? { generalDocumentId: p.generalDocumentId } : {}), coverages: pcs, overrides });
  }
  return buildGraph({
    discriminators,
    enums,
    clauses,
    documents: documents.map((d) => ({ id: d.id, kind: d.kind, ...(d.ownerId ? { ownerId: d.ownerId } : {}), title: d.title, ...(d.generalDocumentId ? { generalDocumentId: d.generalDocumentId } : {}), tree: d.tree })),
    appendices,
    coverages,
    attachments,
    attributeKinds,
    products,
  });
}

// ───────────────────────────── 서비스 ─────────────────────────────

export interface IntegrityReport {
  orphans: RefNodeInfo[];
  cycles: RefCycle[];
  broken: RefEdge[];
  /** broken 의 Issue 표기 (조립 오류 패널과 같은 좌표 체계). */
  issues: Issue[];
}

export interface RefsService {
  graph(): Promise<RefGraph>;
  /** 역방향 — 이 실체(와 하위)를 쓰는 곳. */
  usages(target: RefNodeKey, opts?: UsageOptions): Promise<RefEdge[]>;
  /** 관계정보 뷰 — 정방향 · 역방향 · 옵션 오버라이드 사용처. */
  relation(target: RefNodeKey): Promise<RelationView>;
  integrity(): Promise<IntegrityReport>;
}

export function createRefsService(db: Db): RefsService {
  return {
    graph: () => loadGraph(db),
    usages: async (target, opts) => usagesOf(await loadGraph(db), target, opts),
    relation: async (target) => relationView(await loadGraph(db), target),
    integrity: async () => {
      const g = await loadGraph(db);
      return { orphans: orphans(g), cycles: cycles(g), broken: brokenEdges(g), issues: brokenIssues(g) };
    },
  };
}

// ───────────────────────────── 공통 — 문서가 읽는 자리 ─────────────────────────────

/** 「참조」로 치는 형태 — 부착·타입·탑재·조합은 뺀다. */
const REFERENCE_VIAS: readonly EdgeVia[] = ["when", "slot", "expression"];

/** 문서가 읽는 값 자리 하나 — 직접 또는 공용조항·파생을 거쳐서. 좌표는 문서 쪽 자리다. */
interface DocumentRead {
  target: RefNodeKey;
  at: Coordinate;
}

/**
 * 문서(와 조)가 읽는 구분자·필드·담보속성 자리 전부. 공용조항 참조는 그 본문의 참조로, 파생 참조는 그 식의 참조로 펼친다
 * (ADR-0010 늦은 바인딩 — 공용조항의 식은 사용처 문맥에서 해소되므로 사용처의 값 자리를 읽는 것이다).
 */
function documentReads(graph: RefGraph, doc: RefNodeKey): DocumentRead[] {
  const out: DocumentRead[] = [];
  const expand = (edge: RefEdge, at: Coordinate, visited: Set<string>): void => {
    const key = nodeKey(edge.to);
    const here: Coordinate = { ...at, ...(edge.at.refPath !== undefined ? { refPath: edge.at.refPath } : {}) };
    out.push({ target: edge.to, at: here });
    if (visited.has(key)) return;
    visited.add(key);
    // 파생 구분자면 그 식이 읽는 자리도 이 문서가 읽는 것이다
    if (edge.to.kind === "discriminator" && graph.nodes.get(key)?.detail === "derived") {
      for (const e of referencesFrom(graph, edge.to, { via: ["expression"] })) expand(e, at, visited);
    }
  };
  for (const e of referencesFrom(graph, doc)) {
    if (e.via === "when" || e.via === "slot") expand(e, e.at, new Set());
    else if (e.via === "clauseRef") {
      for (const ce of referencesFrom(graph, e.to, { via: ["when", "slot"] })) expand(ce, e.at, new Set());
    }
  }
  return out;
}

function underOrSelf(graph: RefGraph, key: RefNodeKey, target: RefNodeKey): boolean {
  const t = nodeKey(target);
  let cur: RefNodeKey | undefined = key;
  for (let i = 0; cur !== undefined && i < 16; i++) {
    const k = nodeKey(cur);
    if (k === t) return true;
    cur = graph.nodes.get(k)?.parent ?? (cur.kind === "field" ? { kind: "discriminator", code: cur.code } : undefined);
  }
  return false;
}

/** 담보의 문서 노드들 (담보 1 : 문서 1 이지만 구조상 목록). */
function documentsOfCoverage(graph: RefGraph, coverageId: Id): RefNodeKey[] {
  const out: RefNodeKey[] = [];
  for (const n of graph.nodes.values()) if (n.key.kind === "document" && n.detail === "special" && n.ownerId === coverageId) out.push(n.key);
  return out;
}

function documentIdOf(key: RefNodeKey): Id | undefined {
  if (key.kind === "document") return key.id;
  if (key.kind === "article") return key.documentId;
  return undefined;
}

// ───────────────────────────── catalog: ImpactSource ─────────────────────────────

function impactKey(target: ImpactTarget): RefNodeKey {
  switch (target.kind) {
    case "discriminator":
      return { kind: "discriminator", code: target.code };
    case "field":
      return { kind: "field", code: target.code, fieldCode: target.fieldCode };
    case "enum":
      return { kind: "enum", enumCode: target.enumCode };
    case "enumValue":
      return { kind: "enumValue", enumCode: target.enumCode, valueCode: target.valueCode };
  }
}

export function catalogImpactSource(db: Db): ImpactSource {
  const values = valuesImpactSource(db);

  /** enum 을 타입으로 쓰는 값 자리 — enumReferences 의 refPath 를 자리로 푼다. */
  async function enumSlots(enumCode: Code): Promise<refsRepo.EnumSlot[]> {
    const defs = await catalogRepo.listDiscriminators(db);
    const listSlots = new Set<string>();
    for (const d of defs) {
      if (d.kind === "scalar" && d.type.kind === "list<enum>") listSlots.add(d.code);
      if (d.kind === "struct") for (const f of d.fields) if (f.type.kind === "list<enum>") listSlots.add(`${d.code}.${f.code}`);
    }
    return enumReferences(enumCode, defs).map((c) => {
      const [code, field] = (c.refPath ?? "").split(".");
      return { discriminatorCode: code, fieldCode: field ?? "", list: listSlots.has(c.refPath ?? "") };
    });
  }
  const slotTarget = (s: refsRepo.EnumSlot): ImpactTarget => (s.fieldCode ? { kind: "field", code: s.discriminatorCode, fieldCode: s.fieldCode } : { kind: "discriminator", code: s.discriminatorCode });

  return {
    async countValueRows(target) {
      switch (target.kind) {
        case "discriminator":
        case "field":
          return values.countValueRows(target);
        case "enum": {
          let n = 0;
          for (const s of await enumSlots(target.enumCode)) n += await values.countValueRows(slotTarget(s));
          return n;
        }
        case "enumValue":
          return refsRepo.countEnumValueRows(db, await enumSlots(target.enumCode), target.valueCode);
      }
    },
    async findBrokenRefs(target) {
      const graph = await loadGraph(db);
      // enum 정의 자체의 타입 참조(type)는 카탈로그 서비스가 enumReferences 로 직접 얹는다 — 여기서는 식·문면·부착만
      const via: EdgeVia[] = target.kind === "enum" || target.kind === "enumValue" ? [...REFERENCE_VIAS] : [...REFERENCE_VIAS, "attach"];
      return usagesOf(graph, impactKey(target), { via }).map((e) => e.at);
    },
    async purgeValueRows(target) {
      switch (target.kind) {
        case "discriminator":
        case "field":
          return values.purgeValueRows(target);
        case "enum":
          for (const s of await enumSlots(target.enumCode)) await values.purgeValueRows(slotTarget(s));
          return;
        case "enumValue":
          return refsRepo.purgeEnumValueRows(db, await enumSlots(target.enumCode), target.valueCode);
      }
    },
  };
}

// ───────────────────────────── coverage: UsageSource ─────────────────────────────

const LEVELS_BELOW: Record<"coverage" | "subCoverage" | "benefit", readonly string[]> = {
  coverage: ["coverage", "subCoverage", "benefit"],
  subCoverage: ["subCoverage", "benefit"],
  benefit: ["benefit"],
};

export function coverageUsageSource(db: Db): CoverageUsageSource {
  return {
    async findUsages(query: UsageQuery): Promise<Coordinate[]> {
      const graph = await loadGraph(db);
      const docs = documentsOfCoverage(graph, query.coverageId);
      if (query.kind === "detach") {
        const target: RefNodeKey = { kind: "discriminator", code: query.discriminatorCode };
        return docs.flatMap((d) => documentReads(graph, d).filter((r) => underOrSelf(graph, r.target, target)).map((r) => r.at));
      }
      if (query.node.level === "coverage") {
        // 담보 자체가 사라지면 그 문면 문서는 소유자를 잃고, 탑재한 상품담보는 마스터를 잃는다
        const out: Coordinate[] = docs.map((d) => {
          const info = graph.nodes.get(nodeKey(d))!;
          return { document: "special", ownerId: query.coverageId, ownerName: info.label };
        });
        for (const e of usagesOf(graph, { kind: "coverageNode", level: "coverage", id: query.coverageId }, { via: ["mount"] })) out.push(e.at);
        return out;
      }
      // 세부보장·급부 삭제 — 그 레벨(이하) 값 자리를 읽는 곳 (담보 문맥의 집계·조건식·슬롯)
      const levels = LEVELS_BELOW[query.node.level];
      return docs.flatMap((d) =>
        documentReads(graph, d)
          .filter((r) => {
            const level = graph.nodes.get(nodeKey(r.target))?.level;
            return level !== undefined && levels.includes(level);
          })
          .map((r) => r.at),
      );
    },
  };
}

// ───────────────────────────── clause: UsageSource ─────────────────────────────

export function clauseUsageSource(db: Db): ClauseUsageSource {
  return {
    async documentsReferencing(clauseCode: Code): Promise<Usage[]> {
      const graph = await loadGraph(db);
      const out: Usage[] = [];
      for (const e of usagesOf(graph, { kind: "clause", code: clauseCode }, { via: ["clauseRef"] })) {
        const documentId = documentIdOf(e.from);
        if (documentId === undefined) continue;
        const info = graph.nodes.get(nodeKey({ kind: "document", id: documentId }));
        const ownerKind: UsageOwnerKind = info?.detail === "special" ? "coverage" : "general";
        const refNodeId = e.at.nodePath?.at(-1);
        out.push({
          documentId,
          ownerKind,
          ownerId: info?.ownerId ?? documentId,
          ...(e.at.ownerName !== undefined ? { ownerName: e.at.ownerName } : {}),
          ...(refNodeId !== undefined ? { refNodeId } : {}),
          selection: e.options ?? {},
        });
      }
      return out;
    },
  };
}

// ───────────────────────────── document: UsageSource ─────────────────────────────

export function documentUsageSource(): DocumentUsageSource {
  return {
    async documentUsages(tx, documentId) {
      const graph = await loadGraph(tx);
      const out: Coordinate[] = [];
      for (const e of usagesOf(graph, { kind: "document", id: documentId })) {
        // 문서끼리의 참조(대응 보통약관 · 조연결 · 조 참조)는 문서 서비스가 스스로 훑는다 — 여기서는 다른 영역 것만
        if (e.from.kind === "product" || e.from.kind === "coverageNode") out.push(e.at);
      }
      for (const e of graph.edges) {
        if (e.via === "override" && e.through !== undefined && documentIdOf(e.through) === documentId) out.push(e.at);
      }
      return out;
    },
    async appendixUsages(tx, code) {
      const graph = await loadGraph(tx);
      return usagesOf(graph, { kind: "appendix", code }, { via: ["appendixRef"] })
        .filter((e) => e.from.kind === "clause")
        .map((e) => e.at);
    },
  };
}

// ───────────────────────────── product: AttributeRefSource ─────────────────────────────

export function attributeRefSource(db: Db): AttributeRefSource {
  return {
    async findExpressionRefs(kindCode, valueCode) {
      const graph = await loadGraph(db);
      const target: RefNodeKey = valueCode === undefined ? { kind: "attribute", code: kindCode } : { kind: "attributeValue", code: kindCode, valueCode };
      // 같은 식이 종류(attr.X)와 유효값(= 'V') 간선을 둘 다 내므로 좌표 기준으로 한 번만
      const seen = new Set<string>();
      return usagesOf(graph, target, { via: REFERENCE_VIAS })
        .map((e) => e.at)
        .filter((at) => {
          const k = JSON.stringify(at);
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
    },
  };
}
