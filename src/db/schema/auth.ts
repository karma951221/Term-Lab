/**
 * 인증 스키마 — 사용자 · 세션 (ADR-0019 MVP 최소형).
 *
 * - users: 역할(admin | editor)이 사용자에 붙는다. 비밀번호 없음 — 사용자 이름 선택 로그인.
 * - sessions: 토큰 = 쿠키 값. 만료 시각 지나면 무효.
 *
 * 표준 Postgres 만 쓴다 (PGlite 전용 기능 금지).
 */
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** 로그인 화면에서 고르는 이름. 유일. */
  name: text("name").notNull().unique(),
  /** "admin" | "editor" — 도메인 Role. 검사는 도메인 계층(auth)에서. */
  role: text("role").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  token: text("token").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
