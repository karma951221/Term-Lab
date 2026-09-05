/**
 * 참조 그래프 도메인 (순수) — 사용처 역인덱스 · 고아 · 순환 · 깨진 참조 · 관계정보 뷰 (문면_기획 「참조 무결성」).
 *
 * - types.ts   : RefNodeKey · RefEdge · RefGraph · 입력(GraphInputs)
 * - graph.ts   : buildGraph · nodeKey · structuralParent · refNodeKey · ownerNodeKey · literalCompares
 * - queries.ts : usagesOf · referencesFrom · orphans · cycles · brokenEdges · brokenIssues · relationView · describeKey
 */
export * from "./graph";
export * from "./queries";
export * from "./types";
