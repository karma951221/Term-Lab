/**
 * 작명 규칙 — default 상품담보명 (ADR-0015 · 담보속성탑재 S3).
 *
 * 2차기획_목록 「작명 규칙 문법」이 미확정이라 **최소형으로 확정**한 문법 (2026-09-04, B4):
 *
 * 1. 규칙은 **유효값**에 붙는다: `{ prefix?, suffix? }` (둘 다 선택 · 둘 다 가능).
 * 2. 적용 순서 = 담보속성 **종류의 카탈로그 전역 order 오름차순** (D-P5-4).
 * 3. 결합: `[prefix₁ prefix₂ …] 담보명 [suffix₁ suffix₂ …]` — prefix 들은 order 오름차순으로
 *    왼쪽부터, suffix 들도 order 오름차순으로 왼쪽부터. 토큰 사이는 **공백 1칸**.
 *    (겹싸기(wrap)가 아니라 나열이다 — 「갱신형 무배당 X 추가 Ⅱ」.)
 * 4. 미사용 속성(선택하지 않은 종류) · 규칙 없는 값 · 카탈로그에 없는 종류/값은 건너뛴다.
 * 5. 담보명·규칙 문자열의 앞뒤 공백은 정리한다. 규칙 문자열 안의 공백은 그대로.
 *
 * 예: 「일반상해사망」 + 갱신형(prefix「갱신형」) + 추가(suffix「추가」) → 「갱신형 일반상해사망 추가」.
 */
import type { AttributeKind, AttributeSelection } from "./types";

export function defaultCoverageName(
  coverageName: string,
  selections: readonly AttributeSelection[],
  kinds: readonly AttributeKind[],
): string {
  const prefixes: string[] = [];
  const suffixes: string[] = [];
  const ordered = [...kinds].sort((a, b) => a.order - b.order || a.code.localeCompare(b.code));
  for (const kind of ordered) {
    const sel = selections.find((s) => s.kindCode === kind.code);
    if (!sel) continue; // 미사용 속성
    const value = kind.values.find((v) => v.code === sel.valueCode);
    if (!value) continue; // 카탈로그에 없는 값 — 조립 오류가 잡는다
    const p = value.naming.prefix?.trim();
    const s = value.naming.suffix?.trim();
    if (p) prefixes.push(p);
    if (s) suffixes.push(s);
  }
  return [...prefixes, coverageName.trim(), ...suffixes].join(" ");
}
