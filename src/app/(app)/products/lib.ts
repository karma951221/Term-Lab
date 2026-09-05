/** 상품 서버 액션의 입력 파싱 — 순수 함수. `*.test.ts` 로 검증. */
import type { AttributeKind, AttributeSelection, ClauseOptionSelection } from "@/domain/product";

export function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

/** `attr:<kindCode>` 이름의 select 들 → 선택된 것만 AttributeSelection[]. */
export function parseSelections(fd: FormData, kinds: readonly AttributeKind[]): AttributeSelection[] {
  const out: AttributeSelection[] = [];
  for (const k of kinds) {
    const v = str(fd, `attr:${k.code}`);
    if (v) out.push({ kindCode: k.code, valueCode: v });
  }
  return out;
}

/** `{"O01":"V01"}` 형태의 JSON — 실패하면 빈 객체. */
export function parseOptionSelection(json: string): ClauseOptionSelection {
  const trimmed = json.trim();
  if (trimmed === "") return {};
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as ClauseOptionSelection) : {};
  } catch {
    return {};
  }
}
