/**
 * 공통 레이아웃 — 좌측 내비(구분자·담보·공용조항·문면·별표·상품·담보속성·관계정보) + 현재 사용자·역할·로그아웃.
 * 로그인 세션이 없으면 `currentActor()` 가 `/login` 으로 redirect 한다.
 */
import Link from "next/link";

import { logoutAction } from "@/app/login/actions";
import { currentActor, getServices } from "@/lib/services";

const NAV = [
  { href: "/catalog", label: "구분자" },
  { href: "/coverages", label: "담보" },
  { href: "/clauses", label: "공용조항" },
  { href: "/documents", label: "문면" },
  { href: "/appendices", label: "별표" },
  { href: "/products", label: "상품" },
  { href: "/attributes", label: "담보속성" },
  { href: "/relations", label: "관계정보" },
] as const;

const ROLE_LABEL: Record<string, string> = { admin: "관리자", editor: "편집자" };

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await currentActor();
  const users = await getServices().auth.listUsers();
  const me = users.find((u) => u.id === actor.userId);

  return (
    <div className="ts-app">
      <nav className="ts-nav">
        <p className="ts-nav-title">terms-studio</p>
        {NAV.map((item) => (
          <Link key={item.href} href={item.href}>
            {item.label}
          </Link>
        ))}
        <div className="ts-nav-user">
          <div>
            {me?.name ?? actor.userId} · {ROLE_LABEL[actor.role] ?? actor.role}
          </div>
          <form action={logoutAction}>
            <button type="submit">로그아웃</button>
          </form>
        </div>
      </nav>
      <main className="ts-main">{children}</main>
    </div>
  );
}
