import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "@/db/test-utils";
import { createAuthService, type AuthService } from "./auth";

describe("auth 서비스 (PGlite) — MVP 최소형 인증", () => {
  let t: TestDb;
  let svc: AuthService;
  let now = new Date("2026-09-04T00:00:00Z");

  beforeAll(async () => {
    t = await createTestDb();
    svc = createAuthService(t.db, { now: () => now, sessionTtlMs: 60_000 });
  });
  afterAll(async () => {
    await t.close();
  });

  it("시드 admin 보장 — 사용자가 없으면 「admin」 관리자를 만들고, 있으면 그대로 둔다", async () => {
    const first = await svc.ensureSeedAdmin();
    expect(first).toMatchObject({ name: "admin", role: "admin" });
    const again = await svc.ensureSeedAdmin();
    expect(again.id).toBe(first.id);
    expect(await svc.listUsers()).toHaveLength(1);
  });

  it("사용자 이름으로 로그인하면 토큰 세션이 생기고, 토큰으로 현재 actor 를 조회한다", async () => {
    const session = await svc.login("admin");
    if (!session.ok) throw new Error("로그인 실패");
    expect(session.value.token).toMatch(/^[0-9a-f-]{36}$/);
    const actor = await svc.currentActor(session.value.token);
    expect(actor).toEqual({ userId: session.value.actor.userId, role: "admin" });
  });

  it("없는 이름으로 로그인 → notFound · 모르는 토큰 → undefined", async () => {
    expect(await svc.login("nobody")).toEqual({ ok: false, rejection: { reason: "notFound", what: "사용자 nobody" } });
    expect(await svc.currentActor("no-such-token")).toBeUndefined();
  });

  it("만료된 세션은 actor 를 돌려주지 않는다", async () => {
    const session = await svc.login("admin");
    if (!session.ok) throw new Error("로그인 실패");
    now = new Date(now.getTime() + 61_000);
    expect(await svc.currentActor(session.value.token)).toBeUndefined();
  });

  it("로그아웃하면 토큰이 무효가 된다", async () => {
    const session = await svc.login("admin");
    if (!session.ok) throw new Error("로그인 실패");
    await svc.logout(session.value.token);
    expect(await svc.currentActor(session.value.token)).toBeUndefined();
  });

  it("역할권한 S4 — 사용자 추가는 관리자만 · 이름 중복 거부 · 편집자로 로그인하면 editor actor", async () => {
    const adminActor = { userId: (await svc.listUsers())[0].id, role: "admin" as const };
    const created = await svc.createUser(adminActor, { name: "editor1", role: "editor" });
    expect(created.ok).toBe(true);
    expect((await svc.createUser(adminActor, { name: "editor1", role: "editor" })).ok).toBe(false);

    const login = await svc.login("editor1");
    if (!login.ok) throw new Error("로그인 실패");
    expect(login.value.actor.role).toBe("editor");
    const denied = await svc.createUser(login.value.actor, { name: "editor2", role: "editor" });
    expect(denied).toEqual({ ok: false, rejection: { reason: "forbidden", role: "editor", action: "auth.createUser" } });
  });
});
