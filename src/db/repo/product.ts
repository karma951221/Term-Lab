/**
 * 상품 저장소 — drizzle 쿼리만. 규칙 없음 (규칙은 src/domain/product, 조립은 src/services/product).
 *
 * 값 행(상품 레벨 · 세목 유형 값 · 스냅샷 값)은 여기 없다 — `./values` 공용 저장소를 서비스가 쓴다.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import type { AttributeCodeKind, AttributeSeq } from "@/domain/product/attributes";
import type {
  AttributeKind,
  AttributeSelection,
  AttributeValue,
  ClauseOptionOverride,
  ClauseOptionSelection,
  NewPlanOption,
  NewProduct,
  PlanAxis,
  PlanOption,
  Product,
  ProductCoverage,
  ProductPlan,
  SnapshotNode,
  SpecialGroup,
} from "@/domain/product/types";
import type { Code, Id } from "@/domain/types";

import {
  attributeKinds,
  attributeValues,
  clauseOptionOverrides,
  codeSequences,
  planOptions,
  productBaseContracts,
  productCoverageAttributes,
  productCoverageNodes,
  productCoveragePlans,
  productCoverages,
  productPlanOptions,
  productPlans,
  products,
  specialGroupMembers,
  specialGroups,
} from "../schema";
import type { Db } from "./types";

// ───────────────────────────── 채번 ─────────────────────────────

/** 카탈로그 `code_sequences` 를 kind attribute / attributeValue 로 공유한다 (원자적 upsert). */
export async function nextAttributeSeq(db: Db, kind: AttributeCodeKind, scope: string): Promise<number> {
  const [row] = await db
    .insert(codeSequences)
    .values({ kind, scope, next: 2 })
    .onConflictDoUpdate({ target: [codeSequences.kind, codeSequences.scope], set: { next: sql`${codeSequences.next} + 1` } })
    .returning({ next: codeSequences.next });
  return row.next - 1;
}

export function attributeSeqSource(db: Db): AttributeSeq {
  return (kind, scope) => nextAttributeSeq(db, kind, scope);
}

// ───────────────────────────── 담보속성 카탈로그 ─────────────────────────────

type KindRow = typeof attributeKinds.$inferSelect;
type ValueRow = typeof attributeValues.$inferSelect;

function toValue(r: ValueRow): AttributeValue {
  return { code: r.code, label: r.label, order: r.order, naming: { ...(r.prefix ? { prefix: r.prefix } : {}), ...(r.suffix ? { suffix: r.suffix } : {}) } };
}

function toKind(r: KindRow, values: ValueRow[]): AttributeKind {
  return { code: r.code, label: r.label, order: r.order, values: values.map(toValue) };
}

export async function listAttributeKinds(db: Db): Promise<AttributeKind[]> {
  const rows = await db.select().from(attributeKinds).orderBy(asc(attributeKinds.order), asc(attributeKinds.code));
  const vals = await db.select().from(attributeValues).orderBy(asc(attributeValues.order), asc(attributeValues.code));
  const byKind = new Map<Id, ValueRow[]>();
  for (const v of vals) byKind.set(v.kindId, [...(byKind.get(v.kindId) ?? []), v]);
  return rows.map((r) => toKind(r, byKind.get(r.id) ?? []));
}

export async function loadAttributeKind(db: Db, code: Code): Promise<AttributeKind | undefined> {
  const [row] = await db.select().from(attributeKinds).where(eq(attributeKinds.code, code)).limit(1);
  if (!row) return undefined;
  const vals = await db.select().from(attributeValues).where(eq(attributeValues.kindId, row.id)).orderBy(asc(attributeValues.order), asc(attributeValues.code));
  return toKind(row, vals);
}

export async function insertAttributeKind(db: Db, kind: AttributeKind, who: Id): Promise<void> {
  const [row] = await db.insert(attributeKinds).values({ code: kind.code, label: kind.label, order: kind.order, createdBy: who, updatedBy: who }).returning({ id: attributeKinds.id });
  await upsertValues(db, row.id, kind.values, who);
}

