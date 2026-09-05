/**
 * 상품·탑재 서비스 — 모든 쓰기의 진입점. actor 검사 · 도메인 규칙 · repo 호출 · 트랜잭션.
 *
 * - 비파괴 액션(채번 · 표시명 · 작명 규칙 · 순서 · 상품 생성 · 값 입력 · 선택지 · 조합 등록 · 탑재 ·
 *   세목 부착 · 기본계약 지정/해제 · 그룹 · 오버라이드)은 editor 도 가능.
 * - 파괴적 액션은 `destructive()` 2단 (ADR-0019): editor → forbidden · admin 1차 → needsConfirmation(Impact) ·
 *   `{ confirm: true }` → 실행. 여기서 쓰는 액션: `product.delete` · `product.unmount` · `product.detachPlan`
 *   (세목 부착 해제 · 유효 조합 삭제 · 선택지 삭제 — 셋 다 「세목 조합 제거」 결) · `attribute.delete` · `attribute.deleteValue`.
 * - 값(상품 레벨 · 세목 유형 값 · 스냅샷)은 공용 값 저장소(`db/repo/values`)에. 스냅샷은 탑재 순간
 *   마스터 owner(coverage/subCoverage/benefit) → 스냅샷 owner(productCoverage/productSubCoverage/productBenefit) `copySlots` (ADR-0002).
 * - 다른 영역은 주입: `CoverageMasterSource`(B1 트리) · `GeneralDocumentGate`(B3 존재) · `GeneralAttachmentCheck`(B2/B3 요구 참조) ·
 *   `OptionValidator`(B2 옵션 집합) · `AttributeRefSource`(C1 식 참조). 기본 구현은 「없음/통과」.
 */
import { destructive, type DestructiveAction } from "@/domain/auth";
import { isValued, slotPath, slotType, validateValue, type Discriminator, type SlotPath } from "@/domain/catalog";
import {
  addAttributeValue,
  checkGeneralAttachment,
  combinationKey,
  createAttributeKind,
  defaultCoverageName,
  diffStructure,
  exposedDiscriminators,
  missingSlotsOf,
  normalizeSelections,
  planCombinationKey,
  planCombinationLabel,
  planOptionLabel,
  removeAttributeValue,
  renameAttributeKind,
  renameAttributeValue,
  reorderAttributeKinds,
  reorderAttributeValues,
  setNamingRule,
  sortInGroup,
  validateGroupTemplate,
  validateNewPlanOption,
  validatePlanCombination,
  validatePlanType,
  validateSelections,
  type AttributeKind,
  type AttributeRefSource,
  type AttributeSelection,
  type BaseContractCheck,
  type ClauseOptionOverride,
  type ClauseOptionSelection,
  type CoverageMasterSource,
  type GeneralAttachmentCheck,
  type GeneralDocumentGate,
  type MissingSlot,
  type NamingRule,
  type NewAttributeKind,
  type NewAttributeValue,
  type NewPlanOption,
  type NewProduct,
  type NewSpecialGroup,
  type OptionValidator,
  type PlanOption,
  type Product,
  type ProductCoverage,
  type ProductCoverageSnapshot,
  type ProductPlan,
  type SnapshotNode,
  type SpecialGroup,
} from "@/domain/product";
import type { Actor, AttachLevel, Code, Coordinate, Id, Impact, Issue, Result, Value, ValueSlot } from "@/domain/types";
import { ok, reject } from "@/domain/types";

import * as catalog from "@/db/repo/catalog";
import * as repo from "@/db/repo/product";
import type { Db } from "@/db/repo/types";
import { attach, clearOwner, copySlots, listAttached, readSlots, writeSlot, type ValueOwner } from "@/db/repo/values";

// ───────────────────────────── 계약 ─────────────────────────────

export interface ProductServiceDeps {
  /** 담보 마스터 트리 (B1). 필수 — 없으면 탑재가 notFound. */
  coverageMaster?: CoverageMasterSource;
  /** 보통약관 템플릿 존재 게이트 (B3). 기본: 모두 존재. */
  generalDocuments?: GeneralDocumentGate;
  /** 보통약관이 요구하는 담보 레벨 참조 (B2/B3). 기본: 없음 → 부착 검사 통과. */
  generalAttachment?: GeneralAttachmentCheck;
  /** 공용조항 옵션 유효 집합 (B2). 기본: 모두 유효. */
  optionValidator?: OptionValidator;
  /** 담보속성의 식 참조 사용처 (C1). 기본: 없음. */
  attributeRefs?: AttributeRefSource;
}

export interface Confirmable {
  confirm?: boolean;
}

export type SnapshotOwner = { kind: "productCoverage" | "productSubCoverage" | "productBenefit"; id: Id };
export type OverrideScope = ClauseOptionOverride["scope"];
export type SpecialGroupView = SpecialGroup & { members: ProductCoverage[] };
export interface SyncResult {
  added: number;
  removed: number;
  updated: number;
}

export interface ProductService {
  // ── 담보속성 카탈로그
  listAttributeKinds(): Promise<AttributeKind[]>;
  getAttributeKind(code: Code): Promise<AttributeKind | undefined>;
  createAttributeKind(actor: Actor, input: NewAttributeKind): Promise<Result<AttributeKind>>;
  renameAttributeKind(actor: Actor, code: Code, label: string): Promise<Result<AttributeKind>>;
  reorderAttributeKinds(actor: Actor, order: Code[]): Promise<Result<AttributeKind[]>>;
  addAttributeValue(actor: Actor, code: Code, input: NewAttributeValue): Promise<Result<AttributeKind>>;
  renameAttributeValue(actor: Actor, code: Code, valueCode: Code, label: string): Promise<Result<AttributeKind>>;
  setNamingRule(actor: Actor, code: Code, valueCode: Code, rule: NamingRule): Promise<Result<AttributeKind>>;
  reorderAttributeValues(actor: Actor, code: Code, order: Code[]): Promise<Result<AttributeKind>>;
  removeAttributeValue(actor: Actor, code: Code, valueCode: Code, opts?: Confirmable): Promise<Result<AttributeKind>>;
  removeAttributeKind(actor: Actor, code: Code, opts?: Confirmable): Promise<Result<void>>;
  /** 사용처 — 이 속성(값)을 조합에 쓰는 상품담보 + 식 참조. */
  attributeUsage(code: Code, valueCode?: Code): Promise<Coordinate[]>;

