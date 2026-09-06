import { NavLink } from "@/app/_components/NavLink";

export default function TypesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <div className="ts-types-head">
        <h1 className="ts-h1">유형</h1>
        <nav className="ts-subtabs" aria-label="유형 하위 탭">
          <NavLink href="/types/enums" label="선택지" />
          <NavLink href="/types/forms" label="폼" />
        </nav>
      </div>
      {children}
    </div>
  );
}
