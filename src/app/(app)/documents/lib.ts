/**
 * 문면 구조 편집기 서버 액션의 입력 파싱 — 순수 함수. `*.test.ts` 로 검증.
 * (커맨드 자체의 검증은 도메인 `applyCommand` 몫 — 여기는 FormData/쿼리 → 커맨드 인자 변환만.)
 */
import type { Position } from "@/domain/document";
import { indexTree, type DocumentNode, type TableColumn, type TableRow } from "@/domain/document";
import type { Code, Id } from "@/domain/types";

export function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

/** `{"O01":"V01"}` 형태의 JSON — 실패하면 빈 객체. */
export function parseOptions(json: string): Record<Code, Code> {
  const trimmed = json.trim();
  if (trimmed === "") return {};
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<Code, Code>;
    return {};
  } catch {
    return {};
  }
}

/** 노드(또는 가지) 하나 위/아래로 옮긴 새 Position — 형제가 없거나 경계면 undefined(이동 없음). */
export function moveTarget(tree: DocumentNode, nodeId: Id, dir: -1 | 1): Position | undefined {
  const ix = indexTree(tree);
  const e = ix.nodes.get(nodeId);
  if (!e || e.parentId === undefined) return undefined;
  const total = [...ix.nodes.values()].filter((o) => o.parentId === e.parentId && o.slot === e.slot).length;
  const next = e.index + dir;
  if (next < 0 || next >= total) return undefined;
  return { parentId: e.parentId, slot: e.slot, index: next };
}

/** textarea 줄 목록 — 줄마다 하나, 앞뒤 공백 정리, 빈 줄 제거. */
export function parseLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
}

/**
 * 표 폼 → 표 필드 (ADR-0029). `rows` 는 한 줄 = 한 행, 셀은 `|` 구분. `widths` 는 쉼표 구분 %(빈칸 허용),
 * `headerRows` 는 앞에서부터 제목줄 수. 열 수 = 가장 긴 행(또는 너비 수), 짧은 행은 빈 셀로 채운다.
 */
export function parseTableForm(fd: FormData): { title?: string; columns: TableColumn[]; rows: TableRow[] } {
  const title = str(fd, "title");
  const headerRows = Number(str(fd, "headerRows") || "0");
  const rawRows = parseLines(String(fd.get("rows") ?? "")).map((l) => l.split("|").map((c) => c.trim()));
  const widthsRaw = str(fd, "widths");
  const widths = widthsRaw === "" ? [] : widthsRaw.split(",").map((w) => Number(w.trim()));
  const n = Math.max(1, ...rawRows.map((r) => r.length), widths.length);
  const columns: TableColumn[] = Array.from({ length: n }, (_x, i) => (Number.isFinite(widths[i]) && widths[i] > 0 ? { width: widths[i] } : {}));
  const rows: TableRow[] = rawRows.map((cells, i) => ({ ...(i < headerRows ? { header: true } : {}), cells: [...cells, ...Array<string>(n - cells.length).fill("")] }));
  return { ...(title ? { title } : {}), columns, rows };
}
