"use client";

/**
 * 좌측 내비 링크 — 현재 위치에 `aria-current="page"` 를 붙인다 (디자인원칙 §1.3, 발견 #61).
 * 색은 CSS(`.ts-nav a[aria-current="page"]`)가 준다. 여기서는 「어디 있는지」만 판단한다.
 *
 * 판단 규칙: 정확히 같거나, 세그먼트 경계로 시작하면 현재 위치다
 * (`/catalog/D0001` → 「구분자」, `/products/x/preview` → 「상품」).
 */
import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname() ?? "";
  const current = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link href={href} aria-current={current ? "page" : undefined}>
      {label}
    </Link>
  );
}
