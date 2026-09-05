/**
 * 문면 저장소 — drizzle 쿼리만. 규칙 없음 (규칙은 src/domain/document, 조립은 src/services/document).
 *
 * 문서 행 ↔ `DocumentRecord`, 별표 행 ↔ `Appendix` 매핑을 여기서 한다.
 */
import { asc, eq } from "drizzle-orm";

import type { Appendix } from "@/domain/document/appendix";
import type { DocumentNode } from "@/domain/document/nodes";
import type { Code, Id } from "@/domain/types";

import { appendices, documents } from "../schema";
import type { Db } from "./types";

export type DocumentKind = "special" | "general";

/** 문서 메타 — 종류 · 소유 · 제목 · updated. */
export interface DocumentSummary {
  id: Id;
  kind: DocumentKind;
  /** special 의 담보 id. */
  ownerId?: Id;
  title: string;
  /** special 이 지정한 대응 보통약관 (D-P4-5). */
  generalDocumentId?: Id;
  createdAt: Date;
  updatedAt: Date;
  updatedBy?: Id;
}

export interface DocumentRecord extends DocumentSummary {
  tree: DocumentNode;
}

export interface NewDocumentRow {
  kind: DocumentKind;
  ownerId?: Id;
  title: string;
  generalDocumentId?: Id;
  tree: DocumentNode;
}

type Row = typeof documents.$inferSelect;

function toSummary(r: Row): DocumentSummary {
  return {
    id: r.id,
    kind: r.kind as DocumentKind,
    ...(r.ownerId ? { ownerId: r.ownerId } : {}),
    title: r.title,
    ...(r.generalDocumentId ? { generalDocumentId: r.generalDocumentId } : {}),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    ...(r.updatedBy ? { updatedBy: r.updatedBy } : {}),
  };
}

function toRecord(r: Row): DocumentRecord {
  return { ...toSummary(r), tree: r.tree };
}

// ───────────────────────────── 문서 ─────────────────────────────

export async function insertDocument(db: Db, input: NewDocumentRow, who: Id): Promise<DocumentRecord> {
  const [row] = await db
    .insert(documents)
    .values({
      kind: input.kind,
      ownerId: input.ownerId ?? null,
      title: input.title,
      generalDocumentId: input.generalDocumentId ?? null,
      tree: input.tree,
      createdBy: who,
      updatedBy: who,
    })
    .returning();
  return toRecord(row);
}

export async function loadDocument(db: Db, id: Id): Promise<DocumentRecord | undefined> {
  const [row] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  return row ? toRecord(row) : undefined;
}

/** 담보의 문면 (담보 1 : 문서 1). */
export async function findByOwner(db: Db, ownerId: Id): Promise<DocumentRecord | undefined> {
  const [row] = await db.select().from(documents).where(eq(documents.ownerId, ownerId)).limit(1);
  return row ? toRecord(row) : undefined;
}

/** 메타 목록 — 종류 · 제목순. */
export async function listDocuments(db: Db, kind?: DocumentKind): Promise<DocumentSummary[]> {
  const q = db
    .select({
      id: documents.id,
      kind: documents.kind,
      ownerId: documents.ownerId,
      title: documents.title,
      generalDocumentId: documents.generalDocumentId,
      createdAt: documents.createdAt,
      updatedAt: documents.updatedAt,
      updatedBy: documents.updatedBy,
    })
    .from(documents)
    .orderBy(asc(documents.kind), asc(documents.title));
  const rows = kind ? await q.where(eq(documents.kind, kind)) : await q;
  return rows.map((r) => toSummary({ ...r, tree: null as unknown as DocumentNode, createdBy: null }));
}

/** 트리 포함 전체 (사용처 스캔용). */
export async function listDocumentRecords(db: Db): Promise<DocumentRecord[]> {
  const rows = await db.select().from(documents).orderBy(asc(documents.kind), asc(documents.title));
  return rows.map(toRecord);
}

export interface DocumentPatch {
  title?: string;
  tree?: DocumentNode;
  /** null = 해제. */
  generalDocumentId?: Id | null;
}

export async function saveDocument(db: Db, id: Id, patch: DocumentPatch, who: Id): Promise<void> {
  const [row] = await db
    .update(documents)
    .set({
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.tree !== undefined ? { tree: patch.tree } : {}),
      ...(patch.generalDocumentId !== undefined ? { generalDocumentId: patch.generalDocumentId } : {}),
      updatedAt: new Date(),
      updatedBy: who,
    })
    .where(eq(documents.id, id))
    .returning({ id: documents.id });
  if (!row) throw new Error(`저장 대상 문서가 없습니다: ${id}`);
}

export async function deleteDocument(db: Db, id: Id): Promise<void> {
  await db.delete(documents).where(eq(documents.id, id));
}

// ───────────────────────────── 별표 ─────────────────────────────

type AppendixRow = typeof appendices.$inferSelect;

function toAppendix(r: AppendixRow): Appendix {
  return { code: r.code, name: r.name, description: r.description };
}

export async function insertAppendix(db: Db, a: Appendix, who: Id): Promise<void> {
  await db.insert(appendices).values({ code: a.code, name: a.name, description: a.description, createdBy: who, updatedBy: who });
}

export async function loadAppendix(db: Db, code: Code): Promise<Appendix | undefined> {
  const [row] = await db.select().from(appendices).where(eq(appendices.code, code)).limit(1);
  return row ? toAppendix(row) : undefined;
}

/** 코드순. */
export async function listAppendices(db: Db): Promise<Appendix[]> {
  const rows = await db.select().from(appendices).orderBy(asc(appendices.code));
  return rows.map(toAppendix);
}

export async function saveAppendix(db: Db, a: Appendix, who: Id): Promise<void> {
  const [row] = await db
    .update(appendices)
    .set({ name: a.name, description: a.description, updatedAt: new Date(), updatedBy: who })
    .where(eq(appendices.code, a.code))
    .returning({ id: appendices.id });
  if (!row) throw new Error(`저장 대상 별표가 없습니다: ${a.code}`);
}

export async function deleteAppendix(db: Db, code: Code): Promise<void> {
  await db.delete(appendices).where(eq(appendices.code, code));
}
