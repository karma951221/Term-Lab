/**
 * 서버 액션 · 서버 컴포넌트가 서비스 계층에 닿는 유일한 통로.
 *
 * - `getServices()` : `getDb()` 위에 `createServices()` 를 globalThis 캐시로 한 번만 만든다.
 * - `currentActor()` : 쿠키의 세션 토큰으로 `auth.currentActor(token)`. 없으면 `/login` 으로 redirect.
 * - `currentActorOrNull()` : redirect 없이 조회 (로그인 화면 자체 · 레이아웃의 조건 분기용).
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getDb } from "@/db/client";
import { createServices, type Services } from "@/services/container";

export const SESSION_COOKIE = "ts_session";

const globalCache = globalThis as typeof globalThis & {
  __termsStudioServices?: Services;
};

/** 프로세스당 서비스 묶음 하나. */
export function getServices(): Services {
  if (!globalCache.__termsStudioServices) {
    globalCache.__termsStudioServices = createServices(getDb());
  }
  return globalCache.__termsStudioServices;
}

/** 로그인 세션이 없거나 만료됐으면 `/login` 으로 redirect. 서버 컴포넌트·서버 액션 양쪽에서 쓴다. */
export async function currentActor() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) redirect("/login");
  const actor = await getServices().auth.currentActor(token);
  if (!actor) redirect("/login");
  return actor;
}

/** redirect 없이 조회 — `/login` 자체나 레이아웃의 「이미 로그인」 분기에. */
export async function currentActorOrNull() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return undefined;
  return getServices().auth.currentActor(token);
}
