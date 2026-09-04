/**
 * 카탈로그 스키마 — 구분자 정의 · 구조체 필드 · enum · enum 값 · 코드 채번 시퀀스.
 *
 * 근거: docs/01_기획/구분자_기획.md · ADR-0001 · ADR-0004 · ADR-0005.
 *
 * - 코드(`code`)는 시스템 자동 채번 · 불변 · 참조의 정본. id(uuid) 는 저장소용.
 * - 값 행(실체 × 구분자의 ValueSlot)은 여기 없다 — 값은 부착 실체를 소유한 영역
 *   (coverage · product)이 저장한다. 카탈로그는 정의만 갖는다.
 * - 기본값(default_value)은 폼 프리필 전용 — 저장소의 값 자리로 유입되지 않는다 (ADR-0004).
 * - 타임스탬프·created_by/updated_by 자리(who)를 남긴다. FK 는 걸지 않는다 (영역 결합 회피).
 *
 * 표준 Postgres 만 쓴다 (PGlite 전용 기능 금지).
 */
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type { FieldType, Value } from "@/domain/types";

/** 감사 컬럼 — 모든 카탈로그 테이블 공통. */
const audit = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  /** 만든 사람 (users.id). FK 없음. */
  createdBy: uuid("created_by"),
  /** 마지막으로 고친 사람 (users.id). FK 없음. */
  updatedBy: uuid("updated_by"),
};

/**
 * 구분자 정의. 종류(kind)별로 쓰는 컬럼이 다르다 — 도메인 타입 `Discriminator` 의
 * 판별 합집합을 한 테이블에 편 것 (single table).
 *
 * | kind    | level | always_exposed | scalar_type | default_value | const_value | expression | 필드 |
 * |---------|-------|----------------|-------------|---------------|-------------|------------|------|
 * | scalar  | ○     | ○              | ○           | 선택          | —           | —          | —    |
 * | struct  | ○     | ○              | —           | —             | —           | —          | ○    |
 * | const   | —     | —              | —           | —             | ○ (string)  | —          | —    |
 * | derived | ○     | —              | —           | —             | —           | ○          | —    |
 */
export const discriminators = pgTable("discriminators", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** 자동 채번 코드 `D0001` … (불변). */
  code: text("code").notNull().unique(),
  /** "scalar" | "struct" | "const" | "derived" */
  kind: text("kind").notNull(),
  label: text("label").notNull(),
  /** AttachLevel. const 는 null (D-P1-13). */
  level: text("level"),
  /** 무조건 노출 (담보_기획). const·derived 는 false 고정. */
  alwaysExposed: boolean("always_exposed").notNull().default(false),
  description: text("description").notNull().default(""),
  /** scalar 의 타입 (FieldType). */
  scalarType: jsonb("scalar_type").$type<FieldType>(),
  /** scalar 의 기본값 (프리필 전용). */
  defaultValue: jsonb("default_value").$type<Value>(),
  /** const 의 값 — MVP 는 string 만. */
  constValue: text("const_value"),
  /** derived 의 식 원문 — 파싱은 expression 모듈. 데이터로 저장한다 (ADR-0007). */
  expression: text("expression"),
  ...audit,
});

/** 구조체 필드. 코드는 구조체 안에서 유일 (`F01` …). */
export const structFields = pgTable(
  "struct_fields",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    discriminatorId: uuid("discriminator_id")
      .notNull()
      .references(() => discriminators.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    label: text("label").notNull(),
    /** FieldType — 구조체 중첩 금지는 타입 자체로 막힌다. */
    type: jsonb("type").$type<FieldType>().notNull(),
    /** 기본값 (프리필 전용). */
    defaultValue: jsonb("default_value").$type<Value>(),
    /** 폼 렌더 순서 (D-P1-5). */
    order: integer("order").notNull(),
    ...audit,
  },
  (t) => [uniqueIndex("struct_fields_owner_code").on(t.discriminatorId, t.code)],
);

/** enum 정의. 코드 `E0001` … (D-P1-7 — enum 정의도 코드+표시명). */
export const enums = pgTable("enums", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  label: text("label").notNull(),
  ...audit,
});

/** enum 값. 코드는 enum 안에서 유일 (`V01` …). */
export const enumValues = pgTable(
  "enum_values",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    enumId: uuid("enum_id")
      .notNull()
      .references(() => enums.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    label: text("label").notNull(),
    /** 선택지 표시 순서 (D-P1-8). */
    order: integer("order").notNull(),
    ...audit,
  },
  (t) => [uniqueIndex("enum_values_owner_code").on(t.enumId, t.code)],
);

/**
 * 코드 채번 시퀀스. (kind, scope) 마다 다음 순번을 갖는다.
 * - kind: "discriminator" | "enum" 은 scope "" (전역)
 * - kind: "field" 는 scope = 구조체 코드, "enumValue" 는 scope = enum 코드
 * 삭제된 코드의 순번은 재사용하지 않는다 — 순번은 오르기만 한다.
 */
export const codeSequences = pgTable(
  "code_sequences",
  {
    kind: text("kind").notNull(),
    scope: text("scope").notNull(),
    /** 다음에 줄 순번 (1부터). */
    next: integer("next").notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.kind, t.scope] })],
);