  // ── 상품
  listProducts(): Promise<Product[]>;
  getProduct(id: Id): Promise<Product | undefined>;
  productAudit(id: Id): ReturnType<typeof repo.productAudit>;
  createProduct(actor: Actor, input: NewProduct): Promise<Result<Product>>;
  renameProduct(actor: Actor, id: Id, name: string): Promise<Result<Product>>;
  /** 보통약관 템플릿 선택·교체·해제(undefined). 상품 오버라이드가 남아 있으면 교체 거부 (D-P5-2 결). */
  setGeneralDocument(actor: Actor, id: Id, generalDocumentId: Id | undefined): Promise<Result<Product>>;
  deleteProduct(actor: Actor, id: Id, opts?: Confirmable): Promise<Result<void>>;
  attachProductDiscriminator(actor: Actor, id: Id, code: Code): Promise<Result<void>>;
  setProductValue(actor: Actor, id: Id, code: Code, fieldCode: Code | undefined, value: Value | undefined): Promise<Result<void>>;
  getProductValues(id: Id): Promise<Map<SlotPath, ValueSlot>>;
  productMissing(id: Id): Promise<MissingSlot[]>;

  // ── 세목
  listPlanOptions(productId: Id): Promise<PlanOption[]>;
  addPlanOption(actor: Actor, productId: Id, input: NewPlanOption): Promise<Result<PlanOption>>;
  updatePlanOption(actor: Actor, optionId: Id, patch: { number?: number; name?: string }): Promise<Result<PlanOption>>;
  removePlanOption(actor: Actor, optionId: Id, opts?: Confirmable): Promise<Result<void>>;
  setPlanOptionValue(actor: Actor, optionId: Id, code: Code, fieldCode: Code | undefined, value: Value | undefined): Promise<Result<void>>;
  getPlanOptionValues(optionId: Id): Promise<Map<SlotPath, ValueSlot>>;
  listPlans(productId: Id): Promise<ProductPlan[]>;
  registerPlan(actor: Actor, productId: Id, optionIds: Id[]): Promise<Result<ProductPlan>>;
  removePlan(actor: Actor, planId: Id, opts?: Confirmable): Promise<Result<void>>;

  // ── 상품담보 = 탑재
  mount(actor: Actor, productId: Id, coverageId: Id, selections: AttributeSelection[]): Promise<Result<ProductCoverage>>;
  getProductCoverage(id: Id): Promise<ProductCoverage | undefined>;
  listProductCoverages(productId: Id): Promise<ProductCoverage[]>;
  getSnapshot(id: Id): Promise<Result<ProductCoverageSnapshot>>;
  /** owner id(상품담보 id · 노드 id) → 값 자리. */
  getSnapshotValues(id: Id): Promise<Map<Id, Map<SlotPath, ValueSlot>>>;
  setSnapshotValue(actor: Actor, id: Id, owner: SnapshotOwner, code: Code, fieldCode: Code | undefined, value: Value | undefined): Promise<Result<void>>;
  renameProductCoverage(actor: Actor, id: Id, name: string): Promise<Result<ProductCoverage>>;
  regenerateName(actor: Actor, id: Id): Promise<Result<ProductCoverage>>;
  setAttributes(actor: Actor, id: Id, selections: AttributeSelection[], opts?: { regenerateName?: boolean }): Promise<Result<ProductCoverage>>;
  /** 마스터 트리와 대조 — 없는 노드 추가(빈 값) · 사라진 노드 값 삭제. 조회·조립 전에 호출. */
  syncStructure(id: Id): Promise<Result<SyncResult>>;
  unmount(actor: Actor, id: Id, opts?: Confirmable): Promise<Result<void>>;
  coverageMissing(id: Id): Promise<MissingSlot[]>;
  attachPlan(actor: Actor, id: Id, planId: Id): Promise<Result<void>>;
  detachPlan(actor: Actor, id: Id, planId: Id, opts?: Confirmable): Promise<Result<void>>;
  listAttachedPlans(id: Id): Promise<ProductPlan[]>;

  // ── 기본계약
  designateBaseContract(actor: Actor, productId: Id, productCoverageId: Id): Promise<Result<BaseContractCheck>>;
  releaseBaseContract(actor: Actor, productId: Id, productCoverageId: Id): Promise<Result<void>>;
  /** 「정확히 1개」 검증 + 부착 검사. 0개 → invalid(noBaseContract). */
  checkBaseContract(productId: Id): Promise<Result<BaseContractCheck[]>>;

  // ── 특약 그룹
  listGroups(productId: Id): Promise<SpecialGroupView[]>;
  createGroup(actor: Actor, productId: Id, input: NewSpecialGroup): Promise<Result<SpecialGroup>>;
  renameGroup(actor: Actor, groupId: Id, title: string): Promise<Result<SpecialGroup>>;
  reorderGroups(actor: Actor, productId: Id, order: Id[]): Promise<Result<SpecialGroup[]>>;
  deleteGroup(actor: Actor, groupId: Id): Promise<Result<void>>;
  placeInGroup(actor: Actor, groupId: Id, productCoverageId: Id): Promise<Result<void>>;
  removeFromGroup(actor: Actor, productCoverageId: Id): Promise<Result<void>>;
  listUnplaced(productId: Id): Promise<ProductCoverage[]>;

  // ── 옵션 오버라이드
  setOptionOverride(actor: Actor, scope: OverrideScope, nodeId: Id, clauseCode: Code, options: ClauseOptionSelection): Promise<Result<ClauseOptionOverride>>;
  listOptionOverrides(scope: OverrideScope): Promise<ClauseOptionOverride[]>;
  removeOptionOverride(actor: Actor, scope: OverrideScope, nodeId: Id, clauseCode: Code): Promise<Result<void>>;
}

// ───────────────────────────── 구현 ─────────────────────────────

const LEVEL_OF: Record<ValueOwner["kind"], AttachLevel> = {
  product: "product",
  plan: "plan",
  coverage: "coverage",
  subCoverage: "subCoverage",
  benefit: "benefit",
  productCoverage: "coverage",
  productSubCoverage: "subCoverage",
  productBenefit: "benefit",
  productPlan: "plan",
};

const NO_MASTER: CoverageMasterSource = { tree: async () => undefined };

function notFound<T>(what: string): Result<T> {
  return reject({ reason: "notFound", what });
}
function invalid<T>(issues: Issue[]): Result<T> {
  return reject({ reason: "invalid", issues });
}
function issue(kind: Issue["kind"], message: string, at: Coordinate = {}): Issue {
  return { kind, message, at };
}
function cleanName(name: unknown): string | undefined {
  const t = typeof name === "string" ? name.trim() : "";
  return t.length > 0 ? t : undefined;
}

