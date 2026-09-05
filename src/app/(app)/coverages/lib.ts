/** 담보 화면 서버 액션의 입력 파싱 — 순수 함수. `*.test.ts` 로 검증. */
import type { CoverageNodeLevel } from "@/domain/coverage";

export function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

/** `<level>:<id>` 인코딩 — 선택된 트리 노드를 쿼리스트링에 싣는다. */
export function encodeNodeKey(level: CoverageNodeLevel, id: string): string {
  return `${level}:${id}`;
}

export function decodeNodeKey(key: string | undefined): { level: CoverageNodeLevel; id: string } | undefined {
  if (!key) return undefined;
  const [level, id] = key.split(":");
  if (level !== "coverage" && level !== "subCoverage" && level !== "benefit") return undefined;
  if (!id) return undefined;
  return { level, id };
}

/** 형제 목록에서 id 를 한 칸 옮긴 새 순서 (범위를 벗어나면 그대로). */
export function moved<T extends { id: string }>(items: readonly T[], id: string, dir: -1 | 1): string[] {
  const ids = items.map((i) => i.id);
  const i = ids.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return ids;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  return ids;
}
