/**
 * 문면 구조 편집기 서버 액션의 입력 파싱 — 순수 함수. `*.test.ts` 로 검증.
 * (커맨드 자체의 검증은 도메인 `applyCommand` 몫 — 여기는 FormData/쿼리 → 커맨드 인자 변환만.)
 */
import type { Position } from "@/domain/document";
import { indexTree, type DocumentNode } from "@/domain/document";
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
