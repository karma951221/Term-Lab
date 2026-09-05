/** `?error=` 쿼리 파라미터를 배너로. 서버 액션이 실패하면 같은 페이지로 redirect 하며 이 문구를 싣는다. */
export function ErrorBanner({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="ts-error-banner" role="alert">
      {message}
    </p>
  );
}
