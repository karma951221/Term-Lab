/**
 * 상품 스키마 — 담보속성 카탈로그 · 상품 · 세목 · 상품담보(탑재 스냅샷) · 기본계약 · 특약 그룹 · 옵션 오버라이드.
 *
 * 근거: docs/01_기획/상품탑재_기획.md · 조립_기획 · ADR-0002 · ADR-0006 · ADR-0011 · ADR-0015 · ADR-0017.
 *
 * - 값(상품 레벨 값 · 세목 선택지의 유형 구조체 값 · 스냅샷 값)은 여기 없다 — 공용 값 저장소
 *   (`entity_values`, owner kind `product | plan | productCoverage | productSubCoverage | productBenefit`) 에 산다.
 *   owner id = 각각 products.id · plan_options.id · product_coverages.id · product_coverage_nodes.id.
 * - 다른 영역(담보 마스터 · 문서)의 id 는 uuid 로 담되 FK 는 걸지 않는다 (영역 결합 회피). 상품 영역 안의
 *   FK 는 cascade — 값 행의 연쇄 삭제는 서비스가 한다 (값 저장소에 FK 없음).
 * - 코드(`A0001` · `V01`)는 카탈로그와 같은 `code_sequences` 테이블에 kind `attribute` / `attributeValue` 로 채번.
 *
 * 표준 Postgres 만 쓴다 (PGlite 전용 기능 금지).
 */
import { integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import type { ClauseOptionSelection } from "@/domain/product/types";

/** 감사 컬럼 — 상품 영역 테이블 공통. */
const audit = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  /** 만든 사람 (users.id). FK 없음. */
  createdBy: uuid("created_by"),
  /** 마지막으로 고친 사람 (users.id). FK 없음. */
  updatedBy: uuid("updated_by"),
};

// ───────────────────────────── 담보속성 카탈로그 (ADR-0015) ─────────────────────────────

/** 담보속성 종류. 코드 `A0001` (전역 채번 · 불변). order = 카탈로그 전역 적용 순서 (D-P5-4). */
export const attributeKinds = pgTable("attribute_kinds", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  label: text("label").notNull(),
  order: integer("order").notNull(),
  ...audit,
});

/** 담보속성 유효값. 코드 `V01` 은 종류 안에서 유일. 작명 규칙(prefix/suffix)은 빈 문자열 = 규칙 없음. */
export const attributeValues = pgTable(
  "attribute_values",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kindId: uuid("kind_id")
      .notNull()
      .references(() => attributeKinds.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    label: text("label").notNull(),
    order: integer("order").notNull(),
    prefix: text("prefix").notNull().default(""),
    suffix: text("suffix").notNull().default(""),
    ...audit,
  },
  (t) => [uniqueIndex("attribute_values_owner_code").on(t.kindId, t.code)],
);

// ───────────────────────────── 상품 ─────────────────────────────

export const products = pgTable("products", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  /** 보통약관 템플릿(문서) id. FK 없음. MVP 는 1개. */
  generalDocumentId: uuid("general_document_id"),
  ...audit,
});

// ───────────────────────────── 세목 (ADR-0006) ─────────────────────────────

/** 세목 선택지 `(축, 번호, 이름, 세목유형 참조)`. 유형 구조체 값은 entity_values owner plan. */
export const planOptions = pgTable(
  "plan_options",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** "type"(종) | "form"(형) */
    axis: text("axis").notNull(),
    number: integer("number").notNull(),
    name: text("name").notNull(),
    /** 세목유형 = plan 레벨 구조체 구분자 코드. */
    planTypeCode: text("plan_type_code").notNull(),
    ...audit,
  },
  (t) => [uniqueIndex("plan_options_axis_number").on(t.productId, t.axis, t.number)],
);

/** 상품세목 = 명시 등록된 유효 조합. */
export const productPlans = pgTable("product_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "cascade" }),
  /** 조합 정체성 키 (선택지 id 정렬 결합) — 중복 등록 거부의 근거. */
  key: text("key").notNull(),
  ...audit,
}, (t) => [uniqueIndex("product_plans_key").on(t.productId, t.key)]);

/** 조합 구성 — 축마다 선택지 하나. */
export const productPlanOptions = pgTable(
  "product_plan_options",
  {
    planId: uuid("plan_id")
      .notNull()
      .references(() => productPlans.id, { onDelete: "cascade" }),
    optionId: uuid("option_id")
      .notNull()
      .references(() => planOptions.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.planId, t.optionId] })],
);

// ───────────────────────────── 상품담보 = 탑재 (ADR-0002 · ADR-0015) ─────────────────────────────

