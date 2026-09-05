/**
 * 조립 서비스 — 상품 하나의 재료를 서비스 조회 메서드로 읽어 `AssemblyInput` 을 만들고 순수 조립기(`assemble`)를 돌린다.
 *
 *   loadAssemblyInput(productId)          재료 로드 (상품 · 상품담보 스냅샷/값/부착 · 담보약관 · 보통약관 · 공용조항 · 별표 · 카탈로그 · 담보속성 · 그룹 · 오버라이드)
 *   preview(productId)                    책자 조립 (매번 재계산 · 저장 없음)
 *   previewSpecial(productId, pcId)       상품담보 미리보기 (담보약관 하나를 그 탑재분 문맥으로)
 *   executionBasedFilter(booklet)         실행 기반 완결성 필터 (도메인 re-export) — B1 `CoverageServiceDeps.completenessFilter` 에 꽂는다
 *
 * - 읽기 전용이다 — 트랜잭션을 열지 않고 스냅샷 구조 동기화(`product.syncStructure`)도 부르지 않는다
 *   (미리보기가 DB 를 바꾸지 않는다). 마스터 구조가 바뀐 상품담보는 상품모델링 화면이 조회 전에 sync 한다.
 * - 값 저장소 접근은 `readSlotsMany` / `listAttached` (공용 값 repo 읽기), 기본계약은 `listBaseContractIds` (product repo 읽기).
 *   서비스 조회 메서드에 없는 두 항목만 repo 로 직접 읽는다.
 * - 컨테이너(C1 동시 작업)는 쓰지 않는다 — 호출자가 서비스 5개를 넘긴다.
 */
import { assemble, assembleSpecial, type AssemblyCoverage, type AssemblyInput, type Booklet, type SpecialPreview } from "@/domain/assembly";
import type { SlotPath } from "@/domain/catalog";
import type { DocumentNode } from "@/domain/document";
import type { Code, Id, Result, ValueSlot } from "@/domain/types";
import { ok, reject } from "@/domain/types";

import { listBaseContractIds } from "@/db/repo/product";
import type { Db } from "@/db/repo/types";
import { listAttached, readSlotsMany, type ValueOwner } from "@/db/repo/values";
import type { CatalogService } from "./catalog";
import type { ClauseService } from "./clause";
import type { CoverageService } from "./coverage";
import type { DocumentService } from "./document";
import type { ProductService } from "./product";

export { executionBasedFilter } from "@/domain/assembly";
export type { AssemblyInput, Booklet, SpecialPreview } from "@/domain/assembly";

export interface AssemblyServices {
  catalog: CatalogService;
  coverage: CoverageService;
  clause: ClauseService;
  document: DocumentService;
  product: ProductService;
}

export interface AssemblyService {
  loadAssemblyInput(productId: Id): Promise<Result<AssemblyInput>>;
  preview(productId: Id): Promise<Result<Booklet>>;
  previewSpecial(productId: Id, productCoverageId: Id): Promise<Result<SpecialPreview>>;
}

export function createAssemblyService(db: Db, services: AssemblyServices): AssemblyService {
  const { catalog, clause, document, product } = services;

  async function attachedOf(owners: readonly ValueOwner[]): Promise<Map<Id, ReadonlySet<Code>>> {
    const out = new Map<Id, ReadonlySet<Code>>();
    for (const o of owners) out.set(o.id, new Set(await listAttached(db, o)));
    return out;
  }

  async function loadCoverage(pcId: Id, groupOf: ReadonlyMap<Id, Id>): Promise<Result<AssemblyCoverage>> {
    const snap = await product.getSnapshot(pcId);
    if (!snap.ok) return snap as Result<never>;
    const s = snap.value;
    const subs = s.subCoverages.map((x) => x.id);
    const bens = s.subCoverages.flatMap((x) => x.benefits.map((b) => b.id));
    const [cov, sub, ben] = await Promise.all([readSlotsMany(db, "productCoverage", [s.id]), readSlotsMany(db, "productSubCoverage", subs), readSlotsMany(db, "productBenefit", bens)]);
    const values = new Map<Id, ReadonlyMap<SlotPath, ValueSlot>>([...cov, ...sub, ...ben]);
    const owners: ValueOwner[] = [
      { kind: "productCoverage", id: s.id },
      ...subs.map<ValueOwner>((id) => ({ kind: "productSubCoverage", id })),
      ...bens.map<ValueOwner>((id) => ({ kind: "productBenefit", id })),
    ];
    const groupId = groupOf.get(s.id);
    return ok({
      snapshot: s,
      values,
      attached: await attachedOf(owners),
      plans: await product.listAttachedPlans(s.id),
      overrides: await product.listOptionOverrides({ kind: "productCoverage", id: s.id }),
      ...(groupId !== undefined ? { groupId } : {}),
    });
  }

  async function load(productId: Id): Promise<Result<AssemblyInput>> {
    const p = await product.getProduct(productId);
    if (!p) return reject({ reason: "notFound", what: `상품 ${productId}` });

    const general = p.generalDocumentId ? await document.get(p.generalDocumentId) : undefined;
    const baseContractIds = await listBaseContractIds(db, productId);
    const baseContractId = baseContractIds.length === 1 ? baseContractIds[0] : undefined; // 0개·2개 이상 = 미지정 (검증은 product.checkBaseContract)

    const groupViews = await product.listGroups(productId);
    const groupOf = new Map<Id, Id>();
    for (const g of groupViews) for (const m of g.members) groupOf.set(m.id, g.id);

    const coverages: AssemblyCoverage[] = [];
    for (const pc of await product.listProductCoverages(productId)) {
      const c = await loadCoverage(pc.id, groupOf);
      if (!c.ok) return c as Result<never>;
      coverages.push(c.value);
    }

    const specialDocuments = new Map<Id, DocumentNode>();
    for (const coverageId of new Set(coverages.map((c) => c.snapshot.coverageId))) {
      const doc = await document.findByCoverage(coverageId);
      if (doc) specialDocuments.set(coverageId, doc.tree);
    }

    const [productValues, productAttached, clauses, appendices, defs, enums, attributeKinds, productOverrides] = await Promise.all([
      product.getProductValues(productId),
      listAttached(db, { kind: "product", id: productId }),
      clause.list(),
      document.listAppendices(),
      catalog.list(),
      catalog.listEnums(),
      product.listAttributeKinds(),
      product.listOptionOverrides({ kind: "product", id: productId }),
    ]);

    return ok({
      product: {
        id: p.id,
        name: p.name,
        values: productValues,
        attached: new Set(productAttached),
        ...(baseContractId !== undefined ? { baseContractId } : {}),
        ...(general ? { general: general.tree, generalDocumentId: general.id } : {}),
        overrides: productOverrides,
      },
      coverages,
      specialDocuments,
      clauses,
      appendices,
      catalog: defs,
      enums,
      attributeKinds,
      groups: groupViews.map(({ members: _m, ...g }) => {
        void _m;
        return g;
      }),
    });
  }

  return {
    loadAssemblyInput: load,
    preview: async (productId) => {
      const input = await load(productId);
      return input.ok ? ok(assemble(input.value)) : (input as Result<never>);
    },
    previewSpecial: async (productId, productCoverageId) => {
      const input = await load(productId);
      return input.ok ? assembleSpecial(input.value, productCoverageId) : (input as Result<never>);
    },
  };
}
