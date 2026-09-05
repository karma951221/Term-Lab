"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getServices, SESSION_COOKIE } from "@/lib/services";

export async function loginAction(formData: FormData): Promise<void> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) redirect("/login?error=" + encodeURIComponent("사용자를 선택하세요."));
  const r = await getServices().auth.login(name);
  if (!r.ok) redirect("/login?error=" + encodeURIComponent(`로그인할 수 없습니다: ${r.rejection.reason}`));
  const store = await cookies();
  store.set(SESSION_COOKIE, r.value.token, { expires: r.value.expiresAt, httpOnly: true, sameSite: "lax", path: "/" });
  redirect("/catalog");
}

export async function logoutAction(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await getServices().auth.logout(token);
  store.delete(SESSION_COOKIE);
  redirect("/login");
}
