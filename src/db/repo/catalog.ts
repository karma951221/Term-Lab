/**
 * 카탈로그 저장소 — drizzle 쿼리만. 규칙 없음 (규칙은 src/domain/catalog, 조립은 src/services/catalog).
 *
 * 도메인 객체(Discriminator · EnumDef) ↔ 행 매핑을 여기서 한다.
 * 필드·enum 값은 코드 기준 upsert — 코드가 남아 있는 행은 갱신, 없어진 행은 삭제.
 */
import { and, asc, eq, notInArray, sql } from "drizzle-orm";

import type { CodeKind, NextSeq } from "@/domain/catalog/codes";
import type {
  Discriminator,
  EnumDef,
  EnumValueDef,
  FieldDef,
} from "@/domain/catalog/types";
import type { AttachLevel, Code, Id } from "@/domain/types";

import { codeSequences, discriminators, enumValues, enums, structFields } from "../schema";
import type { Db } from "./types";

// ───────────────────────────── 채번 ─────────────────────────────

/**
 * (kind, scope) 의 다음 순번을 원자적으로 뽑는다 — 한 문장의 upsert 라 동시 호출에도 안전.
 * 삭제된 순번은 재사용하지 않는다.
 */
export async function nextSeq(db: Db, kind: CodeKind, scope: string): Promise<number> {
  const [row] = await db
    .insert(codeSequences)
    .values({ kind, scope, next: 2 })
    .onConflictDoUpdate({
      target: [codeSequences.kind, codeSequences.scope],
      set: { next: sql`${codeSequences.next} + 1` },
    })
    .returning({ next: codeSequences.next });
  return row.next - 1;
}

export function seqSource(db: Db): NextSeq {
  return (kind, scope) => nextSeq(db, kind, scope);
}

// ───────────────────────────── 매핑 ─────────────────────────────

type DiscriminatorRow = typeof discriminators.$inferSelect;
type FieldRow = typeof structFields.$inferSelect;
type EnumRow = typeof enums.$inferSelect;
type EnumValueRow = typeof enumValues.$inferSelect;

function toField(row: FieldRow): FieldDef {
  return {
    code: row.code,
    label: row.label,
    type: row.type,
    ...(row.defaultValue !== null && row.defaultValue !== undefined ? { defaultValue: row.defaultValue } : {}),
    order: row.order,
  };
}

function toDiscriminator(row: DiscriminatorRow, fields: FieldRow[]): Discriminator {
  const base = { code: row.code, label: row.label, description: row.description };
  switch (row.kind) {
    case "scalar":
      return {
        kind: "scalar",
        ...base,
        level: row.level as AttachLevel,
        alwaysExposed: row.alwaysExposed,
        type: row.scalarType!,
        ...(row.defaultValue !== null && row.defaultValue !== undefined ? { defaultValue: row.defaultValue } : {}),
      };
    case "struct":
      return {
        kind: "struct",
        ...base,
        level: row.level as AttachLevel,
        alwaysExposed: row.alwaysExposed,
        fields: fields.map(toField),
      };
    case "const":
      return { kind: "const", ...base, value: row.constValue ?? "" };
    case "derived":
      return { kind: "derived", ...base, level: row.level as AttachLevel, expression: row.expression ?? "" };
    default:
      throw new Error(`알 수 없는 구분자 종류: ${row.kind}`);
  }
}

function toRow(def: Discriminator): Omit<typeof discriminators.$inferInsert, "id" | "createdAt" | "updatedAt" | "createdBy" | "updatedBy"> {
  const base = { code: def.code, kind: def.kind, label: def.label, description: def.description };
  switch (def.kind) {
    case "scalar":
      return {
        ...base,
        level: def.level,
        alwaysExposed: def.alwaysExposed,
        scalarType: def.type,
        defaultValue: def.defaultValue ?? null,
        constValue: null,
        expression: null,
      };
    case "struct":
      return { ...base, level: def.level, alwaysExposed: def.alwaysExposed, scalarType: null, defaultValue: null, constValue: null, expression: null };
    case "const":
      return { ...base, level: null, alwaysExposed: false, scalarType: null, defaultValue: null, constValue: def.value, expression: null };
    case "derived":
      return { ...base, level: def.level, alwaysExposed: false, scalarType: null, defaultValue: null, constValue: null, expression: def.expression };
  }
}

