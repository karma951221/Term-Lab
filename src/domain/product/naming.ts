/** 전역 명명 템플릿 (ADR-0025). `[담보명]`과 속성 종류 코드 칩을 실제 문구로 치환한다. */
import type { AttributeKind, AttributeSelection } from "./types";

export const DEFAULT_NAMING_TEMPLATE = "[담보명]";

export function defaultCoverageName(
  coverageName: string,
  selections: readonly AttributeSelection[],
  kinds: readonly AttributeKind[],
  template: string,
): string {
  const fragments = new Map<string, string>();
  for (const kind of kinds) {
    const sel = selections.find((s) => s.kindCode === kind.code);
    if (!sel) continue;
    const value = kind.values.find((v) => v.code === sel.valueCode);
    if (value) fragments.set(kind.code, value.fragment.trim());
  }
  return template
    .replace(/\[([^\]]+)]/g, (_chip, code: string) => (code === "담보명" ? coverageName.trim() : (fragments.get(code) ?? "")))
    .replace(/\s+/g, " ")
    .trim();
}

/** 현재 전역 템플릿에서 빠진 속성 종류. */
export function missingTemplateKinds(kinds: readonly AttributeKind[], template: string): AttributeKind[] {
  return kinds.filter((kind) => !template.includes(`[${kind.code}]`));
}

/** 편집기 안내용: 저장 칩 코드를 표시명으로 바꾼다. */
export function displayNamingTemplate(template: string, kinds: readonly AttributeKind[]): string {
  const labels = new Map(kinds.map((kind) => [kind.code, kind.label]));
  return template.replace(/\[([^\]]+)]/g, (chip, code: string) => (code === "담보명" ? chip : `[${labels.get(code) ?? code}]`));
}
