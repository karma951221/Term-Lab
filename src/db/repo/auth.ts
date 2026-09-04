/**
 * 인증 저장소 — users · sessions 에 대한 drizzle 쿼리만.
 */
import { count, eq, lt } from "drizzle-orm";

import type { Id, Role } from "@/domain/types";

import { sessions, users } from "../schema";
import type { Db } from "./types";

export interface UserRow {
  id: Id;
  name: string;
  role: Role;
}

function toUser(row: typeof users.$inferSelect): UserRow {
  return { id: row.id, name: row.name, role: row.role as Role };
}

export async function countUsers(db: Db): Promise<number> {
  const [row] = await db.select({ n: count() }).from(users);
  return row.n;
}

export async function listUsers(db: Db): Promise<UserRow[]> {
  const rows = await db.select().from(users).orderBy(users.createdAt, users.name);
  return rows.map(toUser);
}

export async function findUserByName(db: Db, name: string): Promise<UserRow | undefined> {
  const [row] = await db.select().from(users).where(eq(users.name, name)).limit(1);
  return row ? toUser(row) : undefined;
}

export async function findUserById(db: Db, id: Id): Promise<UserRow | undefined> {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row ? toUser(row) : undefined;
}

export async function insertUser(db: Db, input: { name: string; role: Role }): Promise<UserRow> {
  const [row] = await db.insert(users).values(input).returning();
  return toUser(row);
}

export async function insertSession(
  db: Db,
  input: { token: string; userId: Id; expiresAt: Date },
): Promise<void> {
  await db.insert(sessions).values(input);
}

/** 토큰의 세션과 사용자. 만료 검사는 서비스가 한다. */
export async function findSession(
  db: Db,
  token: string,
): Promise<{ user: UserRow; expiresAt: Date } | undefined> {
  const [row] = await db
    .select({ user: users, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.token, token))
    .limit(1);
  return row ? { user: toUser(row.user), expiresAt: row.expiresAt } : undefined;
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.token, token));
}

export async function deleteExpiredSessions(db: Db, now: Date): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, now));
}