export function createProductService(db: Db, deps: ProductServiceDeps = {}): ProductService {
  const master = deps.coverageMaster ?? NO_MASTER;
  const gate = deps.generalDocuments ?? { exists: async () => true };
  const attachment = deps.generalAttachment ?? { requiredRefs: async () => [] };
  const optionValidator = deps.optionValidator ?? { validate: async () => [] };
  const attributeRefs = deps.attributeRefs ?? { findExpressionRefs: async () => [] };

  // ── 공통 헬퍼

  async function catalogDefs(tx: Db): Promise<{ defs: Discriminator[]; findEnum: Parameters<typeof validateValue>[2] }> {
    const [defs, enums] = await Promise.all([catalog.listDiscriminators(tx), catalog.listEnums(tx)]);
    const byCode = new Map(enums.map((e) => [e.code, e]));
    return { defs, findEnum: (c) => byCode.get(c) };
  }

  /**
   * 값 자리 쓰기 (검증 포함) — 정의 존재 · 레벨 일치 · 노출(무조건 ∨ 부착 ∨ extra) · 자리 존재 · 타입.
   * `value === undefined` 는 미입력으로 되돌리기 (D-P5-15).
   */
  async function writeChecked(
    tx: Db,
    actor: Actor,
    owner: ValueOwner,
    extraExposed: readonly Code[],
    code: Code,
    fieldCode: Code | undefined,
    value: Value | undefined,
  ): Promise<Result<void>> {
    const def = await catalog.loadDiscriminator(tx, code);
    if (!def) return notFound(`구분자 ${code}`);
    const level = LEVEL_OF[owner.kind];
    if (!isValued(def)) return invalid([issue("typeMismatch", `구분자 ${code} 은(는) 값 자리가 없습니다 (${def.kind})`, { refPath: code })]);
    if (def.level !== level) return invalid([issue("typeMismatch", `구분자 ${def.label}(${code}) 은(는) ${def.level} 레벨 — ${level} 실체에 쓸 수 없습니다`, { refPath: code })]);
    const attached = await listAttached(tx, owner);
    if (!def.alwaysExposed && !attached.includes(code) && !extraExposed.includes(code)) {
      return invalid([issue("notAttached", `구분자 ${def.label}(${code}) 이(가) 이 실체에 부착돼 있지 않습니다`, { refPath: code })]);
    }
    const path = slotPath(code, fieldCode);
    const type = slotType(def, path);
    if (!type) return invalid([issue("brokenRef", `값 자리 ${path} 이(가) 없습니다`, { refPath: path })]);
    if (value !== undefined) {
      const { findEnum } = await catalogDefs(tx);
      const issues = validateValue(type, value, findEnum, { refPath: path });
      if (issues.length > 0) return invalid(issues);
    }
    await writeSlot(tx, owner, code, fieldCode, value, actor.userId);
    return ok(undefined);
  }

  async function withProduct<T>(tx: Db, id: Id, fn: (p: Product) => Promise<Result<T>>): Promise<Result<T>> {
    const p = await repo.loadProduct(tx, id);
    return p ? fn(p) : notFound(`상품 ${id}`);
  }
  async function withCoverage<T>(tx: Db, id: Id, fn: (pc: ProductCoverage) => Promise<Result<T>>): Promise<Result<T>> {
    const pc = await repo.loadProductCoverage(tx, id);
    return pc ? fn(pc) : notFound(`상품담보 ${id}`);
  }
  async function withKind<T>(tx: Db, code: Code, fn: (k: AttributeKind, all: AttributeKind[]) => Promise<Result<T>> | Result<T>): Promise<Result<T>> {
    const all = await repo.listAttributeKinds(tx);
    const k = all.find((x) => x.code === code);
    return k ? fn(k, all) : notFound(`담보속성 종류 ${code}`);
  }
  function editKind(actor: Actor, code: Code, change: (k: AttributeKind, all: AttributeKind[], tx: Db) => Promise<Result<AttributeKind>> | Result<AttributeKind>) {
    return db.transaction((tx) =>
      withKind(tx, code, async (k, all) => {
        const r = await change(k, all, tx); // 채번 등 tx 안 쿼리는 반드시 tx 로 (PGlite 단일 연결 — db 로 치면 교착)
        if (r.ok) await repo.saveAttributeKind(tx, r.value, actor.userId);
        return r;
      }),
    );
  }

  /** 스냅샷 실체 owner 목록 (상품담보 + 노드). */
  async function snapshotOwners(tx: Db, pcId: Id): Promise<{ owner: SnapshotOwner; node?: SnapshotNode }[]> {
    const nodes = await repo.listNodes(tx, pcId);
    return [
      { owner: { kind: "productCoverage", id: pcId } },
      ...nodes.map((n) => ({ owner: { kind: n.kind === "sub" ? "productSubCoverage" : "productBenefit", id: n.id } as SnapshotOwner, node: n })),
    ];
  }

  async function countSlots(tx: Db, owners: readonly ValueOwner[]): Promise<number> {
    let n = 0;
    for (const o of owners) n += (await readSlots(tx, o)).size;
    return n;
  }

  /** 마스터 실체 → 스냅샷 실체 값·부착 복사 (ADR-0002). */
  async function snapshotFrom(tx: Db, from: { kind: "coverage" | "subCoverage" | "benefit"; id: Id }, to: SnapshotOwner, who: Id): Promise<void> {
    if (master.masterSlots) {
      const slots = await master.masterSlots(from);
      for (const [path, slot] of slots) {
        if (!slot.entered) continue;
        const [code, field] = path.split(".");
        await writeSlot(tx, to, code, field || undefined, slot.value, who);
      }
    } else {
      await copySlots(tx, from, to, who);
    }
    for (const code of await listAttached(tx, from)) await attach(tx, to, code, who);
  }

  /** actor 없는 동기화(조회·조립 전 호출) — 노드 감사 컬럼은 비운다. */
  async function syncStructureIn(tx: Db, pc: ProductCoverage, who?: Id): Promise<Result<SyncResult>> {
    const tree = await master.tree(pc.coverageId);
    if (!tree) return notFound(`담보 마스터 ${pc.coverageId}`);
    const nodes = await repo.listNodes(tx, pc.id);
    const diff = diffStructure(tree, nodes);
    const snapIdOf = new Map(nodes.map((n) => [n.masterNodeId, n.id]));
    for (const n of diff.add) {
      const parentId = n.parentMasterId ? snapIdOf.get(n.parentMasterId) : undefined;
      const row = await repo.insertNode(tx, { productCoverageId: pc.id, kind: n.kind, masterNodeId: n.masterNodeId, parentId, name: n.name, order: n.order }, who);
      snapIdOf.set(n.masterNodeId, row.id);
    }
    for (const n of diff.remove) await clearOwner(tx, { kind: n.kind === "sub" ? "productSubCoverage" : "productBenefit", id: n.id });
    await repo.deleteNodes(tx, diff.remove.map((n) => n.id));
    for (const u of diff.update) await repo.updateNode(tx, u.id, { name: u.name, order: u.order }, who);
    return ok({ added: diff.add.length, removed: diff.remove.length, updated: diff.update.length });
  }

  async function snapshotOf(tx: Db, pc: ProductCoverage): Promise<ProductCoverageSnapshot> {
    const nodes = await repo.listNodes(tx, pc.id);
    const subs = nodes.filter((n) => n.kind === "sub");
    return {
      ...pc,
      coverageName: (await repo.coverageNameOf(tx, pc.id)) ?? "",
      subCoverages: subs.map((s) => ({ ...s, benefits: nodes.filter((b) => b.kind === "benefit" && b.parentId === s.id) })),
    };
  }

  async function exposedByLevel(tx: Db, pcId: Id, defs: Discriminator[]) {
    const owners = await snapshotOwners(tx, pcId);
    const out = { coverage: new Set<Code>(), subCoverage: new Set<Code>(), benefit: new Set<Code>() };
    for (const { owner } of owners) {
      const level = LEVEL_OF[owner.kind] as keyof typeof out;
      for (const d of exposedDiscriminators(level, defs, await listAttached(tx, owner))) out[level].add(d.code);
    }
    return { coverage: [...out.coverage], subCoverage: [...out.subCoverage], benefit: [...out.benefit] };
  }

  async function checkOne(tx: Db, product: Product, pc: ProductCoverage): Promise<Result<BaseContractCheck>> {
    if (!product.generalDocumentId) return invalid([issue("brokenRef", "보통약관 템플릿이 선택되지 않았습니다", { document: "product", ownerId: product.id })]);
    const { defs } = await catalogDefs(tx);
    const required = await attachment.requiredRefs(product.generalDocumentId);
    const exposed = await exposedByLevel(tx, pc.id, defs);
    return ok({ productCoverageId: pc.id, issues: checkGeneralAttachment(required, exposed, { id: pc.id, name: pc.name }) });
  }

  async function groupViews(tx: Db, productId: Id): Promise<SpecialGroupView[]> {
    const [groups, members, coverages, kinds] = await Promise.all([repo.listGroups(tx, productId), repo.listMembersByGroup(tx, productId), repo.listProductCoverages(tx, productId), repo.listAttributeKinds(tx)]);
    const byId = new Map(coverages.map((c) => [c.id, c]));
    // 담보 순서 = 탑재 시점 담보명 순 (B1 마스터 순서는 통합 때 어댑터로 바꿀 수 있다)
    const nameOf = new Map<Id, string>();
    for (const c of coverages) if (!nameOf.has(c.coverageId)) nameOf.set(c.coverageId, (await repo.coverageNameOf(tx, c.id)) ?? "");
    const names = [...new Set(nameOf.values())].sort((a, b) => a.localeCompare(b));
    const coverageOrder = (id: Id) => names.indexOf(nameOf.get(id) ?? "");
    return groups.map((g) => ({
      ...g,
      members: sortInGroup((members.get(g.id) ?? []).map((id) => byId.get(id)).filter((c): c is ProductCoverage => !!c), kinds, coverageOrder),
    }));
  }

  /** 세목 관련 파괴적 액션 공통 (product.detachPlan). */
  function planDestructive(actor: Actor, opts: Confirmable, precheck: (tx: Db) => Promise<Result<void>>, impact: (tx: Db) => Promise<Impact>, execute: (tx: Db) => Promise<void>) {
    return db.transaction((tx) =>
      destructive<void>({
        actor,
        action: "product.detachPlan",
        confirm: opts.confirm,
        precheck: () => precheck(tx),
        computeImpact: () => impact(tx),
        execute: async () => {
          await execute(tx);
          return ok(undefined);
        },
      }),
    );
  }

  function attributeDestructive<T>(actor: Actor, action: DestructiveAction, opts: Confirmable, code: Code, valueCode: Code | undefined, run: (tx: Db, kind: AttributeKind) => Promise<Result<T>>) {
    return db.transaction(async (tx) => {
      let loaded: AttributeKind | undefined;
      return destructive<T>({
        actor,
        action,
        confirm: opts.confirm,
        precheck: () =>
          withKind(tx, code, (k) => {
            if (valueCode && !k.values.some((v) => v.code === valueCode)) return notFound(`담보속성 유효값 ${valueCode}`);
            loaded = k;
            return ok(undefined);
          }),
        computeImpact: async () => ({
          valueRowsLost: 0,
          brokenRefs: await usage(tx, code, valueCode),
          cascade: valueCode ? [] : loaded!.values.map((v) => `값 ${v.label}(${v.code})`),
        }),
        execute: () => run(tx, loaded!),
      });
    });
  }

  async function usage(tx: Db, code: Code, valueCode?: Code): Promise<Coordinate[]> {
    const covs = await repo.listCoveragesUsingAttribute(tx, code, valueCode);
    return [...covs.map<Coordinate>((c) => ({ document: "special", ownerId: c.id, ownerName: c.name })), ...(await attributeRefs.findExpressionRefs(code, valueCode))];
  }

  // ── 서비스

  return {
    // 담보속성
    listAttributeKinds: () => repo.listAttributeKinds(db),
    getAttributeKind: (code) => repo.loadAttributeKind(db, code),
    createAttributeKind: (actor, input) =>
      db.transaction(async (tx) => {
        const r = await createAttributeKind(input, await repo.listAttributeKinds(tx), repo.attributeSeqSource(tx));
        if (r.ok) await repo.insertAttributeKind(tx, r.value, actor.userId);
        return r;
      }),
    renameAttributeKind: (actor, code, label) => editKind(actor, code, (k, all) => renameAttributeKind(k, label, all)),
    reorderAttributeKinds: (actor, order) =>
      db.transaction(async (tx) => {
        const r = reorderAttributeKinds(await repo.listAttributeKinds(tx), order);
        if (r.ok) await repo.saveAttributeKindOrders(tx, r.value, actor.userId);
        return r;
      }),
    addAttributeValue: (actor, code, input) => editKind(actor, code, (k, _all, tx) => addAttributeValue(k, input, repo.attributeSeqSource(tx))),
    renameAttributeValue: (actor, code, valueCode, label) => editKind(actor, code, (k) => renameAttributeValue(k, valueCode, label)),
    setNamingRule: (actor, code, valueCode, rule) => editKind(actor, code, (k) => setNamingRule(k, valueCode, rule)),
    reorderAttributeValues: (actor, code, order) => editKind(actor, code, (k) => reorderAttributeValues(k, order)),
    removeAttributeValue: (actor, code, valueCode, opts = {}) =>
      attributeDestructive(actor, "attribute.deleteValue", opts, code, valueCode, async (tx, kind) => {
        const r = removeAttributeValue(kind, valueCode);
        if (r.ok) await repo.saveAttributeKind(tx, r.value, actor.userId);
        return r;
      }),
    removeAttributeKind: (actor, code, opts = {}) =>
      attributeDestructive(actor, "attribute.delete", opts, code, undefined, async (tx) => {
        await repo.deleteAttributeKind(tx, code); // 상품담보의 조합 행은 남아 깨진 참조가 된다 (오류화)
        return ok(undefined);
      }),
    attributeUsage: (code, valueCode) => usage(db, code, valueCode),

    // 상품
    listProducts: () => repo.listProducts(db),
    getProduct: (id) => repo.loadProduct(db, id),
    productAudit: (id) => repo.productAudit(db, id),
    createProduct: (actor, input) =>
      db.transaction(async (tx) => {
        const name = cleanName(input.name);
        if (!name) return invalid([issue("typeMismatch", "상품명은 비울 수 없습니다")]);
        if (await repo.findProductByName(tx, name)) return reject({ reason: "duplicate", what: `상품명 ${name}` });
        if (input.generalDocumentId && !(await gate.exists(input.generalDocumentId))) return notFound(`보통약관 템플릿 ${input.generalDocumentId}`);
        return ok(await repo.insertProduct(tx, { name, generalDocumentId: input.generalDocumentId }, actor.userId));
      }),
    renameProduct: (actor, id, name) =>
      db.transaction((tx) =>
        withProduct(tx, id, async (p) => {
          const clean = cleanName(name);
          if (!clean) return invalid([issue("typeMismatch", "상품명은 비울 수 없습니다", { document: "product", ownerId: id })]);
          const dup = await repo.findProductByName(tx, clean);
          if (dup && dup.id !== id) return reject({ reason: "duplicate", what: `상품명 ${clean}` });
          await repo.updateProduct(tx, id, { name: clean }, actor.userId);
          return ok({ ...p, name: clean });
        }),
      ),
    setGeneralDocument: (actor, id, generalDocumentId) =>
      db.transaction((tx) =>
        withProduct(tx, id, async (p) => {
          if (generalDocumentId && !(await gate.exists(generalDocumentId))) return notFound(`보통약관 템플릿 ${generalDocumentId}`);
          if (p.generalDocumentId && p.generalDocumentId !== generalDocumentId) {
            const overrides = await repo.listOverrides(tx, { kind: "product", id });
            if (overrides.length > 0) {
              return invalid([issue("optionInvalid", `이전 템플릿 기준 옵션 오버라이드 ${overrides.length}건이 남아 있습니다 — 먼저 제거하세요`, { document: "product", ownerId: id })]);
            }
          }
          await repo.updateProduct(tx, id, { generalDocumentId: generalDocumentId ?? null }, actor.userId);
          const { generalDocumentId: _old, ...rest } = p;
          void _old;
          return ok(generalDocumentId ? { ...rest, generalDocumentId } : rest);
        }),
      ),
    deleteProduct: (actor, id, opts = {}) =>
      db.transaction(async (tx) => {
        let owners: ValueOwner[] = [];
        let cascade: string[] = [];
        let coverages: ProductCoverage[] = [];
        return destructive<void>({
          actor,
          action: "product.delete",
          confirm: opts.confirm,
          precheck: () =>
            withProduct(tx, id, async () => {
              coverages = await repo.listProductCoverages(tx, id);
              const options = await repo.listPlanOptions(tx, id);
              const groups = await repo.listGroups(tx, id);
              owners = [{ kind: "product", id }, ...options.map<ValueOwner>((o) => ({ kind: "plan", id: o.id }))];
              for (const c of coverages) owners.push(...(await snapshotOwners(tx, c.id)).map((s) => s.owner));
              cascade = [...coverages.map((c) => `상품담보 ${c.name}`), ...options.map((o) => `세목 선택지 ${planOptionLabel(o)}`), ...groups.map((g) => `그룹 ${g.title}`)];
              return ok(undefined);
            }),
          computeImpact: async () => ({ valueRowsLost: await countSlots(tx, owners), brokenRefs: [], cascade }),
          execute: async () => {
            for (const o of owners) await clearOwner(tx, o);
            await repo.deleteOverridesOf(tx, { kind: "product", id });
            for (const c of coverages) await repo.deleteOverridesOf(tx, { kind: "productCoverage", id: c.id });
            await repo.deleteProduct(tx, id);
            return ok(undefined);
          },
        });
      }),
    attachProductDiscriminator: (actor, id, code) =>
      db.transaction((tx) =>
        withProduct(tx, id, async () => {
          const def = await catalog.loadDiscriminator(tx, code);
          if (!def) return notFound(`구분자 ${code}`);
          if (!isValued(def) || def.level !== "product") return invalid([issue("typeMismatch", `구분자 ${code} 은(는) 상품 레벨 값 구분자가 아닙니다`, { refPath: code })]);
          await attach(tx, { kind: "product", id }, code, actor.userId);
          return ok(undefined);
        }),
      ),
    setProductValue: (actor, id, code, fieldCode, value) =>
      db.transaction((tx) => withProduct(tx, id, () => writeChecked(tx, actor, { kind: "product", id }, [], code, fieldCode, value))),
    getProductValues: (id) => readSlots(db, { kind: "product", id }),
    productMissing: async (id) => {
      const p = await repo.loadProduct(db, id);
      if (!p) return [];
      const { defs } = await catalogDefs(db);
      const owner: ValueOwner = { kind: "product", id };
      const slots = await readSlots(db, owner);
      return missingSlotsOf({ kind: "product", id }, p.name, "product", defs, await listAttached(db, owner), (path) => slots.get(path));
    },

    // 세목
    listPlanOptions: (productId) => repo.listPlanOptions(db, productId),
    addPlanOption: (actor, productId, input) =>
      db.transaction((tx) =>
        withProduct(tx, productId, async () => {
          const issues = [...validatePlanType(await catalog.loadDiscriminator(tx, input.planTypeCode)), ...validateNewPlanOption(input, await repo.listPlanOptions(tx, productId))];
          if (issues.length > 0) return invalid(issues);
          return ok(await repo.insertPlanOption(tx, productId, { ...input, name: input.name.trim() }, actor.userId));
        }),
      ),
    updatePlanOption: (actor, optionId, patch) =>
      db.transaction(async (tx) => {
        const o = await repo.loadPlanOption(tx, optionId);
        if (!o) return notFound(`세목 선택지 ${optionId}`);
        const next = { ...o, ...patch };
        const issues = validateNewPlanOption(next, await repo.listPlanOptions(tx, o.productId), o.id);
        if (issues.length > 0) return invalid(issues);
        await repo.updatePlanOption(tx, optionId, { number: next.number, name: next.name.trim() }, actor.userId);
        return ok({ ...next, name: next.name.trim() });
      }),
    removePlanOption: (actor, optionId, opts = {}) => {
      let option: PlanOption | undefined;
      let plans: ProductPlan[] = [];
      return planDestructive(
        actor,
        opts,
        async (tx) => {
          option = await repo.loadPlanOption(tx, optionId);
          if (!option) return notFound(`세목 선택지 ${optionId}`);
          const ids = new Set(await repo.listPlansUsingOption(tx, optionId));
          plans = (await repo.listPlans(tx, option.productId)).filter((p) => ids.has(p.id));
          return ok(undefined);
        },
        async (tx) => {
          const cascade: string[] = [];
          for (const p of plans) {
            cascade.push(`상품세목 ${planCombinationLabel(p.options)}`);
            for (const c of await repo.listCoveragesAttachingPlan(tx, p.id)) cascade.push(`세목 부착 ${c.name}`);
          }
          return { valueRowsLost: await countSlots(tx, [{ kind: "plan", id: optionId }]), brokenRefs: [], cascade };
        },
        async (tx) => {
          for (const p of plans) await repo.deletePlan(tx, p.id);
          await clearOwner(tx, { kind: "plan", id: optionId });
          await repo.deletePlanOption(tx, optionId);
        },
      );
    },
    setPlanOptionValue: (actor, optionId, code, fieldCode, value) =>
      db.transaction(async (tx) => {
        const o = await repo.loadPlanOption(tx, optionId);
        if (!o) return notFound(`세목 선택지 ${optionId}`);
        return writeChecked(tx, actor, { kind: "plan", id: optionId }, [o.planTypeCode], code, fieldCode, value);
      }),
    getPlanOptionValues: (optionId) => readSlots(db, { kind: "plan", id: optionId }),
    listPlans: (productId) => repo.listPlans(db, productId),
    registerPlan: (actor, productId, optionIds) =>
      db.transaction((tx) =>
        withProduct(tx, productId, async () => {
          const r = validatePlanCombination(optionIds, await repo.listPlanOptions(tx, productId), await repo.listPlans(tx, productId));
          if (!r.ok) return r as Result<ProductPlan>;
          const ids = r.value.map((o) => o.id);
          return ok(await repo.insertPlan(tx, productId, planCombinationKey(ids), ids, actor.userId));
        }),
      ),
    removePlan: (actor, planId, opts = {}) =>
      planDestructive(
        actor,
        opts,
        async (tx) => ((await repo.loadPlan(tx, planId)) ? ok(undefined) : notFound(`상품세목 ${planId}`)),
        async (tx) => ({ valueRowsLost: 0, brokenRefs: [], cascade: (await repo.listCoveragesAttachingPlan(tx, planId)).map((c) => `세목 부착 ${c.name}`) }),
        (tx) => repo.deletePlan(tx, planId),
      ),

    // 상품담보
    mount: (actor, productId, coverageId, selections) =>
      db.transaction((tx) =>
        withProduct(tx, productId, async () => {
          const tree = await master.tree(coverageId);
          if (!tree) return notFound(`담보 마스터 ${coverageId}`);
          const kinds = await repo.listAttributeKinds(tx);
          const issues = validateSelections(selections, kinds);
          if (issues.length > 0) return invalid(issues);
          const attributes = normalizeSelections(selections, kinds);
          const key = combinationKey(coverageId, attributes);
          if (await repo.findByCombination(tx, productId, key)) return reject({ reason: "duplicate", what: `상품담보 조합 ${tree.name} × ${attributes.map((a) => `${a.kindCode}=${a.valueCode}`).join(",") || "(속성 없음)"}` });
          const pc = await repo.insertProductCoverage(tx, { productId, coverageId, coverageName: tree.name, name: defaultCoverageName(tree.name, attributes, kinds), attributes, combinationKey: key }, actor.userId);
          // 값 스냅샷 (ADR-0002): 담보 → 세부보장 → 급부
          await snapshotFrom(tx, { kind: "coverage", id: coverageId }, { kind: "productCoverage", id: pc.id }, actor.userId);
          for (const sub of tree.subCoverages) {
            const s = await repo.insertNode(tx, { productCoverageId: pc.id, kind: "sub", masterNodeId: sub.id, name: sub.name, order: sub.order }, actor.userId);
            await snapshotFrom(tx, { kind: "subCoverage", id: sub.id }, { kind: "productSubCoverage", id: s.id }, actor.userId);
            for (const b of sub.benefits) {
              const bn = await repo.insertNode(tx, { productCoverageId: pc.id, kind: "benefit", masterNodeId: b.id, parentId: s.id, name: b.name, order: b.order }, actor.userId);
              await snapshotFrom(tx, { kind: "benefit", id: b.id }, { kind: "productBenefit", id: bn.id }, actor.userId);
            }
          }
          return ok(pc);
        }),
      ),
    getProductCoverage: (id) => repo.loadProductCoverage(db, id),
    listProductCoverages: (productId) => repo.listProductCoverages(db, productId),
    getSnapshot: (id) => withCoverage(db, id, async (pc) => ok(await snapshotOf(db, pc))),
    getSnapshotValues: async (id) => {
      const out = new Map<Id, Map<SlotPath, ValueSlot>>();
      for (const { owner } of await snapshotOwners(db, id)) out.set(owner.id, await readSlots(db, owner));
      return out;
    },
    setSnapshotValue: (actor, id, owner, code, fieldCode, value) =>
      db.transaction((tx) =>
        withCoverage(tx, id, async () => {
          const owners = await snapshotOwners(tx, id);
          if (!owners.some((o) => o.owner.kind === owner.kind && o.owner.id === owner.id)) return notFound(`상품담보 ${id} 의 스냅샷 실체 ${owner.kind}/${owner.id}`);
          return writeChecked(tx, actor, owner, [], code, fieldCode, value);
        }),
      ),
    renameProductCoverage: (actor, id, name) =>
      db.transaction((tx) =>
        withCoverage(tx, id, async (pc) => {
          const clean = cleanName(name);
          if (!clean) return invalid([issue("typeMismatch", "상품담보명은 비울 수 없습니다", { document: "special", ownerId: id })]);
          await repo.updateProductCoverage(tx, id, { name: clean }, actor.userId);
          return ok({ ...pc, name: clean });
        }),
      ),
    regenerateName: (actor, id) =>
      db.transaction((tx) =>
        withCoverage(tx, id, async (pc) => {
          const name = defaultCoverageName((await repo.coverageNameOf(tx, id)) ?? "", pc.attributes, await repo.listAttributeKinds(tx));
          await repo.updateProductCoverage(tx, id, { name }, actor.userId);
          return ok({ ...pc, name });
        }),
      ),
    setAttributes: (actor, id, selections, opts = {}) =>
      db.transaction((tx) =>
        withCoverage(tx, id, async (pc) => {
          const kinds = await repo.listAttributeKinds(tx);
          const issues = validateSelections(selections, kinds);
          if (issues.length > 0) return invalid(issues);
          const attributes = normalizeSelections(selections, kinds);
          const key = combinationKey(pc.coverageId, attributes);
          const dup = await repo.findByCombination(tx, pc.productId, key);
          if (dup && dup !== id) return reject({ reason: "duplicate", what: `상품담보 조합 ${key}` });
          const name = opts.regenerateName ? defaultCoverageName((await repo.coverageNameOf(tx, id)) ?? "", attributes, kinds) : pc.name;
          await repo.updateProductCoverage(tx, id, { attributes, combinationKey: key, name }, actor.userId);
          return ok({ ...pc, attributes, name });
        }),
      ),
    syncStructure: (id) => db.transaction((tx) => withCoverage(tx, id, (pc) => syncStructureIn(tx, pc))),
    unmount: (actor, id, opts = {}) =>
      db.transaction(async (tx) => {
        let owners: SnapshotOwner[] = [];
        let cascade: string[] = [];
        return destructive<void>({
          actor,
          action: "product.unmount",
          confirm: opts.confirm,
          precheck: () =>
            withCoverage(tx, id, async (pc) => {
              if (await repo.isBaseContract(tx, id)) return invalid([issue("brokenRef", `「${pc.name}」 은(는) 기본계약입니다 — 지정을 먼저 해제하세요 (D-P5-7)`, { document: "special", ownerId: id, ownerName: pc.name })]);
              const snaps = await snapshotOwners(tx, id);
              owners = snaps.map((s) => s.owner);
              const plans = await repo.listAttachedPlanIds(tx, id);
              const overrides = await repo.listOverrides(tx, { kind: "productCoverage", id });
              cascade = [
                ...snaps.filter((s) => s.node).map((s) => `${s.node!.kind === "sub" ? "세부보장" : "급부"} ${s.node!.name}`),
                ...(plans.length ? [`세목 부착 ${plans.length}건`] : []),
                ...(overrides.length ? [`옵션 오버라이드 ${overrides.length}건`] : []),
                ...((await repo.groupOf(tx, id)) ? ["그룹 배치"] : []),
              ];
              return ok(undefined);
            }),
          computeImpact: async () => ({ valueRowsLost: await countSlots(tx, owners), brokenRefs: [], cascade }),
          execute: async () => {
            for (const o of owners) await clearOwner(tx, o);
            await repo.deleteOverridesOf(tx, { kind: "productCoverage", id });
            await repo.deleteProductCoverage(tx, id);
            return ok(undefined);
          },
        });
      }),
    coverageMissing: async (id) => {
      const pc = await repo.loadProductCoverage(db, id);
      if (!pc) return [];
      const { defs } = await catalogDefs(db);
      const out: MissingSlot[] = [];
      for (const { owner, node } of await snapshotOwners(db, id)) {
        const slots = await readSlots(db, owner);
        out.push(...missingSlotsOf(owner, node ? node.name : pc.name, LEVEL_OF[owner.kind], defs, await listAttached(db, owner), (p) => slots.get(p)));
      }
      return out;
    },
    attachPlan: (actor, id, planId) =>
      db.transaction((tx) =>
        withCoverage(tx, id, async (pc) => {
          const plan = await repo.loadPlan(tx, planId);
          if (!plan || plan.productId !== pc.productId) return notFound(`상품세목 ${planId}`);
          await repo.attachPlan(tx, id, planId, actor.userId);
          return ok(undefined);
        }),
      ),
    detachPlan: (actor, id, planId, opts = {}) =>
      planDestructive(
        actor,
        opts,
        async (tx) => ((await repo.listAttachedPlanIds(tx, id)).includes(planId) ? ok(undefined) : notFound(`상품담보 ${id} 의 세목 부착 ${planId}`)),
        async () => ({ valueRowsLost: 0, brokenRefs: [], cascade: [] }),
        (tx) => repo.detachPlan(tx, id, planId),
      ),
    listAttachedPlans: async (id) => {
      const ids = await repo.listAttachedPlanIds(db, id);
      const plans: ProductPlan[] = [];
      for (const pid of ids) {
        const p = await repo.loadPlan(db, pid);
        if (p) plans.push(p);
      }
      return plans;
    },

    // 기본계약
    designateBaseContract: (actor, productId, productCoverageId) =>
      db.transaction((tx) =>
        withProduct(tx, productId, (product) =>
          withCoverage(tx, productCoverageId, async (pc) => {
            if (pc.productId !== productId) return notFound(`상품 ${productId} 의 상품담보 ${productCoverageId}`);
            const existing = await repo.listBaseContractIds(tx, productId);
            if (existing.some((e) => e !== productCoverageId)) return reject({ reason: "duplicate", what: "기본계약 (MVP 는 정확히 1개 — 먼저 해제하세요)" });
            if (!product.generalDocumentId) return invalid([issue("brokenRef", "보통약관 템플릿이 선택되지 않았습니다", { document: "product", ownerId: productId })]);
            await repo.insertBaseContract(tx, productId, productCoverageId, actor.userId);
            return checkOne(tx, product, pc); // 부착 검사 — 실패는 거부가 아니라 오류 목록 (D-P5-13)
          }),
        ),
      ),
    releaseBaseContract: (actor, productId, productCoverageId) =>
      db.transaction((tx) =>
        withProduct(tx, productId, async () => {
          void actor;
          if (!(await repo.listBaseContractIds(tx, productId)).includes(productCoverageId)) return notFound(`기본계약 ${productCoverageId}`);
          await repo.deleteBaseContract(tx, productId, productCoverageId);
          return ok(undefined);
        }),
      ),
    checkBaseContract: (productId) =>
      withProduct(db, productId, async (product) => {
        const ids = await repo.listBaseContractIds(db, productId);
        if (ids.length === 0) return invalid([issue("noBaseContract", "기본계약이 지정되지 않았습니다", { document: "product", ownerId: productId, ownerName: product.name })]);
        if (ids.length > 1) return invalid([issue("noBaseContract", `기본계약이 ${ids.length}개입니다 — MVP 는 정확히 1개`, { document: "product", ownerId: productId, ownerName: product.name })]);
        const checks: BaseContractCheck[] = [];
        for (const id of ids) {
          const pc = await repo.loadProductCoverage(db, id);
          if (!pc) continue;
          const r = await checkOne(db, product, pc);
          if (!r.ok) return r as Result<BaseContractCheck[]>;
          checks.push(r.value);
        }
        return ok(checks);
      }),

    // 특약 그룹
    listGroups: (productId) => groupViews(db, productId),
    createGroup: (actor, productId, input) =>
      db.transaction((tx) =>
        withProduct(tx, productId, async (p) => {
          const title = cleanName(input.title);
          if (!title) return invalid([issue("typeMismatch", "그룹 제목은 비울 수 없습니다")]);
          const issues = validateGroupTemplate(input.generalDocumentId, p.generalDocumentId);
          if (issues.length > 0) return invalid(issues);
          const order = (await repo.listGroups(tx, productId)).reduce((m, g) => Math.max(m, g.order + 1), 0);
          return ok(await repo.insertGroup(tx, productId, title, order, input.generalDocumentId, actor.userId));
        }),
      ),
    renameGroup: (actor, groupId, title) =>
      db.transaction(async (tx) => {
        const g = await repo.loadGroup(tx, groupId);
        if (!g) return notFound(`그룹 ${groupId}`);
        const clean = cleanName(title);
        if (!clean) return invalid([issue("typeMismatch", "그룹 제목은 비울 수 없습니다")]);
        await repo.updateGroup(tx, groupId, { title: clean }, actor.userId);
        return ok({ ...g, title: clean });
      }),
    reorderGroups: (actor, productId, order) =>
      db.transaction(async (tx) => {
        const groups = await repo.listGroups(tx, productId);
        const ids = new Set(groups.map((g) => g.id));
        if (order.length !== ids.size || new Set(order).size !== order.length || order.some((id) => !ids.has(id))) {
          return invalid([issue("typeMismatch", "그룹 순서는 상품의 모든 그룹 id 를 한 번씩 담아야 합니다")]);
        }
        const byId = new Map(groups.map((g) => [g.id, g]));
        const out: SpecialGroup[] = [];
        for (const [i, id] of order.entries()) {
          await repo.updateGroup(tx, id, { order: i }, actor.userId);
          out.push({ ...byId.get(id)!, order: i });
        }
        return ok(out);
      }),
    deleteGroup: (actor, groupId) =>
      db.transaction(async (tx) => {
        void actor;
        if (!(await repo.loadGroup(tx, groupId))) return notFound(`그룹 ${groupId}`);
        await repo.deleteGroup(tx, groupId); // 소속은 cascade — 상품담보는 미배치로 돌아간다 (값 손실 없음)
        return ok(undefined);
      }),
    placeInGroup: (actor, groupId, productCoverageId) =>
      db.transaction(async (tx) => {
        void actor;
        const g = await repo.loadGroup(tx, groupId);
        if (!g) return notFound(`그룹 ${groupId}`);
        return withCoverage(tx, productCoverageId, async (pc) => {
          if (pc.productId !== g.productId) return notFound(`상품 ${g.productId} 의 상품담보 ${productCoverageId}`);
          await repo.placeMember(tx, groupId, productCoverageId);
          return ok(undefined);
        });
      }),
    removeFromGroup: (actor, productCoverageId) =>
      db.transaction(async (tx) => {
        void actor;
        if (!(await repo.groupOf(tx, productCoverageId))) return notFound(`상품담보 ${productCoverageId} 의 그룹 배치`);
        await repo.removeMember(tx, productCoverageId);
        return ok(undefined);
      }),
    listUnplaced: async (productId) => {
      const placed = new Set([...(await repo.listMembersByGroup(db, productId)).values()].flat());
      return (await repo.listProductCoverages(db, productId)).filter((c) => !placed.has(c.id));
    },

    // 옵션 오버라이드
    setOptionOverride: (actor, scope, nodeId, clauseCode, options) =>
      db.transaction(async (tx) => {
        const exists = scope.kind === "product" ? await repo.loadProduct(tx, scope.id) : await repo.loadProductCoverage(tx, scope.id);
        if (!exists) return notFound(`${scope.kind === "product" ? "상품" : "상품담보"} ${scope.id}`);
        const issues = await optionValidator.validate(clauseCode, options);
        if (issues.length > 0) return invalid(issues);
        return ok(await repo.upsertOverride(tx, scope, nodeId, clauseCode, options, actor.userId));
      }),
    listOptionOverrides: (scope) => repo.listOverrides(db, scope),
    removeOptionOverride: (actor, scope, nodeId, clauseCode) =>
      db.transaction(async (tx) => {
        void actor;
        const found = (await repo.listOverrides(tx, scope)).some((o) => o.nodeId === nodeId && o.clauseCode === clauseCode);
        if (!found) return notFound(`옵션 오버라이드 ${clauseCode}@${nodeId}`);
        await repo.deleteOverride(tx, scope, nodeId, clauseCode);
        return ok(undefined);
      }),
  };
}
