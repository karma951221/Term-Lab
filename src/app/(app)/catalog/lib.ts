/**
 * 카탈로그 서버 액션의 입력 파싱 — 순수 함수 (FormData → 서비스 인자). `*.test.ts` 로 검증.
 * "use server" 파일(actions.ts)은 async 함수만 export 할 수 있어 여기 따로 둔다.
 */
import type { FieldType, Value } from "@/domain/types";

export function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

export function bool(fd: FormData, key: string): boolean {
  return fd.get(key) === "on" || fd.get(key) === "true";
}

/** 폼 입력(문자열) → FieldType. enum · list<enum> 은 enumCode 가 있어야 유효. */
export function fieldTypeFrom(kind: string, enumCode: string): FieldType | undefined {
  switch (kind) {
    case "string":
      return { kind: "string" };
    case "number":
      return { kind: "number" };
    case "boolean":
      return { kind: "boolean" };
    case "date":
      return { kind: "date" };
    case "enum":
      return enumCode ? { kind: "enum", enumCode } : undefined;
    case "list<enum>":
      return enumCode ? { kind: "list<enum>", enumCode } : undefined;
    default:
      return undefined;
  }
}

/** 문자열 입력 → 값 (타입에 맞춰). 빈 문자열은 undefined(=기본값 없음/지우기). */
export function valueFromInput(type: FieldType, raw: string): Value | undefined {
  if (raw === "") return undefined;
  switch (type.kind) {
    case "string":
    case "date":
    case "enum":
      return raw;
    case "number":
      return Number(raw);
    case "boolean":
      return raw === "true";
    case "list<enum>":
      return raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
  }
}
