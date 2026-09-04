/**
 * 인증 서비스 — MVP 최소형 (ADR-0019).
 *
 * - 비밀번호 없음. 로그인 = 사용자 이름 선택 → 토큰(세션) 발급. 토큰은 쿠키에 싣는다 (D2 몫).
 * - `ensureSeedAdmin()` : 사용자가 하나도 없으면 「admin」 관리자를 만든다 (1인 사용 = 관리자).
 * - `currentActor(token)` : 서버 액션·라우트가 actor 를 얻는 유일한 입구.
 * - 사용자 추가는 admin 만 (파괴적 액션은 아니지만 역할을 부여하는 일이라 관리자 전용).
 */
import { randomUUID } from "node:crypto";

import type { Actor, Id, Result, Role } from "@/domain/types";
import { ok, reject } from "@/domain/types";

import * as repo from "@/db/repo/auth";
import type { Db } from "@/db/repo/types";

export interface AuthServiceOptions {
  /** 현재 시각 (테스트 주입). */
  now?: () => Date;
  /** 세션 수명. 기본 30일. */
  sessionTtlMs?: number;
  /** 시드 관리자 이름. 기본 "admin". */
  seedAdminName?: string;
}

export interface Session {
  token: string;
  expiresAt: Date;
  actor: Actor;
}

export interface User {
  id: Id;
  name: string;
  role: Role;
}

export interface AuthService {
  ensureSeedAdmin(): Promise<User>;
  listUsers(): Promise<User[]>;
  login(name: string): Promise<Result<Session>>;
  logout(token: string): Promise<void>;
  /** 유효한 세션이면 actor, 아니면 undefined (만료 세션은 지운다). */
  currentActor(token: string): Promise<Actor | undefined>;
  createUser(actor: Actor, input: { name: string; role: Role }): Promise<Result<User>>;
}

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function createAuthService(db: Db, options: AuthServiceOptions = {}): AuthService {
  const now = options.now ?? (() => new Date());
  const ttl = options.sessionTtlMs ?? DEFAULT_TTL_MS;
  const seedName = options.seedAdminName ?? "admin";

  return {
    async ensureSeedAdmin() {
      const existing = await repo.findUserByName(db, seedName);
      if (existing) return existing;
      if ((await repo.countUsers(db)) > 0) {
        // 이름은 다르지만 사용자가 이미 있다 — 첫 사용자를 관리자로 본다 (시드 재실행 안전).
        const [first] = await repo.listUsers(db);
        return first;
      }
      return repo.insertUser(db, { name: seedName, role: "admin" });
    },

    listUsers: () => repo.listUsers(db),

    async login(name) {
      const user = await repo.findUserByName(db, name);
      if (!user) return reject({ reason: "notFound", what: `사용자 ${name}` });
      const token = randomUUID();
      const expiresAt = new Date(now().getTime() + ttl);
      await repo.insertSession(db, { token, userId: user.id, expiresAt });
      return ok({ token, expiresAt, actor: { userId: user.id, role: user.role } });
    },

    async logout(token) {
      await repo.deleteSession(db, token);
    },

    async currentActor(token) {
      const s = await repo.findSession(db, token);
      if (!s) return undefined;
      if (s.expiresAt.getTime() <= now().getTime()) {
        await repo.deleteSession(db, token);
        return undefined;
      }
      return { userId: s.user.id, role: s.user.role };
    },

    async createUser(actor, input) {
      if (actor.role !== "admin") {
        return reject({ reason: "forbidden", role: actor.role, action: "auth.createUser" });
      }
      if (input.role !== "admin" && input.role !== "editor") {
        return reject({ reason: "invalid", issues: [{ kind: "typeMismatch", message: "역할은 admin | editor", at: {} }] });
      }
      if (await repo.findUserByName(db, input.name)) {
        return reject({ reason: "duplicate", what: `사용자 이름 「${input.name}」` });
      }
      return ok(await repo.insertUser(db, input));
    },
  };
}
