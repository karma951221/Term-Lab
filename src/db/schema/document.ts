/**
 * 문면 스키마 — 문서(담보약관 · 보통약관 마스터) · 별표 마스터.
 *
 * 근거: ADR-0012 (문서 1건 = 트리 JSON 1건) · 문면_기획 · D-P4-1 · D-P4-5 · D-P4-23.
 *
 * - documents: 종류(special = 담보약관, 소유 = 담보 id, 담보 1 : 문서 1 / general = 보통약관 마스터, 여러 벌, 이름 유일).
 *   트리는 jsonb 한 덩어리 (`DocumentNode`). 번호는 저장하지 않는다.
 *   `general_document_id` = 담보약관이 지정한 대응 보통약관 (조연결·보통약관 조 참조의 대상 범위, D-P4-5).
 *   owner_id 는 담보 테이블의 id 이지만 FK 는 걸지 않는다 (영역 결합 회피 — 삭제 연쇄는 서비스가).
 * - appendices: 전상품 superset. 코드는 유저 입력 · 불변 · 유일. 내용 출력은 MVP 밖.
 *
 * 표준 Postgres 만 쓴다 (PGlite 전용 기능 금지).
 */
import { jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import type { DocumentNode } from "@/domain/document/nodes";

const audit = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by"),
  updatedBy: uuid("updated_by"),
};

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** "special" | "general" */
    kind: text("kind").notNull(),
    /** special 의 소유 담보 id. general 은 null. */
    ownerId: uuid("owner_id"),
    /** 문서 제목 — general 은 마스터 명(유일, D-P4-1). 트리 루트의 title 과 같은 값을 유지한다. */
    title: text("title").notNull(),
    /** special 이 지정한 대응 보통약관 문서 id (D-P4-5). */
    generalDocumentId: uuid("general_document_id"),
    /** 노드 트리 (ADR-0012). */
    tree: jsonb("tree").$type<DocumentNode>().notNull(),
    ...audit,
  },
  // 담보 1 : 문서 1 — owner_id 유니크 (general 의 null 은 서로 구별된다)
  (t) => [uniqueIndex("documents_owner").on(t.ownerId)],
);

export const appendices = pgTable("appendices", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** 유저 입력 불변 코드 (D-P4-23). */
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  ...audit,
});