function toEnum(row: EnumRow, values: EnumValueRow[]): EnumDef {
  return {
    code: row.code,
    label: row.label,
    values: values.map<EnumValueDef>((v) => ({ code: v.code, label: v.label, order: v.order })),
  };
}

// ───────────────────────────── 구분자 ─────────────────────────────

async function fieldsOf(db: Db, discriminatorId: Id): Promise<FieldRow[]> {
  return db
    .select()
    .from(structFields)
    .where(eq(structFields.discriminatorId, discriminatorId))
    .orderBy(asc(structFields.order), asc(structFields.code));
}

export async function findDiscriminatorRow(db: Db, code: Code): Promise<DiscriminatorRow | undefined> {
  const [row] = await db.select().from(discriminators).where(eq(discriminators.code, code)).limit(1);
  return row;
}

export async function loadDiscriminator(db: Db, code: Code): Promise<Discriminator | undefined> {
  const row = await findDiscriminatorRow(db, code);
  if (!row) return undefined;
  const fields = row.kind === "struct" ? await fieldsOf(db, row.id) : [];
  return toDiscriminator(row, fields);
}

/** 코드 순 전체 목록. */
export async function listDiscriminators(db: Db): Promise<Discriminator[]> {
  const rows = await db.select().from(discriminators).orderBy(asc(discriminators.code));
  const allFields = await db.select().from(structFields).orderBy(asc(structFields.order), asc(structFields.code));
  const byOwner = new Map<Id, FieldRow[]>();
  for (const f of allFields) {
    const list = byOwner.get(f.discriminatorId) ?? [];
    list.push(f);
    byOwner.set(f.discriminatorId, list);
  }
  return rows.map((r) => toDiscriminator(r, byOwner.get(r.id) ?? []));
}

/** 새 정의 저장 (행 + 필드). */
export async function insertDiscriminator(db: Db, def: Discriminator, who: Id): Promise<void> {
  const [row] = await db
    .insert(discriminators)
    .values({ ...toRow(def), createdBy: who, updatedBy: who })
    .returning({ id: discriminators.id });
  if (def.kind === "struct" && def.fields.length > 0) {
    await db.insert(structFields).values(
      def.fields.map((f) => ({
        discriminatorId: row.id,
        code: f.code,
        label: f.label,
        type: f.type,
        defaultValue: f.defaultValue ?? null,
        order: f.order,
        createdBy: who,
        updatedBy: who,
      })),
    );
  }
}

/** 기존 정의 덮어쓰기 (행 갱신 + 필드 upsert/삭제). 코드는 바뀌지 않는다. */
export async function saveDiscriminator(db: Db, def: Discriminator, who: Id): Promise<void> {
  const now = new Date();
  const [row] = await db
    .update(discriminators)
    .set({ ...toRow(def), updatedAt: now, updatedBy: who })
    .where(eq(discriminators.code, def.code))
    .returning({ id: discriminators.id });
  if (!row) throw new Error(`저장 대상 구분자가 없습니다: ${def.code}`);

  if (def.kind !== "struct") return;
  const keep = def.fields.map((f) => f.code);
  if (keep.length === 0) {
    await db.delete(structFields).where(eq(structFields.discriminatorId, row.id));
  } else {
    await db
      .delete(structFields)
      .where(and(eq(structFields.discriminatorId, row.id), notInArray(structFields.code, keep)));
  }
  for (const f of def.fields) {
    await db
      .insert(structFields)
      .values({
        discriminatorId: row.id,
        code: f.code,
        label: f.label,
        type: f.type,
        defaultValue: f.defaultValue ?? null,
        order: f.order,
        createdBy: who,
        updatedBy: who,
      })
      .onConflictDoUpdate({
        target: [structFields.discriminatorId, structFields.code],
        set: { label: f.label, type: f.type, defaultValue: f.defaultValue ?? null, order: f.order, updatedAt: now, updatedBy: who },
      });
  }
}