async function upsertValues(db: Db, kindId: Id, values: AttributeValue[], who: Id): Promise<void> {
  const now = new Date();
  const keep = values.map((v) => v.code);
  if (keep.length === 0) await db.delete(attributeValues).where(eq(attributeValues.kindId, kindId));
  else await db.delete(attributeValues).where(and(eq(attributeValues.kindId, kindId), sql`${attributeValues.code} not in ${keep}`));
  for (const v of values) {
    const data = { label: v.label, order: v.order, prefix: v.naming.prefix ?? "", suffix: v.naming.suffix ?? "" };
    await db
      .insert(attributeValues)
      .values({ kindId, code: v.code, ...data, createdBy: who, updatedBy: who })
      .onConflictDoUpdate({ target: [attributeValues.kindId, attributeValues.code], set: { ...data, updatedAt: now, updatedBy: who } });
  }
}

/** 기존 종류 덮어쓰기 (행 갱신 + 유효값 upsert/삭제). 코드는 바뀌지 않는다. */
export async function saveAttributeKind(db: Db, kind: AttributeKind, who: Id): Promise<void> {
  const [row] = await db
    .update(attributeKinds)
    .set({ label: kind.label, order: kind.order, updatedAt: new Date(), updatedBy: who })
    .where(eq(attributeKinds.code, kind.code))
    .returning({ id: attributeKinds.id });
  if (!row) throw new Error(`저장 대상 담보속성 종류가 없습니다: ${kind.code}`);
  await upsertValues(db, row.id, kind.values, who);
}

export async function saveAttributeKindOrders(db: Db, kinds: readonly AttributeKind[], who: Id): Promise<void> {
  for (const k of kinds) {
    await db.update(attributeKinds).set({ order: k.order, updatedAt: new Date(), updatedBy: who }).where(eq(attributeKinds.code, k.code));
  }
}

export async function deleteAttributeKind(db: Db, code: Code): Promise<void> {
  await db.delete(attributeKinds).where(eq(attributeKinds.code, code)); // 유효값은 FK cascade
}

/** 이 속성(값)을 조합에 쓰는 상품담보 — 삭제 영향의 brokenRefs 재료. */
export async function listCoveragesUsingAttribute(db: Db, kindCode: Code, valueCode?: Code): Promise<{ id: Id; name: string; productId: Id }[]> {
  const where = valueCode
    ? and(eq(productCoverageAttributes.kindCode, kindCode), eq(productCoverageAttributes.valueCode, valueCode))
    : eq(productCoverageAttributes.kindCode, kindCode);
  return db
    .select({ id: productCoverages.id, name: productCoverages.name, productId: productCoverages.productId })
    .from(productCoverageAttributes)
    .innerJoin(productCoverages, eq(productCoverages.id, productCoverageAttributes.productCoverageId))
    .where(where)
    .orderBy(asc(productCoverages.name));
}

// ───────────────────────────── 상품 ─────────────────────────────

type ProductRow = typeof products.$inferSelect;

function toProduct(r: ProductRow): Product {
  return { id: r.id, name: r.name, ...(r.generalDocumentId ? { generalDocumentId: r.generalDocumentId } : {}) };
}

export async function insertProduct(db: Db, input: NewProduct, who: Id): Promise<Product> {
  const [row] = await db.insert(products).values({ name: input.name, generalDocumentId: input.generalDocumentId ?? null, createdBy: who, updatedBy: who }).returning();
  return toProduct(row);
}

export async function loadProduct(db: Db, id: Id): Promise<Product | undefined> {
  const [row] = await db.select().from(products).where(eq(products.id, id)).limit(1);
  return row ? toProduct(row) : undefined;
}