/** 상품담보. 조합 키(담보 id + 속성 선택)가 상품 안에서 유일. 담보 레벨 스냅샷 값 owner = productCoverage/이 id. */
export const productCoverages = pgTable(
  "product_coverages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** 담보 마스터 id (B1). FK 없음. */
    coverageId: uuid("coverage_id").notNull(),
    /** 탑재 시점 담보명 (작명 재생성 재료 — 마스터 담보명 변경은 스냅샷에 무영향). */
    coverageName: text("coverage_name").notNull(),
    name: text("name").notNull(),
    /** 조합 유일성 키 — domain `combinationKey`. */
    combinationKey: text("combination_key").notNull(),
    ...audit,
  },
  (t) => [uniqueIndex("product_coverages_combination").on(t.productId, t.combinationKey)],
);

/** 담보속성 값 조합 (sparse — 사용한 종류만). 코드 참조 · FK 없음 (삭제된 속성은 깨진 참조로 남는다). */
export const productCoverageAttributes = pgTable(
  "product_coverage_attributes",
  {
    productCoverageId: uuid("product_coverage_id")
      .notNull()
      .references(() => productCoverages.id, { onDelete: "cascade" }),
    kindCode: text("kind_code").notNull(),
    valueCode: text("value_code").notNull(),
  },
  (t) => [primaryKey({ columns: [t.productCoverageId, t.kindCode] })],
);

/**
 * 스냅샷 노드 — 마스터 세부보장·급부 ↔ 스냅샷 실체 대응. 값 owner = kind 별 productSubCoverage / productBenefit, id = 이 행 id.
 * 마스터에 노드가 추가되면 빈 대응 노드가 생기고, 사라지면 값 행과 함께 삭제된다 (syncStructure).
 */
export const productCoverageNodes = pgTable(
  "product_coverage_nodes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productCoverageId: uuid("product_coverage_id")
      .notNull()
      .references(() => productCoverages.id, { onDelete: "cascade" }),
    /** "sub" | "benefit" */
    kind: text("kind").notNull(),
    /** 마스터 노드 id (B1). FK 없음. */
    masterNodeId: uuid("master_node_id").notNull(),
    /** 급부의 소속 세부보장 스냅샷 노드. 세부보장은 null. */
    parentId: uuid("parent_id"),
    name: text("name").notNull(),
    order: integer("order").notNull(),
    ...audit,
  },
  (t) => [uniqueIndex("product_coverage_nodes_master").on(t.productCoverageId, t.masterNodeId)],
);

/** 상품담보별 세목 부착 (적용범위). 기본은 미부착. */
export const productCoveragePlans = pgTable(
  "product_coverage_plans",
  {
    productCoverageId: uuid("product_coverage_id")
      .notNull()
      .references(() => productCoverages.id, { onDelete: "cascade" }),
    planId: uuid("plan_id")
      .notNull()
      .references(() => productPlans.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
  },
  (t) => [primaryKey({ columns: [t.productCoverageId, t.planId] })],
);

// ───────────────────────────── 기본계약 (ADR-0011) ─────────────────────────────

/** 상품 ↔ 상품담보 관계 — 복수 허용 구조. 「정확히 1개」는 검증 규칙(지정 액션·완결성 조회). */
export const productBaseContracts = pgTable(
  "product_base_contracts",
  {
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    productCoverageId: uuid("product_coverage_id")
      .notNull()
      .references(() => productCoverages.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
  },
  (t) => [primaryKey({ columns: [t.productId, t.productCoverageId] })],
);

// ───────────────────────────── 특약 그룹 (조립_기획) ─────────────────────────────

export const specialGroups = pgTable("special_groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  order: integer("order").notNull(),
  /** 한 그룹 = 한 보통약관 템플릿. null 이면 상품 것을 따른다. MVP 는 상품 것과 같아야 함. */
  generalDocumentId: uuid("general_document_id"),
  ...audit,
});

/** 그룹 소속 — 상품담보 하나는 한 그룹에만. 그룹 안 순서는 저장하지 않는다 (자동 정렬). */
export const specialGroupMembers = pgTable(
  "special_group_members",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => specialGroups.id, { onDelete: "cascade" }),
    productCoverageId: uuid("product_coverage_id")
      .notNull()
      .references(() => productCoverages.id, { onDelete: "cascade" })
      .unique(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.productCoverageId] })],
);

// ───────────────────────────── 옵션 오버라이드 (ADR-0017) ─────────────────────────────

/** 공용조항 옵션 오버라이드 — 보통약관은 상품별(scope product), 담보약관은 상품담보별(scope productCoverage). */
export const clauseOptionOverrides = pgTable(
  "clause_option_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** "product" | "productCoverage" */
    scopeKind: text("scope_kind").notNull(),
    scopeId: uuid("scope_id").notNull(),
    /** 문서 안 공용조항 참조 노드 id (B3). FK 없음. */
    nodeId: uuid("node_id").notNull(),
    clauseCode: text("clause_code").notNull(),
    /** 옵션 자리 → 선택 코드. 유효 집합 검증은 B2 OptionValidator. */
    options: jsonb("options").$type<ClauseOptionSelection>().notNull(),
    ...audit,
  },
  (t) => [uniqueIndex("clause_option_overrides_key").on(t.scopeKind, t.scopeId, t.nodeId, t.clauseCode)],
);
