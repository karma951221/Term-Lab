import type { NewDiscriminator, NewEnum } from "@/domain/catalog";
import type { NewClause } from "@/domain/clause";
import type { Command, DocumentNode } from "@/domain/document";
import type { Actor, Code, Id, Result, Value } from "@/domain/types";
import type { Services } from "@/services/container";

import appendices from "./data/appendices.json";
import attributes from "./data/attributes.json";
import clauses from "./data/clauses.json";
import coverages from "./data/coverages.json";
import discriminators from "./data/discriminators.json";
import documents from "./data/documents.json";
import enums from "./data/enums.json";
import generals from "./data/generals.json";
import products from "./data/products.json";

export const ALPHA_PLUS_PRODUCT_NAME = "알파Plus(축약)";

export interface SeedResult {
  created: boolean;
  productId: Id;
}

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`[seed:alphaPlus] 기대: ok, 실제: ${JSON.stringify(result.rejection)}`);
  return result.value;
}

function expectCode(actual: Code, expected: string): void {
  if (actual !== expected) throw new Error(`[seed:alphaPlus] 코드 불일치: 기대 ${expected}, 실제 ${actual}`);
}

function omit(record: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key)));
}

function insertAll(rootId: Id, tree: DocumentNode): Command[] {
  return tree.children.map((node) => ({ type: "insert", node, at: { parentId: rootId } }));
}

async function assertAssembles(services: Services, productId: Id): Promise<void> {
  const result = await services.assembly.preview(productId);
  if (!result.ok) throw new Error(`[seed:alphaPlus] 조립 미리보기 실패: ${JSON.stringify(result.rejection)}`);
  if (!result.value.complete) throw new Error(`[seed:alphaPlus] 관통 1 조립 검증 실패: ${JSON.stringify(result.value.issues)}`);
}