export async function findProductByName(db: Db, name: string): Promise<Product | undefined> {
  const [row] = await db.select().from(products).where(eq(products.name, name)).limit(1);
  return row ? toProduct(row) : undefined;
}

export async function listProducts(db: Db): Promise<Product[]> {
  return (await db.select().from(products).orderBy(asc(products.name))).map(toProduct);
}

export async function updateProduct(db: Db, id: Id, patch: { name?: string; generalDocumentId?: Id | null }, who: Id): Promise<void> {
  await db.update(products).set({ ...patch, updatedAt: new Date(), updatedBy: who }).where(eq(products.id, id));
}

export async function deleteProduct(db: Db, id: Id): Promise<void> {
  await db.delete(products).where(eq(products.id, id)); // 하위는 FK cascade — 값 행은 서비스가 지운다
}

export async function productAudit(db: Db, id: Id) {
  const [row] = await db.select().from(products).where(eq(products.id, id)).limit(1);
  if (!row) return undefined;
  return { createdAt: row.createdAt, updatedAt: row.updatedAt, createdBy: row.createdBy, updatedBy: row.updatedBy };
}

// ───────────────────────────── 세목 ─────────────────────────────

type OptionRow = typeof planOptions.$inferSelect;

function toOption(r: OptionRow): PlanOption {
  return { id: r.id, productId: r.productId, axis: r.axis as PlanAxis, number: r.number, name: r.name, planTypeCode: r.planTypeCode };
}

export async function insertPlanOption(db: Db, productId: Id, input: NewPlanOption, who: Id): Promise<PlanOption> {
  const [row] = await db.insert(planOptions).values({ productId, axis: input.axis, number: input.number, name: input.name, planTypeCode: input.planTypeCode, createdBy: who, updatedBy: who }).returning();
  return toOption(row);
}

export async function loadPlanOption(db: Db, id: Id): Promise<PlanOption | undefined> {
  const [row] = await db.select().from(planOptions).where(eq(planOptions.id, id)).limit(1);
  return row ? toOption(row) : undefined;
}

export async function listPlanOptions(db: Db, productId: Id): Promise<PlanOption[]> {
  const rows = await db.select().from(planOptions).where(eq(planOptions.productId, productId)).orderBy(asc(planOptions.axis), asc(planOptions.number));
  return rows.map(toOption);
}

export async function updatePlanOption(db: Db, id: Id, patch: { number?: number; name?: string }, who: Id): Promise<void> {
  await db.update(planOptions).set({ ...patch, updatedAt: new Date(), updatedBy: who }).where(eq(planOptions.id, id));
}

export async function deletePlanOption(db: Db, id: Id): Promise<void> {
  await db.delete(planOptions).where(eq(planOptions.id, id));
}

async function plansWithOptions(db: Db, planRows: { id: Id; productId: Id }[]): Promise<ProductPlan[]> {
  if (planRows.length === 0) return [];
  const links = await db
    .select({ planId: productPlanOptions.planId, option: planOptions })
    .from(productPlanOptions)
    .innerJoin(planOptions, eq(planOptions.id, productPlanOptions.optionId))
    .where(inArray(productPlanOptions.planId, planRows.map((p) => p.id)));
  const byPlan = new Map<Id, PlanOption[]>();
  for (const l of links) byPlan.set(l.planId, [...(byPlan.get(l.planId) ?? []), toOption(l.option)]);
  return planRows.map((p) => ({
    id: p.id,
    productId: p.productId,
    options: (byPlan.get(p.id) ?? []).sort((a, b) => a.axis.localeCompare(b.axis) * -1 || a.number - b.number), // type 이 form 보다 앞
  }));
}

export async function insertPlan(db: Db, productId: Id, key: string, optionIds: Id[], who: Id): Promise<ProductPlan> {
  const [row] = await db.insert(productPlans).values({ productId, key, createdBy: who, updatedBy: who }).returning();
  await db.insert(productPlanOptions).values(optionIds.map((optionId) => ({ planId: row.id, optionId })));
  return (await plansWithOptions(db, [row]))[0];
}

