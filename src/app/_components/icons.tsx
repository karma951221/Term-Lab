/**
 * 공용 아이콘 세트 — 디자인원칙 §1.6 「글리프를 문자로 쓰지 않는다. 그린다」.
 *
 * 모든 아이콘은 인라인 SVG 14×14(viewBox 16) · `stroke="currentColor"` 이므로
 * 색은 자리에서 상속된다(`.ts-iconbtn`, `.danger:hover` 등). 문자 글리프(✕ ⧉ ↑ ↓ ⌧)를
 * 쓰면 맑은 고딕에 없는 기호가 심볼 폰트로 폴백돼 굵기·베이스라인이 어긋난다.
 *
 * 담보 상태 글리프(§2 L1 「담보 상태」)는 7px 사각형/자물쇠 — 미사용 ⊡ · 적용 ■ · 확정 ⌧.
 * 색이 아니라 형태가 상태를 말한다(§1.3).
 */
import type { ButtonHTMLAttributes, ReactNode, SVGProps } from "react";

type IconProps = { className?: string } & Omit<SVGProps<SVGSVGElement>, "ref">;

function Svg({ children, className, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className ? `ts-icon ${className}` : "ts-icon"}
      {...rest}
    >
      {children}
    </svg>
  );
}

export function IconTrash(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.5 4h11" />
      <path d="M6 4V2.5h4V4" />
      <path d="M4 4l.7 9.1a.9.9 0 0 0 .9.9h4.8a.9.9 0 0 0 .9-.9L12 4" />
      <path d="M6.6 6.8v5M9.4 6.8v5" />
    </Svg>
  );
}

export function IconCopy(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1" />
      <path d="M10.5 3.2a.7.7 0 0 0-.7-.7H3.2a.7.7 0 0 0-.7.7v6.6a.7.7 0 0 0 .7.7" />
    </Svg>
  );
}

export function IconUp(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 13V3.5" />
      <path d="M3.8 7.7 8 3.5l4.2 4.2" />
    </Svg>
  );
}

export function IconDown(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 3v9.5" />
      <path d="M3.8 8.3 8 12.5l4.2-4.2" />
    </Svg>
  );
}

export function IconClose(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.8 3.8 12.2 12.2" />
      <path d="M12.2 3.8 3.8 12.2" />
    </Svg>
  );
}

export function IconLock(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.2" y="7" width="9.6" height="6.5" rx="1" />
      <path d="M5.6 7V5.2a2.4 2.4 0 0 1 4.8 0V7" />
    </Svg>
  );
}

export function IconRevert(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 8a5 5 0 1 0 1.6-3.7" />
      <path d="M2.6 2.8v3.1h3.1" />
    </Svg>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 3.2v9.6" />
      <path d="M3.2 8h9.6" />
    </Svg>
  );
}

export function IconEdit(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M11.1 2.9a1.3 1.3 0 0 1 1.9 1.9L5.6 12.2 3 13l.8-2.6z" />
      <path d="M10.2 3.8 12.2 5.8" />
    </Svg>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 8.5 6.4 12 13 4.5" />
    </Svg>
  );
}

/** 파생값(식) 표식 — ƒ. §1.2 출처 문법. */
export function IconFx(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9.6 3.2a1.6 1.6 0 0 0-2.5 1.3v7a1.6 1.6 0 0 1-2.5 1.3" />
      <path d="M4.4 6.6h5" />
      <path d="M10.4 9.2l3 3.4M13.4 9.2l-3 3.4" />
    </Svg>
  );
}

export function IconLink(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6.6 9.4a2.6 2.6 0 0 0 3.7 0l2-2a2.6 2.6 0 1 0-3.7-3.7l-.9.9" />
      <path d="M9.4 6.6a2.6 2.6 0 0 0-3.7 0l-2 2a2.6 2.6 0 1 0 3.7 3.7l.9-.9" />
    </Svg>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="7.2" cy="7.2" r="4" />
      <path d="M10.2 10.2 13.5 13.5" />
    </Svg>
  );
}

/* ── 담보 상태 글리프 (7px) — 디자인원칙 §2 L1 ─────────────────────────── */

type GlyphProps = { className?: string; title?: string };

function glyphClass(extra: string, className?: string) {
  return className ? `ts-glyph ${extra} ${className}` : `ts-glyph ${extra}`;
}

/** 미사용 — 파선 빈 사각. */
export function GlyphUnused({ className, title }: GlyphProps) {
  return (
    <svg
      width={7}
      height={7}
      viewBox="0 0 8 8"
      fill="none"
      stroke="currentColor"
      strokeWidth={1}
      aria-hidden="true"
      focusable="false"
      className={glyphClass("ts-glyph-unused", className)}
    >
      {title ? <title>{title}</title> : null}
      <rect x="0.5" y="0.5" width="7" height="7" strokeDasharray="2 1.4" />
    </svg>
  );
}

/** 적용 — 채운 사각. */
export function GlyphApplied({ className, title }: GlyphProps) {
  return (
    <svg
      width={7}
      height={7}
      viewBox="0 0 8 8"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={glyphClass("ts-glyph-applied", className)}
    >
      {title ? <title>{title}</title> : null}
      <rect x="0.5" y="0.5" width="7" height="7" />
    </svg>
  );
}

/** 확정 — 자물쇠. const 필드와 같은 글리프(§1.2). */
export function GlyphLocked({ className, title }: GlyphProps) {
  return (
    <svg
      width={7}
      height={9}
      viewBox="0 0 8 10"
      fill="none"
      stroke="currentColor"
      strokeWidth={1}
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={glyphClass("ts-glyph-locked", className)}
    >
      {title ? <title>{title}</title> : null}
      <rect x="0.6" y="4.2" width="6.8" height="5.2" />
      <path d="M2.2 4.2V2.8a1.8 1.8 0 0 1 3.6 0v1.4" />
    </svg>
  );
}

/* ── 아이콘 버튼 ───────────────────────────────────────────────────────── */

export type IconButtonProps = {
  /** 무엇을 · 무엇에 하는지 다 적는다 (§1.6 — tooltip 없는 아이콘 버튼은 없다). */
  label: string;
  icon: ReactNode;
  /** 파괴적 조작. 평소엔 뉴트럴이고 hover/focus 에서만 error 로 물든다. */
  danger?: boolean;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "title" | "children">;

export function IconButton({ label, icon, danger, className, type, ...rest }: IconButtonProps) {
  const cls = ["ts-iconbtn", danger ? "danger" : null, className].filter(Boolean).join(" ");
  return (
    <button type={type ?? "button"} className={cls} title={label} aria-label={label} {...rest}>
      {icon}
    </button>
  );
}
