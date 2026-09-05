/** FormData → 문자열/불리언 파싱 — 순수 함수, 여러 라우트가 공유. `formData.test.ts` 로 검증. */

export function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

export function bool(fd: FormData, key: string): boolean {
  return fd.get(key) === "on" || fd.get(key) === "true";
}

/** 콤마로 구분된 코드 목록 → trim 된 비어있지 않은 문자열 배열. */
export function csv(fd: FormData, key: string): string[] {
  return str(fd, key)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