export async function loadPlan(db: Db, id: Id): Promise<ProductPlan | undefined> {
  const [row] = await db.select().from(productPlans).where(eq(productPlans.id, id)).limit(1);
  return row ? (await plansWithOptions(db, [row]))[0] : undefined;
}

export async function listPlans(db: Db, productId: Id): Promise<ProductPlan[]> {
  const rows = await db.select().from(productPlans).where(eq(productPlans.productId, productId)).orderBy(asc(productPlans.createdAt), asc(productPlans.id));
  return plansWithOptions(db, rows);
}

export async function deletePlan(db: Db, id: Id): Promise<void> {
  await db.delete(productPlans).where(eq(productPlans.id, id));
}

/** 이 선택지를 쓰는 조합 id. */
export async function listPlansUsingOption(db: Db, optionId: Id): Promise<Id[]> {
  return (await db.select({ id: productPlanOptions.planId }).from(productPlanOptions).where(eq(productPlanOptions.optionId, optionId))).map((r) => r.id);
}

// ───────────────────────────── 상품담보 ─────────────────────────────

type CoverageRow = typeof productCoverages.$inferSelect;

async function attributesOf(db: Db, ids: Id[]): Promise<Map<Id, AttributeSelection[]>> {
  const out = new Map<Id, AttributeSelection[]>();
  if (ids.length === 0) return out;
  const rows = await db.select().from(productCoverageAttributes).where(inArray(productCoverageAttributes.productCoverageId, ids)).orderBy(asc(productCoverageAttributes.kindCode));
  for (const r of rows) out.set(r.productCoverageId, [...(out.get(r.productCoverageId) ?? []), { kindCode: r.kindCode, valueCode: r.valueCode }]);
  return out;
}

function toCoverage(r: CoverageRow, attributes: AttributeSelection[]): ProductCoverage {
  return { id: r.id, productId: r.productId, coverageId: r.coverageId, name: r.name, attributes };
}

export interface NewProductCoverageRow {
  productId: Id;
  coverageId: Id;
  coverageName: string;
  name: string;
  attributes: AttributeSelection[];
  combinationKey: string;
}

export async function insertProductCoverage(db: Db, input: NewProductCoverageRow, who: Id): Promise<ProductCoverage> {
  const [row] = await db
    .insert(productCoverages)
    .values({ productId: input.productId, coverageId: input.coverageId, coverageName: input.coverageName, name: input.name, combinationKey: input.combinationKey, createdBy: who, updatedBy: who })
    .returning();
  await replaceAttributes(db, row.id, input.attributes);
  return toCoverage(row, input.attributes);
}

async function replaceAttributes(db: Db, productCoverageId: Id, attributes: AttributeSelection[]): Promise<void> {
  await db.delete(productCoverageAttributes).where(eq(productCoverageAttributes.productCoverageId, productCoverageId));
  if (attributes.length > 0) await db.insert(productCoverageAttributes).values(attributes.map((a) => ({ productCoverageId, ...a })));
}

export async function loadProductCoverage(db: Db, id: Id): Promise<ProductCoverage | undefined> {
  const [row] = await db.select().from(productCoverages).where(eq(productCoverages.id, id)).limit(1);
  if (!row) return undefined;
  return toCoverage(row, (await attributesOf(db, [id])).get(id) ?? []);
}

/** 탑재 시점 담보명 (작명 재생성 재료). */
export async function coverageNameOf(db: Db, id: Id): Promise<string | undefined> {
  const [row] = await db.select({ n: productCoverages.coverageName }).from(productCoverages).where(eq(productCoverages.id, id)).limit(1);
  return row?.n;
}

