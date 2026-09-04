/**
 * 공용 값 저장소 — 실체 × 구분자의 값 자리(ValueSlot)와 선택적 노출 부착 관계.
 *
 * 근거: ADR-0004 (null 없음 · 미입력은 상태) · ADR-0002 (탑재 = 값 스냅샷) · 담보_기획 노출여부.
 *
 * - **미입력 = 행 없음.** 행이 있으면 명시 입력된 값이다. null 값 행은 존재하지 않는다.
 * - 소유자(owner)는 부착 5레벨 실체(product · plan · coverage · subCoverage · benefit)와
 *   스냅샷 실체(productCoverage 와 그 하위 productSubCoverage · productBenefit · productPlan).
 *   소유자 id 는 각 영역 테이블의 id 이지만 FK 는 걸지 않는다 (영역 결합 회피 — 삭제 연쇄는 서비스가 한다).
 * - 경로 표기는 catalog `slotPath()` 와 같다: `D0001` (scalar) · `D0002.F01` (구조체 필드).
 *   field_code 는 nullable 대신 빈 문자열 '' 로 두어 유니크 제약이 성립하게 한다.
 * - 값은 jsonb (Value = string | number | boolean | string[]).
 */
import { jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import type { Value } from "@/domain/types";

export const entityValues = pgTable(
  "entity_values",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** ValueOwnerKind */
    ownerKind: text("owner_kind").notNull(),
    ownerId: uuid("owner_id").notNull(),
    discriminatorCode: text("discriminator_code").notNull(),
    /** 구조체 필드 코드. scalar 는 ''. */
    fieldCode: text("field_code").notNull().default(""),
    value: jsonb("value").$type<Value>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
  },
  (t) => [
    uniqueIndex("entity_values_slot").on(t.ownerKind, t.ownerId, t.discriminatorCode, t.fieldCode),
  ],
);

/**
 * 선택적 노출 구분자의 부착 관계 (담보_기획 「노출여부」). 무조건 노출 구분자는 여기 없다 —
 * 정의의 always_exposed 가 곧 전 실체 부착이다. 부착 여부 판단 = always_exposed ∨ 이 행 존재.
 */
export const entityAttachments = pgTable(
  "entity_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerKind: text("owner_kind").notNull(),
    ownerId: uuid("owner_id").notNull(),
    discriminatorCode: text("discriminator_code").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
  },
  (t) => [uniqueIndex("entity_attachments_key").on(t.ownerKind, t.ownerId, t.discriminatorCode)],
);
