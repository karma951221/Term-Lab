/**
 * 공용 값 저장소 repo — 실체 × 구분자 값 자리 · 부착 관계. drizzle 쿼리만, 규칙 없음.
 *
 * 담보(B1)·상품(B4) 영역이 함께 쓴다. 값의 타입 검증은 catalog `validateValue` 가,
 * 어느 구분자가 어느 실체에 붙는지는 각 영역 서비스가 판단한다.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import type { ImpactSource, ImpactTarget } from "@/domain/catalog/impact";
import type { SlotPath } from "@/domain/catalog/types";
import { slotPath } from "@/domain/catalog/values";
import type { Code, Id, Value, ValueSlot } from "@/domain/types";

import { entityAttachments, entityValues } from "../schema";
import type { Db } from "./types";

/** 값 자리를 소유하는 실체의 종류. 부착 5레벨 + 탑재 스냅샷 실체. */
export type ValueOwnerKind =
  | "product"
  | "plan"
  | "coverage"
  | "subCoverage"
  | "benefit"
  | "productCoverage"
  | "productSubCoverage"
  | "productBenefit"
  | "productPlan";

export interface ValueOwner {
  kind: ValueOwnerKind;
  id: Id;
}

// ───────────────────────────── 값 자리 ─────────────────────────────

/** 소유자의 명시 입력 값 전부. 키는 slotPath. 없는 경로 = 미입력. */
export async function readSlots(db: Db, owner: ValueOwner): Promise<Map<SlotPath, ValueSlot>> {
  const rows = await db
    .select({
      code: entityValues.discriminatorCode,
      field: entityValues.fieldCode,
      value: entityValues.value,
    })
    .from(entityValues)
    .where(and(eq(entityValues.ownerKind, owner.kind), eq(entityValues.ownerId, owner.id)));
  const map = new Map<SlotPath, ValueSlot>();
  for (const r of rows) {
    map.set(slotPath(r.code, r.field || undefined), { entered: true, value: r.value });
  }
  return map;
}

/** 여러 소유자의 값을 한 번에. 키 = ownerId. */
export async function readSlotsMany(
  db: Db,
  kind: ValueOwnerKind,
  ids: Id[],
): Promise<Map<Id, Map<SlotPath, ValueSlot>>> {
  const out = new Map<Id, Map<SlotPath, ValueSlot>>();
  for (const id of ids) out.set(id, new Map());
  if (ids.length === 0) return out;
  const rows = await db
    .select({
      ownerId: entityValues.ownerId,
      code: entityValues.discriminatorCode,
      field: entityValues.fieldCode,
      value: entityValues.value,
    })
    .from(entityValues)
    .where(and(eq(entityValues.ownerKind, kind), inArray(entityValues.ownerId, ids)));
  for (const r of rows) {
    out.get(r.ownerId)!.set(slotPath(r.code, r.field || undefined), { entered: true, value: r.value });
  }
  return out;
}

/**
 * 값 자리 쓰기. `value === undefined` 면 값 지우기(행 삭제 → 미입력).
 * 기본값이 여기로 자동 유입되는 경로는 없다 — 호출자는 사람이 확인한 값만 넘긴다.
 */
export async function writeSlot(
  db: Db,
  owner: ValueOwner,
  discriminatorCode: Code,
  fieldCode: Code | undefined,
  value: Value | undefined,
  by?: Id,
): Promise<void> {
  const field = fieldCode ?? "";
  if (value === undefined) {
    await db
      .delete(entityValues)
      .where(
        and(
          eq(entityValues.ownerKind, owner.kind),
          eq(entityValues.ownerId, owner.id),
          eq(entityValues.discriminatorCode, discriminatorCode),
          eq(entityValues.fieldCode, field),
        ),
      );
    return;
  }
  await db
    .insert(entityValues)
    .values({
      ownerKind: owner.kind,
      ownerId: owner.id,
      discriminatorCode,
      fieldCode: field,
      value,
      updatedBy: by,
    })
    .onConflictDoUpdate({
      target: [
        entityValues.ownerKind,
        entityValues.ownerId,
        entityValues.discriminatorCode,
        entityValues.fieldCode,
      ],
      set: { value, updatedAt: sql`now()`, updatedBy: by },
    });
}

/** 소유자의 값 행 전부 삭제 (실체 삭제 시 연쇄). 삭제한 행 수. */
export async function clearSlots(db: Db, owner: ValueOwner): Promise<number> {
  const rows = await db
    .delete(entityValues)
    .where(and(eq(entityValues.ownerKind, owner.kind), eq(entityValues.ownerId, owner.id)))
    .returning({ id: entityValues.id });
  return rows.length;
}