export async function listProductCoverages(db: Db, productId: Id): Promise<ProductCoverage[]> {
  const rows = await db.select().from(productCoverages).where(eq(productCoverages.productId, productId)).orderBy(asc(productCoverages.createdAt), asc(productCoverages.id));
  const attrs = await attributesOf(db, rows.map((r) => r.id));
  return rows.map((r) => toCoverage(r, attrs.get(r.id) ?? []));
}

export async function findByCombination(db: Db, productId: Id, combinationKey: string): Promise<Id | undefined> {
  const [row] = await db.select({ id: productCoverages.id }).from(productCoverages).where(and(eq(productCoverages.productId, productId), eq(productCoverages.combinationKey, combinationKey))).limit(1);
  return row?.id;
}

export async function updateProductCoverage(
  db: Db,
  id: Id,
  patch: { name?: string; attributes?: AttributeSelection[]; combinationKey?: string },
  who: Id,
): Promise<void> {
  const { attributes, ...rest } = patch;
  await db.update(productCoverages).set({ ...rest, updatedAt: new Date(), updatedBy: who }).where(eq(productCoverages.id, id));
  if (attributes) await replaceAttributes(db, id, attributes);
}

export async function deleteProductCoverage(db: Db, id: Id): Promise<void> {
  await db.delete(productCoverages).where(eq(productCoverages.id, id));
}

// 스냅샷 노드

type NodeRow = typeof productCoverageNodes.$inferSelect;

function toNode(r: NodeRow): SnapshotNode {
  return { id: r.id, productCoverageId: r.productCoverageId, kind: r.kind as SnapshotNode["kind"], masterNodeId: r.masterNodeId, ...(r.parentId ? { parentId: r.parentId } : {}), name: r.name, order: r.order };
}

export async function insertNode(db: Db, input: Omit<SnapshotNode, "id">, who?: Id): Promise<SnapshotNode> {
  const [row] = await db
    .insert(productCoverageNodes)
    .values({ productCoverageId: input.productCoverageId, kind: input.kind, masterNodeId: input.masterNodeId, parentId: input.parentId ?? null, name: input.name, order: input.order, createdBy: who, updatedBy: who })
    .returning();
  return toNode(row);
}

/** 세부보장(order) → 급부(order) 순. */
export async function listNodes(db: Db, productCoverageId: Id): Promise<SnapshotNode[]> {
  const rows = await db.select().from(productCoverageNodes).where(eq(productCoverageNodes.productCoverageId, productCoverageId)).orderBy(asc(productCoverageNodes.kind), asc(productCoverageNodes.order), asc(productCoverageNodes.id));
  // kind 'benefit' < 'sub' 문자열 순이므로 sub 먼저 오도록 다시 정렬
  const subs = rows.filter((r) => r.kind === "sub").map(toNode);
  const benefits = rows.filter((r) => r.kind === "benefit").map(toNode);
  const out: SnapshotNode[] = [];
  for (const s of subs) {
    out.push(s);
    out.push(...benefits.filter((b) => b.parentId === s.id));
  }
  out.push(...benefits.filter((b) => !subs.some((s) => s.id === b.parentId)));
  return out;
}

export async function updateNode(db: Db, id: Id, patch: { name: string; order: number }, who?: Id): Promise<void> {
  await db.update(productCoverageNodes).set({ ...patch, updatedAt: new Date(), updatedBy: who }).where(eq(productCoverageNodes.id, id));
}

export async function deleteNodes(db: Db, ids: Id[]): Promise<void> {
  if (ids.length > 0) await db.delete(productCoverageNodes).where(inArray(productCoverageNodes.id, ids));
}

// 세목 부착

export async function attachPlan(db: Db, productCoverageId: Id, planId: Id, who: Id): Promise<void> {
  await db.insert(productCoveragePlans).values({ productCoverageId, planId, createdBy: who }).onConflictDoNothing();
}

export async function detachPlan(db: Db, productCoverageId: Id, planId: Id): Promise<void> {
  await db.delete(productCoveragePlans).where(and(eq(productCoveragePlans.productCoverageId, productCoverageId), eq(productCoveragePlans.planId, planId)));
}

