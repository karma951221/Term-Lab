/**
 * 로그인 — 사용자를 고르면 세션이 열린다(비밀번호 없음, MVP).
 * 좌상단 정렬 · 인라인 스타일 없음 (디자인원칙 §8 「가운데 정렬 도배」 금지).
 */
import { redirect } from "next/navigation";

import { currentActorOrNull, getServices } from "@/lib/services";
import { loginAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const already = await currentActorOrNull();
  if (already) redirect("/catalog");

  const services = getServices();
  let users = await services.auth.listUsers();
  if (users.length === 0) {
    await services.auth.ensureSeedAdmin();
    users = await services.auth.listUsers();
  }

  return (
    <main className="ts-login">
      <h1 className="ts-h1">terms-studio 로그인</h1>
      {error && <p className="ts-error-banner">{error}</p>}
      <p className="ts-muted">사용자를 선택하세요 (비밀번호 없음 — MVP).</p>
      <ul className="ts-login-list">
        {users.map((u) => (
          <li key={u.id}>
            <form action={loginAction}>
              <input type="hidden" name="name" value={u.name} />
              <button type="submit">
                {u.name} <span className="ts-badge">{u.role === "admin" ? "관리자" : "편집자"}</span>
              </button>
            </form>
          </li>
        ))}
      </ul>
    </main>
  );
}