export async function deleteDiscriminator(db: Db, code: Code): Promise<void> {
  await db.delete(discriminators).where(eq(discriminators.code, code)); // 필드는 FK cascade
}

/** 감사 정보 (who · when). */
export async function discriminatorAudit(db: Db, code: Code) {
  const row = await findDiscriminatorRow(db, code);
  if (!row) return undefined;
  return { createdAt: row.createdAt, updatedAt: row.updatedAt, createdBy: row.createdBy, updatedBy: row.updatedBy };
}

// ───────────────────────────── enum ─────────────────────────────

async function valuesOf(db: Db, enumId: Id): Promise<EnumValueRow[]> {
  return db
    .select()
    .from(enumValues)
    .where(eq(enumValues.enumId, enumId))
    .orderBy(asc(enumValues.order), asc(enumValues.code));
}

export async function loadEnum(db: Db, code: Code): Promise<EnumDef | undefined> {
  const [row] = await db.select().from(enums).where(eq(enums.code, code)).limit(1);
  if (!row) return undefined;
  return toEnum(row, await valuesOf(db, row.id));
}

export async function listEnums(db: Db): Promise<EnumDef[]> {
  const rows = await db.select().from(enums).orderBy(asc(enums.code));
  const all = await db.select().from(enumValues).orderBy(asc(enumValues.order), asc(enumValues.code));
  const byOwner = new Map<Id, EnumValueRow[]>();
  for (const v of all) {
    const list = byOwner.get(v.enumId) ?? [];
    list.push(v);
    byOwner.set(v.enumId, list);
  }
  return rows.map((r) => toEnum(r, byOwner.get(r.id) ?? []));
}

export async function insertEnum(db: Db, def: EnumDef, who: Id): Promise<void> {
  const [row] = await db
    .insert(enums)
    .values({ code: def.code, label: def.label, createdBy: who, updatedBy: who })
    .returning({ id: enums.id });
  if (def.values.length > 0) {
    await db.insert(enumValues).values(
      def.values.map((v) => ({ enumId: row.id, code: v.code, label: v.label, order: v.order, createdBy: who, updatedBy: who })),
    );
  }
}

export async function saveEnum(db: Db, def: EnumDef, who: Id): Promise<void> {
  const now = new Date();
  const [row] = await db
    .update(enums)
    .set({ label: def.label, updatedAt: now, updatedBy: who })
    .where(eq(enums.code, def.code))
    .returning({ id: enums.id });
  if (!row) throw new Error(`저장 대상 enum 이 없습니다: ${def.code}`);

  const keep = def.values.map((v) => v.code);
  if (keep.length === 0) {
    await db.delete(enumValues).where(eq(enumValues.enumId, row.id));
  } else {
    await db.delete(enumValues).where(and(eq(enumValues.enumId, row.id), notInArray(enumValues.code, keep)));
  }
  for (const v of def.values) {
    await db
      .insert(enumValues)
      .values({ enumId: row.id, code: v.code, label: v.label, order: v.order, createdBy: who, updatedBy: who })
      .onConflictDoUpdate({
        target: [enumValues.enumId, enumValues.code],
        set: { label: v.label, order: v.order, updatedAt: now, updatedBy: who },
      });
  }
}

export async function deleteEnum(db: Db, code: Code): Promise<void> {
  await db.delete(enums).where(eq(enums.code, code)); // 값은 FK cascade
}