export async function listAttachedPlanIds(db: Db, productCoverageId: Id): Promise<Id[]> {
  return (await db.select({ id: productCoveragePlans.planId }).from(productCoveragePlans).where(eq(productCoveragePlans.productCoverageId, productCoverageId)).orderBy(asc(productCoveragePlans.createdAt))).map((r) => r.id);
}

export async function listCoveragesAttachingPlan(db: Db, planId: Id): Promise<{ id: Id; name: string }[]> {
  return db
    .select({ id: productCoverages.id, name: productCoverages.name })
    .from(productCoveragePlans)
    .innerJoin(productCoverages, eq(productCoverages.id, productCoveragePlans.productCoverageId))
    .where(eq(productCoveragePlans.planId, planId));
}

// ───────────────────────────── 기본계약 ─────────────────────────────

export async function insertBaseContract(db: Db, productId: Id, productCoverageId: Id, who: Id): Promise<void> {
  await db.insert(productBaseContracts).values({ productId, productCoverageId, createdBy: who }).onConflictDoNothing();
}

export async function deleteBaseContract(db: Db, productId: Id, productCoverageId: Id): Promise<void> {
  await db.delete(productBaseContracts).where(and(eq(productBaseContracts.productId, productId), eq(productBaseContracts.productCoverageId, productCoverageId)));
}

/** 지정 순. 복수 허용 구조 — 「1개」 검증은 서비스. */
export async function listBaseContractIds(db: Db, productId: Id): Promise<Id[]> {
  return (await db.select({ id: productBaseContracts.productCoverageId }).from(productBaseContracts).where(eq(productBaseContracts.productId, productId)).orderBy(asc(productBaseContracts.createdAt))).map((r) => r.id);
}

export async function isBaseContract(db: Db, productCoverageId: Id): Promise<boolean> {
  const [row] = await db.select({ id: productBaseContracts.productCoverageId }).from(productBaseContracts).where(eq(productBaseContracts.productCoverageId, productCoverageId)).limit(1);
  return !!row;
}

// ───────────────────────────── 특약 그룹 ─────────────────────────────

type GroupRow = typeof specialGroups.$inferSelect;

function toGroup(r: GroupRow): SpecialGroup {
  return { id: r.id, productId: r.productId, title: r.title, order: r.order, ...(r.generalDocumentId ? { generalDocumentId: r.generalDocumentId } : {}) };
}

export async function insertGroup(db: Db, productId: Id, title: string, order: number, generalDocumentId: Id | undefined, who: Id): Promise<SpecialGroup> {
  const [row] = await db.insert(specialGroups).values({ productId, title, order, generalDocumentId: generalDocumentId ?? null, createdBy: who, updatedBy: who }).returning();
  return toGroup(row);
}

export async function loadGroup(db: Db, id: Id): Promise<SpecialGroup | undefined> {
  const [row] = await db.select().from(specialGroups).where(eq(specialGroups.id, id)).limit(1);
  return row ? toGroup(row) : undefined;
}

export async function listGroups(db: Db, productId: Id): Promise<SpecialGroup[]> {
  return (await db.select().from(specialGroups).where(eq(specialGroups.productId, productId)).orderBy(asc(specialGroups.order), asc(specialGroups.id))).map(toGroup);
}

export async function updateGroup(db: Db, id: Id, patch: { title?: string; order?: number; generalDocumentId?: Id | null }, who: Id): Promise<void> {
  await db.update(specialGroups).set({ ...patch, updatedAt: new Date(), updatedBy: who }).where(eq(specialGroups.id, id));
}

export async function deleteGroup(db: Db, id: Id): Promise<void> {
  await db.delete(specialGroups).where(eq(specialGroups.id, id));
}

