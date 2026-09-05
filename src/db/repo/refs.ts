/**
 * 참조 그래프(C1 refs) 전용 저장소 접근 — drizzle 쿼리만, 규칙 없음.
 *
 * 그래프 재료 중 다른 repo 에 「전체 목록」이 없는 것과, enum 값 삭제의 값 행 정밀 집계·삭제를 여기 둔다
 * (`repo/values.ts` 의 ImpactSource 는 enum 값 타깃을 셀 수 없다 — 자리를 알아야 해서 refs 가 정의로 자리를 구해 넘긴다).
 */
import { and, inArray, sql } from "drizzle-orm";

import type { Code, Id } from "@/domain/types";

import { entityAttachments, entityValues } from "../schema";
import type { Db } from "./types";

/** 선택적 노출 부착 관계 전부 (소유자 종류 · id · 구분자 코드). */
export async function listAllAttachments(db: Db): Promise<{ owner: { kind: string; id: Id }; discriminatorCode: Code }[]> {
  const rows = await db
    .select({ kind: entityAttachments.ownerKind, id: entityAttachments.ownerId, code: entityAttachments.discriminatorCode })
    .from(entityAttachments)
    .orderBy(entityAttachments.createdAt, entityAttachments.id);
  return rows.map((r) => ({ owner: { kind: r.kind, id: r.id }, discriminatorCode: r.code }));
}

/** enum 을 타입으로 쓰는 값 자리 하나 — scalar 자리(fieldCode '') 또는 구조체 필드. list<enum> 이면 배열 원소로 든다. */
export interface EnumSlot {
  discriminatorCode: Code;
  fieldCode: Code | "";
  list: boolean;
}

/** 자리 키 — 코드에는 공백이 없으므로 `코드 필드코드` 로 잇는다 (SQL 과 JS 가 같은 표기). */
const slotKey = sql`${entityValues.discriminatorCode} || ' ' || ${entityValues.fieldCode}`;

function inSlots(slots: readonly EnumSlot[]) {
  return inArray(slotKey, slots.map((s) => `${s.discriminatorCode} ${s.fieldCode}`));
}

/** jsonb `?` : 문자열 값이면 그 문자열과 같은지, 배열이면 원소로 있는지 — scalar · list<enum> 을 한 식으로 본다. */
function hasValue(valueCode: Code) {
  return sql`${entityValues.value} ? ${valueCode}`;
}

/** 그 enum 값을 고른 값 행 수 (주어진 자리들 안에서). */
export async function countEnumValueRows(db: Db, slots: readonly EnumSlot[], valueCode: Code): Promise<number> {
  if (slots.length === 0) return 0;
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(entityValues).where(and(inSlots(slots), hasValue(valueCode)));
  return row?.n ?? 0;
}

/**
 * 그 enum 값을 고른 값 행 연쇄 삭제 — scalar 자리는 행 삭제, list<enum> 자리는 배열에서 원소 제거
 * (빈 배열이 되면 행 삭제 — 「미입력」으로 되돌린다).
 */
export async function purgeEnumValueRows(db: Db, slots: readonly EnumSlot[], valueCode: Code): Promise<void> {
  const scalar = slots.filter((s) => !s.list);
  const list = slots.filter((s) => s.list);
  if (scalar.length > 0) await db.delete(entityValues).where(and(inSlots(scalar), hasValue(valueCode)));
  if (list.length > 0) {
    await db
      .update(entityValues)
      .set({ value: sql`${entityValues.value} - ${valueCode}`, updatedAt: sql`now()` })
      .where(and(inSlots(list), hasValue(valueCode)));
    await db.delete(entityValues).where(and(inSlots(list), sql`${entityValues.value} = '[]'::jsonb`));
  }
}
