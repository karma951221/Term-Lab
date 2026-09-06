import type { Coordinate } from "@/domain/types";

/**
 * 좌표 → 「고치러 가기」 링크. `IssueList`(원천 좌표)와 `Confirm`(깨질 참조 좌표)이 공유한다 —
 * 오류 패널이든 파괴적 확인이든, 사람이 문제를 고치러 갈 곳은 좌표의 소유 실체 화면이다.
 * 아는 만큼만 채워지는 `Coordinate`(§오류좌표_기획)이므로 무엇을 모르면 링크를 만들지 않는다.
 */
export function coordinateHref(coordinate: Coordinate | undefined): string | undefined {
  if (!coordinate?.ownerId) return undefined;
  const node = coordinate.nodePath?.at(-1) ?? coordinate.articleId;
  if (coordinate.document === "general" || coordinate.document === "coverageMaster") {
    return `/documents/${coordinate.ownerId}${node ? `?node=${node}` : ""}`;
  }
  if (coordinate.document === "clause") return `/clauses/${coordinate.ownerId}${node ? `?node=${node}` : ""}`;
  if (coordinate.document === "product") {
    const coverageId = coordinate.nodePath?.[0];
    return coverageId ? `/products/${coordinate.ownerId}/coverages/${coverageId}` : `/products/${coordinate.ownerId}`;
  }
  return undefined;
}