/** JSON 정본을 서비스 API로 적재한다. JSON의 의미 코드는 참조 키로만 쓰고 UUID는 서비스가 발급한다. */
export async function loadAlphaPlus(services: Services, actor: Actor): Promise<SeedResult> {
  const existing = (await services.product.listProducts()).find((product) => product.name === ALPHA_PLUS_PRODUCT_NAME);
  if (existing) {
    await assertAssembles(services, existing.id);
    return { created: false, productId: existing.id };
  }

  const enumInputs = enums as unknown as Array<{ code: Code; label: string; values: Array<{ label: string }> }>;
  for (const definition of enumInputs) {
    const created = unwrap(await services.catalog.createEnum(actor, { label: definition.label, values: definition.values.map(({ label }) => ({ label })) } as NewEnum));
    expectCode(created.code, definition.code);
  }

  for (const raw of discriminators as unknown as Array<Record<string, unknown> & { code: Code; kind: string }>) {
    const code = raw.code;
    const definition = omit(raw, ["code", "description"]);
    if (definition.kind === "struct") {
      definition.fields = (definition.fields as Array<Record<string, unknown>>).map((field) => omit(field, ["code", "order"]));
    }
    const created = unwrap(await services.catalog.create(actor, definition as unknown as NewDiscriminator));
    expectCode(created.code, code);
  }

  const coverageIds = new Map<string, Id>();
  for (const specification of coverages) {
    const tree = unwrap(await services.coverage.create(actor, { name: specification.name, benefitName: specification.benefitName }));
    coverageIds.set(specification.code, tree.id);
    const benefitId = tree.subCoverages[0].benefits[0].id;
    for (const code of specification.attachments ?? []) unwrap(await services.coverage.attach(actor, { level: "coverage", id: tree.id }, code));
    for (const entry of specification.coverageValues) unwrap(await services.coverage.writeValue(actor, { level: "coverage", id: tree.id }, entry.path, entry.value as Value));
    for (const entry of specification.benefitValues) unwrap(await services.coverage.writeValue(actor, { level: "benefit", id: benefitId }, entry.path, entry.value as Value));
  }

  for (const kind of attributes) {
    const created = unwrap(await services.product.createAttributeKind(actor, { label: kind.label }));
    expectCode(created.code, kind.code);
    for (const value of kind.values) {
      const next = unwrap(await services.product.addAttributeValue(actor, kind.code, { label: value.label, fragment: value.fragment }));
      expectCode(next.values.at(-1)?.code ?? "", value.code);
    }
  }

  for (const raw of clauses as unknown as Array<Record<string, unknown> & { code: Code; options: Array<Record<string, unknown>> }>) {
    const code = raw.code;
    const definition = omit(raw, ["code", "description", "required"]);
    definition.options = raw.options.map((option) => ({
      ...omit(option, ["code", "order", "values"]),
      values: (option.values as Array<Record<string, unknown>>).map((value) => omit(value, ["code", "order"])),
    }));
    const created = unwrap(await services.clause.create(actor, definition as unknown as NewClause));
    expectCode(created.code, code);
  }

  for (const appendix of appendices) {
    unwrap(await services.document.createAppendix(actor, appendix));
  }

  const generalIds = new Map<string, Id>();
  for (const specification of generals as unknown as Array<{ code: string; tree: DocumentNode }>) {
    const document = unwrap(await services.document.createGeneral(actor, specification.tree.title));
    unwrap(await services.document.apply(actor, document.id, insertAll(document.tree.id, specification.tree)));
    generalIds.set(specification.code, document.id);
  }

  const documentIds = new Map<string, Id>();
  for (const specification of documents as unknown as Array<{ code: string; ownerCoverage: string; general: string; tree: DocumentNode }>) {
    const coverageId = coverageIds.get(specification.ownerCoverage);
    const generalId = generalIds.get(specification.general);
    if (!coverageId || !generalId) throw new Error(`[seed:alphaPlus] 문서 참조를 찾을 수 없음: ${specification.code}`);
    const document = unwrap(await services.document.createSpecial(actor, coverageId, specification.tree.title));
    unwrap(await services.document.setGeneralDocument(actor, document.id, generalId));
    unwrap(await services.document.apply(actor, document.id, insertAll(document.tree.id, specification.tree)));
    documentIds.set(specification.code, document.id);
  }

  let seededProductId: Id | undefined;
  for (const specification of products) {
    const generalId = generalIds.get(specification.general);
    if (!generalId) throw new Error(`[seed:alphaPlus] 보통약관 참조를 찾을 수 없음: ${specification.general}`);
    unwrap(await services.product.setNamingTemplate(actor, specification.namingTemplate));
    const productId = unwrap(await services.product.createProduct(actor, { name: specification.name, generalDocumentId: generalId })).id;
    seededProductId ??= productId;
    // 별표 번호 = 상품 별표 목록 순서 (ADR-0030)
    unwrap(await services.product.setAppendixOrder(actor, productId, specification.appendices ?? []));
    for (const entry of specification.values) unwrap(await services.product.setProductValue(actor, productId, entry.code, undefined, entry.value as Value));

    const optionIds = new Map<string, Id>();
    for (const option of specification.planOptions) {
      const created = unwrap(await services.product.addPlanOption(actor, productId, { axis: option.axis as "type" | "form", number: option.number, name: option.name, planTypeCode: option.planTypeCode }));
      optionIds.set(option.code, created.id);
      for (const entry of option.values) unwrap(await services.product.setPlanOptionValue(actor, created.id, entry.code, entry.fieldCode, entry.value as Value));
    }
    for (const combination of specification.plans) {
      const ids = combination.map((code) => optionIds.get(code));
      if (ids.some((id) => !id)) throw new Error(`[seed:alphaPlus] 세목 선택지 참조를 찾을 수 없음: ${combination.join(",")}`);
      unwrap(await services.product.registerPlan(actor, productId, ids as Id[]));
    }

    const groupIds = new Map<string, Id>();
    for (const group of specification.groups) groupIds.set(group.code, unwrap(await services.product.createGroup(actor, productId, { title: group.title })).id);
    const mountIds = new Map<string, Id>();
    for (const mount of specification.mounts) {
      const coverageId = coverageIds.get(mount.coverage);
      if (!coverageId) throw new Error(`[seed:alphaPlus] 담보 참조를 찾을 수 없음: ${mount.coverage}`);
      const mounted = unwrap(await services.product.mount(actor, productId, coverageId, mount.attributes, mount.section as "base" | "special"));
      mountIds.set(mount.code, mounted.id);
      if (mount.group) {
        const groupId = groupIds.get(mount.group);
        if (!groupId) throw new Error(`[seed:alphaPlus] 그룹 참조를 찾을 수 없음: ${mount.group}`);
        unwrap(await services.product.placeInGroup(actor, groupId, mounted.id));
      }
    }
  }

  if (!seededProductId) throw new Error("[seed:alphaPlus] 상품 JSON이 비어 있습니다");
  await assertAssembles(services, seededProductId);
  return { created: true, productId: seededProductId };
}