/** 배치 — 이미 다른 그룹에 있으면 옮긴다 (상품담보 하나는 한 그룹에만). */
export async function placeMember(db: Db, groupId: Id, productCoverageId: Id): Promise<void> {
  await db.delete(specialGroupMembers).where(eq(specialGroupMembers.productCoverageId, productCoverageId));
  await db.insert(specialGroupMembers).values({ groupId, productCoverageId });
}

export async function removeMember(db: Db, productCoverageId: Id): Promise<void> {
  await db.delete(specialGroupMembers).where(eq(specialGroupMembers.productCoverageId, productCoverageId));
}

/** 그룹별 소속 상품담보 id (정렬 전). */
export async function listMembersByGroup(db: Db, productId: Id): Promise<Map<Id, Id[]>> {
  const rows = await db
    .select({ groupId: specialGroupMembers.groupId, pcId: specialGroupMembers.productCoverageId })
    .from(specialGroupMembers)
    .innerJoin(specialGroups, eq(specialGroups.id, specialGroupMembers.groupId))
    .where(eq(specialGroups.productId, productId));
  const out = new Map<Id, Id[]>();
  for (const r of rows) out.set(r.groupId, [...(out.get(r.groupId) ?? []), r.pcId]);
  return out;
}

export async function groupOf(db: Db, productCoverageId: Id): Promise<Id | undefined> {
  const [row] = await db.select({ id: specialGroupMembers.groupId }).from(specialGroupMembers).where(eq(specialGroupMembers.productCoverageId, productCoverageId)).limit(1);
  return row?.id;
}

// ───────────────────────────── 옵션 오버라이드 ─────────────────────────────

type OverrideRow = typeof clauseOptionOverrides.$inferSelect;

function toOverride(r: OverrideRow): ClauseOptionOverride {
  return { id: r.id, scope: { kind: r.scopeKind as ClauseOptionOverride["scope"]["kind"], id: r.scopeId }, nodeId: r.nodeId, clauseCode: r.clauseCode, options: r.options };
}

export async function upsertOverride(db: Db, scope: ClauseOptionOverride["scope"], nodeId: Id, clauseCode: Code, options: ClauseOptionSelection, who: Id): Promise<ClauseOptionOverride> {
  const [row] = await db
    .insert(clauseOptionOverrides)
    .values({ scopeKind: scope.kind, scopeId: scope.id, nodeId, clauseCode, options, createdBy: who, updatedBy: who })
    .onConflictDoUpdate({
      target: [clauseOptionOverrides.scopeKind, clauseOptionOverrides.scopeId, clauseOptionOverrides.nodeId, clauseOptionOverrides.clauseCode],
      set: { options, updatedAt: new Date(), updatedBy: who },
    })
    .returning();
  return toOverride(row);
}

export async function listOverrides(db: Db, scope: ClauseOptionOverride["scope"]): Promise<ClauseOptionOverride[]> {
  return (await db.select().from(clauseOptionOverrides).where(and(eq(clauseOptionOverrides.scopeKind, scope.kind), eq(clauseOptionOverrides.scopeId, scope.id))).orderBy(asc(clauseOptionOverrides.createdAt))).map(toOverride);
}

export async function deleteOverride(db: Db, scope: ClauseOptionOverride["scope"], nodeId: Id, clauseCode: Code): Promise<void> {
  await db
    .delete(clauseOptionOverrides)
    .where(and(eq(clauseOptionOverrides.scopeKind, scope.kind), eq(clauseOptionOverrides.scopeId, scope.id), eq(clauseOptionOverrides.nodeId, nodeId), eq(clauseOptionOverrides.clauseCode, clauseCode)));
}

export async function deleteOverridesOf(db: Db, scope: ClauseOptionOverride["scope"]): Promise<void> {
  await db.delete(clauseOptionOverrides).where(and(eq(clauseOptionOverrides.scopeKind, scope.kind), eq(clauseOptionOverrides.scopeId, scope.id)));
}