/**
 * 탑재 스냅샷 — from 의 명시 값을 to 로 복사한다 (ADR-0002). 미입력은 복사할 게 없어 그대로 미입력.
 * to 에 이미 있는 자리는 덮어쓴다. 복사한 행 수를 돌려준다.
 */
export async function copySlots(db: Db, from: ValueOwner, to: ValueOwner, by?: Id): Promise<number> {
  const rows = await db
    .select({
      code: entityValues.discriminatorCode,
      field: entityValues.fieldCode,
      value: entityValues.value,
    })
    .from(entityValues)
    .where(and(eq(entityValues.ownerKind, from.kind), eq(entityValues.ownerId, from.id)));
  for (const r of rows) {
    await writeSlot(db, to, r.code, r.field || undefined, r.value, by);
  }
  return rows.length;
}

// ───────────────────────────── 부착 ─────────────────────────────

/** 선택적 노출 구분자 부착 (멱등). */
export async function attach(db: Db, owner: ValueOwner, discriminatorCode: Code, by?: Id): Promise<void> {
  await db
    .insert(entityAttachments)
    .values({ ownerKind: owner.kind, ownerId: owner.id, discriminatorCode, createdBy: by })
    .onConflictDoNothing();
}

/** 부착 해제. 값 행은 지우지 않는다 — 해제의 값 처리(경고 후 삭제)는 서비스 몫. */
export async function detach(db: Db, owner: ValueOwner, discriminatorCode: Code): Promise<void> {
  await db
    .delete(entityAttachments)
    .where(
      and(
        eq(entityAttachments.ownerKind, owner.kind),
        eq(entityAttachments.ownerId, owner.id),
        eq(entityAttachments.discriminatorCode, discriminatorCode),
      ),
    );
}

/** 소유자에 선택적으로 부착된 구분자 코드 (부착 순). 무조건 노출분은 포함하지 않는다. */
export async function listAttached(db: Db, owner: ValueOwner): Promise<Code[]> {
  const rows = await db
    .select({ code: entityAttachments.discriminatorCode })
    .from(entityAttachments)
    .where(and(eq(entityAttachments.ownerKind, owner.kind), eq(entityAttachments.ownerId, owner.id)))
    .orderBy(asc(entityAttachments.createdAt), asc(entityAttachments.id));
  return rows.map((r) => r.code);
}

/** 어떤 소유자들이 이 구분자를 부착했나 (사용처 추적·재검사용). */
export async function listOwnersAttaching(db: Db, discriminatorCode: Code): Promise<ValueOwner[]> {
  const rows = await db
    .select({ kind: entityAttachments.ownerKind, id: entityAttachments.ownerId })
    .from(entityAttachments)
    .where(eq(entityAttachments.discriminatorCode, discriminatorCode));
  return rows.map((r) => ({ kind: r.kind as ValueOwnerKind, id: r.id }));
}

/** 소유자의 부착·값 관계 전부 삭제 (실체 삭제 연쇄). */
export async function clearOwner(db: Db, owner: ValueOwner): Promise<void> {
  await clearSlots(db, owner);
  await db
    .delete(entityAttachments)
    .where(and(eq(entityAttachments.ownerKind, owner.kind), eq(entityAttachments.ownerId, owner.id)));
}

// ───────────────────────────── 영향 (ImpactSource) ─────────────────────────────

function targetFilter(target: ImpactTarget) {
  switch (target.kind) {
    case "discriminator":
      return eq(entityValues.discriminatorCode, target.code);
    case "field":
      return and(eq(entityValues.discriminatorCode, target.code), eq(entityValues.fieldCode, target.fieldCode));
    case "enumValue":
    case "enum":
      // enum 값 행은 「그 enum 을 타입으로 쓰는 자리」를 알아야 찾는다 — 카탈로그 정의가 필요하다.
      // 여기서는 정의 없이 못 세므로 0 으로 두고, 서비스가 enumReferences 로 자리를 구해
      // discriminator/field 타깃으로 바꿔 호출한다.
      return undefined;
  }
}

/**
 * 값 저장소의 ImpactSource 구현. findBrokenRefs 는 참조 역인덱스(C1 refs)가 담당하므로
 * 여기서는 빈 목록 — refs 가 생기면 합성(`{...valuesImpactSource(db), findBrokenRefs}`)한다.
 */
export function valuesImpactSource(db: Db): ImpactSource {
  return {
    async countValueRows(target) {
      const where = targetFilter(target);
      if (!where) return 0;
      const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(entityValues).where(where);
      return row?.n ?? 0;
    },
    async findBrokenRefs() {
      return [];
    },
    async purgeValueRows(target) {
      const where = targetFilter(target);
      if (!where) return;
      await db.delete(entityValues).where(where);
    },
  };
}
