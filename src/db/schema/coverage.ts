/**
 * 담보 스키마 — 담보 > 세부보장 > 급부 (도메인모델 §1 · 담보_기획).
 *
 * - 실체는 뼈대만: id · 관계(FK) · 순서(order) · 이름. 그 외 입력값은 공용 값 저장소(entity_values)에
 *   owner_kind = coverage | subCoverage | benefit 로 산다. 부착 관계도 entity_attachments.
 * - 형제 간 이름 중복 금지는 UQ(부모, name). 담보명은 마스터 전역 유일 (D-P2-2).
 * - 순서는 데이터 — order 0부터. 순서 변경은 트리 편집 액션이 전체를 다시 매긴다.
 * - 하위 삭제는 FK cascade. 값 행 연쇄 삭제는 서비스가 한다 (값 저장소에 FK 없음).
 * - 문면(담보약관 마스터)은 B3 document 영역 소유 — document_id 자리만 두고 FK 는 걸지 않는다.
 *
 * 표준 Postgres 만 쓴다 (PGlite 전용 기능 금지).
 */
import { integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/** 감사 컬럼 — 카탈로그와 같은 모양. */
const audit = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by"),
  updatedBy: uuid("updated_by"),
};

export const coverages = pgTable("coverages", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** 담보명 — 마스터 전역 유일. 뼈대 속성(스냅샷 비대상). */
  name: text("name").notNull().unique(),
  description: text("description").notNull().default(""),
  /** 담보약관 마스터 문서 id (B3). 문면 없는 담보 허용 → nullable. */
  documentId: uuid("document_id"),
  ...audit,
});

export const subCoverages = pgTable(
  "sub_coverages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    coverageId: uuid("coverage_id")
      .notNull()
      .references(() => coverages.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** 형제 순서 (0부터) — 문면 수록·반복 순회 순서. */
    order: integer("order").notNull(),
    ...audit,
  },
  (t) => [uniqueIndex("sub_coverages_sibling_name").on(t.coverageId, t.name)],
);

export const benefits = pgTable(
  "benefits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subCoverageId: uuid("sub_coverage_id")
      .notNull()
      .references(() => subCoverages.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    order: integer("order").notNull(),
    ...audit,
  },
  (t) => [uniqueIndex("benefits_sibling_name").on(t.subCoverageId, t.name)],
);
