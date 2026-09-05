/**
 * 담보 저장소 — drizzle 쿼리만. 규칙 없음 (규칙은 src/domain/coverage, 조립은 src/services/coverage).
 *
 * 도메인 객체(Coverage 트리) ↔ 행 3테이블 매핑. 저장은 id 기준 upsert — 트리에 남은 노드는 갱신,
 * 없어진 노드는 삭제 (급부는 세부보장 FK cascade). 값 행·부착 관계는 repo/values 가 소유한다.
 */
import { and, asc, eq, inArray, notInArray } from "drizzle-orm";

import type { Coverage, CoverageNodeRef, SubCoverage } from "@/domain/coverage/types";
import type { Id } from "@/domain/types";

import { benefits, coverages, subCoverages } from "../schema";
import type { Db } from "./types";

type CoverageRow = typeof coverages.$inferSelect;
type SubRow = typeof subCoverages.$inferSelect;
type BenefitRow = typeof benefits.$inferSelect;

function toCoverage(row: CoverageRow, subs: SubRow[], bens: BenefitRow[]): Coverage {
  const bySub = new Map<Id, BenefitRow[]>();
  for (const b of bens) {
    const list = bySub.get(b.subCoverageId) ?? [];
    list.push(b);
    bySub.set(b.subCoverageId, list);
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    ...(row.documentId ? { documentId: row.documentId } : {}),
    subCoverages: subs.map<SubCoverage>((s) => ({
      id: s.id,
      name: s.name,
      order: s.order,
      benefits: (bySub.get(s.id) ?? []).map((b) => ({ id: b.id, name: b.name, order: b.order })),
    })),
  };
}

async function childrenOf(db: Db, coverageIds: Id[]): Promise<{ subs: SubRow[]; bens: BenefitRow[] }> {
  if (coverageIds.length === 0) return { subs: [], bens: [] };
  const subs = await db
    .select()
    .from(subCoverages)
    .where(inArray(subCoverages.coverageId, coverageIds))
    .orderBy(asc(subCoverages.order), asc(subCoverages.name));
  const subIds = subs.map((s) => s.id);
  const bens =
    subIds.length === 0
      ? []
      : await db
          .select()
          .from(benefits)
          .where(inArray(benefits.subCoverageId, subIds))
          .orderBy(asc(benefits.order), asc(benefits.name));
  return { subs, bens };
}

// ───────────────────────────── 조회 ─────────────────────────────

export async function loadCoverage(db: Db, id: Id): Promise<Coverage | undefined> {
  const [row] = await db.select().from(coverages).where(eq(coverages.id, id)).limit(1);
  if (!row) return undefined;
  const { subs, bens } = await childrenOf(db, [row.id]);
  return toCoverage(row, subs, bens);
}

/** 이름순 전체 목록 (D-P2-5 — 마스터 목록에 순서 데이터 없음). */
export async function listCoverages(db: Db): Promise<Coverage[]> {
  const rows = await db.select().from(coverages).orderBy(asc(coverages.name));
  const { subs, bens } = await childrenOf(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((r) =>
    toCoverage(
      r,
      subs.filter((s) => s.coverageId === r.id),
      bens,
    ),
  );
}

/** 담보명 전부 — 전역 중복 검사용. */
export async function listCoverageNames(db: Db): Promise<string[]> {
  const rows = await db.select({ name: coverages.name }).from(coverages).orderBy(asc(coverages.name));
  return rows.map((r) => r.name);
}

/** 노드가 속한 담보 id. 없으면 undefined. */
export async function coverageIdOfNode(db: Db, node: CoverageNodeRef): Promise<Id | undefined> {
  switch (node.level) {
    case "coverage": {
      const [row] = await db.select({ id: coverages.id }).from(coverages).where(eq(coverages.id, node.id)).limit(1);
      return row?.id;
    }
    case "subCoverage": {
      const [row] = await db
        .select({ id: subCoverages.coverageId })
        .from(subCoverages)
        .where(eq(subCoverages.id, node.id))
        .limit(1);
      return row?.id;
    }
    case "benefit": {
      const [row] = await db
        .select({ id: subCoverages.coverageId })
        .from(benefits)
        .innerJoin(subCoverages, eq(benefits.subCoverageId, subCoverages.id))
        .where(eq(benefits.id, node.id))
        .limit(1);
      return row?.id;
    }
  }
}

export async function coverageAudit(db: Db, id: Id) {
  const [row] = await db.select().from(coverages).where(eq(coverages.id, id)).limit(1);
  if (!row) return undefined;
  return { createdAt: row.createdAt, updatedAt: row.updatedAt, createdBy: row.createdBy, updatedBy: row.updatedBy };
}

// ───────────────────────────── 쓰기 ─────────────────────────────

/** 새 담보 트리 저장 (담보 + 세부보장 + 급부). id 는 도메인이 발급한 것을 그대로 쓴다. */
export async function insertCoverage(db: Db, tree: Coverage, who: Id): Promise<void> {
  await db.insert(coverages).values({
    id: tree.id,
    name: tree.name,
    description: tree.description,
    documentId: tree.documentId ?? null,
    createdBy: who,
    updatedBy: who,
  });
  await upsertChildren(db, tree, who, new Date());
}

/** 기존 트리 덮어쓰기 — 노드 upsert + 트리에서 빠진 세부보장·급부 삭제. */
export async function saveCoverage(db: Db, tree: Coverage, who: Id): Promise<void> {
  const now = new Date();
  const [row] = await db
    .update(coverages)
    .set({ name: tree.name, description: tree.description, documentId: tree.documentId ?? null, updatedAt: now, updatedBy: who })
    .where(eq(coverages.id, tree.id))
    .returning({ id: coverages.id });
  if (!row) throw new Error(`저장 대상 담보가 없습니다: ${tree.id}`);

  const keepSubs = tree.subCoverages.map((s) => s.id);
  await db
    .delete(subCoverages)
    .where(
      keepSubs.length === 0
        ? eq(subCoverages.coverageId, tree.id)
        : and(eq(subCoverages.coverageId, tree.id), notInArray(subCoverages.id, keepSubs)),
    );
  for (const s of tree.subCoverages) {
    const keepBens = s.benefits.map((b) => b.id);
    await db
      .delete(benefits)
      .where(
        keepBens.length === 0
          ? eq(benefits.subCoverageId, s.id)
          : and(eq(benefits.subCoverageId, s.id), notInArray(benefits.id, keepBens)),
      );
  }
  await upsertChildren(db, tree, who, now);
}

async function upsertChildren(db: Db, tree: Coverage, who: Id, now: Date): Promise<void> {
  for (const s of tree.subCoverages) {
    await db
      .insert(subCoverages)
      .values({ id: s.id, coverageId: tree.id, name: s.name, order: s.order, createdBy: who, updatedBy: who })
      .onConflictDoUpdate({
        target: subCoverages.id,
        set: { name: s.name, order: s.order, updatedAt: now, updatedBy: who },
      });
    for (const b of s.benefits) {
      await db
        .insert(benefits)
        .values({ id: b.id, subCoverageId: s.id, name: b.name, order: b.order, createdBy: who, updatedBy: who })
        .onConflictDoUpdate({
          target: benefits.id,
          set: { name: b.name, order: b.order, updatedAt: now, updatedBy: who },
        });
    }
  }
}

/** 담보 삭제 — 하위는 FK cascade. 값 행 연쇄 삭제는 서비스 몫. */
export async function deleteCoverage(db: Db, id: Id): Promise<void> {
  await db.delete(coverages).where(eq(coverages.id, id));
}
