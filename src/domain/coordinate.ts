import { articleRefLabel, paragraphLabel } from "./document/numbering";
import type { Coordinate } from "./types";

const DOCUMENT_LABEL: Record<NonNullable<Coordinate["document"]>, string> = {
  general: "보통약관",
  special: "특약",
  clause: "공용조항",
  coverageMaster: "담보 마스터",
  product: "상품모델링",
};

const NODE_LABEL: Record<string, string> = {
  slot: "슬롯",
  value: "값",
  condition: "조건식",
  articleRef: "참조",
  appendixRef: "별표 참조",
  clauseRef: "공용조항 참조",
  option: "옵션",
};

/** 오류좌표_기획 §4의 원천/결과 공용 표시 렌더러. 없는 정보는 건너뛴다. */
export function formatCoordinate(coordinate: Coordinate, options: { source?: boolean } = {}): string {
  const source = options.source === true;
  const parts: string[] = [];
  if (coordinate.document) parts.push(DOCUMENT_LABEL[coordinate.document]);
  if (coordinate.ownerName ?? coordinate.ownerId) parts.push(coordinate.ownerName ?? coordinate.ownerId!);
  if (coordinate.subjectName) parts.push(coordinate.subjectName);
  if (coordinate.section) parts.push(coordinate.section.label);
  if (coordinate.articleTitle) {
    parts.push(!source && coordinate.articleNumber ? articleRefLabel(coordinate.articleNumber, coordinate.articleTitle) : `「${coordinate.articleTitle}」`);
  }
  if (coordinate.paragraphNumber) parts.push(source ? `${coordinate.paragraphNumber}번째 항` : paragraphLabel(coordinate.paragraphNumber));
  if (coordinate.itemNumber) parts.push(source ? `${coordinate.itemNumber}번째 호` : `제${coordinate.itemNumber}호`);
  if (coordinate.subitemNumber) parts.push(source ? `${coordinate.subitemNumber}번째 목` : `제${coordinate.subitemNumber}목`);
  if (coordinate.nodeKind !== "value") {
    const kind = coordinate.nodeKind ? (NODE_LABEL[coordinate.nodeKind] ?? coordinate.nodeKind) : undefined;
    if (kind) parts.push(`${kind}${coordinate.refPath ? `:${coordinate.refPath}` : ""}`);
    else if (coordinate.refPath) parts.push(coordinate.refPath);
  } else if (coordinate.refPath) {
    parts.push(coordinate.refPath);
  }
  return parts.join(" › ") || "(좌표 없음)";
}
