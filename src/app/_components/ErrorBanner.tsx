/**
 * `?error=` 쿼리 파라미터를 배너로. 서버 액션이 실패하면 같은 페이지로 redirect 하며 이 문구를 싣는다.
 * 오류는 색만으로 말하지 않는다(디자인원칙 §9.6 Q1) — 아이콘(그린 SVG) + 문구를 함께 보여준다.
 */
export function ErrorBanner({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="ts-error-banner" role="alert">
      <svg className="ts-icon" viewBox="0 0 14 14" aria-hidden="true">
        <path d="M7 1.5 L13 12.5 L1 12.5 Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <line x1="7" y1="5.5" x2="7" y2="9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="7" cy="10.8" r="0.9" fill="currentColor" />
      </svg>{" "}
      {message}
    </p>
  );
}
