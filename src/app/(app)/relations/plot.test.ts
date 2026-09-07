import { describe, expect, it } from "vitest";

import { nodeKey, type EdgeVia, type RefEdge, type RefGraph, type RefNodeInfo, type RefNodeKey, type RefNodeKind } from "@/domain/refs";

import { plotNeighborhood, type Direction, type PlotOptions } from "./plot";

const A: RefNodeKey = { kind: "discriminator", code: "A" };
const B: RefNodeKey = { kind: "clause", code: "B" };
const C: RefNodeKey = { kind: "enum", enumCode: "C" };
const D: RefNodeKey = { kind: "product", id: "D" };

function info(key: RefNodeKey, label = nodeKey(key), parent?: RefNodeKey): RefNodeInfo {
  return { key, label, ...(parent ? { parent } : {}) };
}

function edge(from: RefNodeKey, to: RefNodeKey, via: EdgeVia = "when", refPath?: string): RefEdge {
  return { from, to, via, at: refPath ? { refPath } : {} };
}

function graph(nodes: readonly RefNodeInfo[], edges: readonly RefEdge[]): RefGraph {
  return { nodes: new Map(nodes.map((node) => [nodeKey(node.key), node])), edges: [...edges] };
}

const allKinds = new Set<RefNodeKind>([
  "discriminator",
  "field",
  "enum",
  "enumValue",
  "clause",
  "clauseOption",
  "clauseOptionValue",
  "document",
  "article",
  "appendix",
  "coverageNode",
  "attribute",
  "attributeValue",
  "product",
  "productCoverage",
  "entity",
]);
const allVias = new Set<EdgeVia>([
  "when",
  "slot",
  "expression",
  "clauseRef",
  "optionSelect",
  "override",
  "articleRef",
  "link",
  "appendixRef",
  "generalDocument",
  "document",
  "type",
  "attach",
  "mount",
  "combination",
]);

function options(overrides: Partial<PlotOptions> = {}): PlotOptions {
  return { depth: 1, direction: "both", kinds: allKinds, vias: allVias, containment: true, ...overrides };
}

function ids(result: ReturnType<typeof plotNeighborhood>): string[] {
  if (result.status !== "ok") throw new Error("expected an ok plot");
  return result.nodes.map((node) => node.id);
}

describe("plotNeighborhood — 탐색", () => {
  const chain = graph([info(A, "A"), info(B, "B"), info(C, "C")], [edge(A, B), edge(B, C)]);

  it("깊이까지만 홉을 확장한다", () => {
    expect(ids(plotNeighborhood(chain, A, options({ depth: 1, direction: "out" })))).toEqual([nodeKey(A), nodeKey(B)]);
    expect(ids(plotNeighborhood(chain, A, options({ depth: 2, direction: "out" })))).toEqual([nodeKey(A), nodeKey(B), nodeKey(C)]);
  });

  it.each<[Direction, string[]]>([
    ["in", [nodeKey(B), nodeKey(A)]],
    ["out", [nodeKey(B), nodeKey(C)]],
    ["both", [nodeKey(B), nodeKey(A), nodeKey(C)]],
  ])("방향 %s 필터를 적용한다", (direction, expected) => {
    expect(ids(plotNeighborhood(chain, B, options({ direction })))).toEqual(expected);
  });

  it("종류 필터에서 빠진 노드는 넣지 않고 그 너머도 탐색하지 않는다", () => {
    const kinds = new Set<RefNodeKind>(["discriminator", "enum"]);
    expect(ids(plotNeighborhood(chain, A, options({ depth: 3, direction: "out", kinds })))).toEqual([nodeKey(A)]);
  });
});

describe("plotNeighborhood — 간선과 예외", () => {
  it("그림 안의 가장 가까운 조상 하나와 포함 선을 만든다", () => {
    const document: RefNodeKey = { kind: "document", id: "doc" };
    const article: RefNodeKey = { kind: "article", documentId: "doc", articleId: "art" };
    const g = graph([info(B, "B"), info(document, "문서"), info(article, "조", document)], [edge(article, B), edge(document, B)]);
    const result = plotNeighborhood(g, B, options({ direction: "in" }));
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.edges).toContainEqual(expect.objectContaining({ from: nodeKey(article), to: nodeKey(document), style: "containment", count: 1 }));
  });

  it("같은 쌍·같은 스타일은 한 선으로 묶고 형태와 좌표를 보존한다", () => {
    const g = graph([info(A), info(B)], [edge(A, B, "when", "a"), edge(A, B, "slot", "b"), edge(A, B, "when", "c")]);
    const result = plotNeighborhood(g, A, options({ direction: "out", containment: false }));
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.edges).toEqual([
      expect.objectContaining({ from: nodeKey(A), to: nodeKey(B), style: "solid", count: 3, vias: ["when", "slot"], ats: [{ refPath: "a" }, { refPath: "b" }, { refPath: "c" }] }),
    ]);
  });

  it("선언되지 않은 도착점도 노드로 그리고 깨진 간선으로 표시한다", () => {
    const g = graph([info(A)], [edge(A, B, "clauseRef")]);
    const result = plotNeighborhood(g, A, options({ direction: "out" }));
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.nodes.find((node) => node.id === nodeKey(B))).toEqual(expect.objectContaining({ declared: false }));
    expect(result.edges[0]).toEqual(expect.objectContaining({ broken: true, style: "dashed" }));
  });

  it("상한을 넘으면 부분 그림 대신 실제 규모를 돌려준다", () => {
    const g = graph([info(A), info(B), info(C)], [edge(A, B), edge(A, C)]);
    expect(plotNeighborhood(g, A, options({ direction: "out", maxNodes: 2 }))).toEqual({ status: "tooLarge", nodeCount: 3, edgeCount: 2 });
    expect(plotNeighborhood(g, A, options({ direction: "out", maxEdges: 1 }))).toEqual({ status: "tooLarge", nodeCount: 3, edgeCount: 2 });
  });
});

describe("plotNeighborhood — 결정적 배치", () => {
  it("같은 입력을 두 번 계산하면 객체 전체가 같다", () => {
    const g = graph([info(D, "D"), info(C, "C"), info(B, "B"), info(A, "A")], [edge(A, D), edge(A, C), edge(A, B)]);
    expect(plotNeighborhood(g, A, options({ direction: "out" }))).toEqual(plotNeighborhood(g, A, options({ direction: "out" })));
  });

  it("링을 모양·종류·id 순으로 놓고 좌표와 viewBox 를 고정한다", () => {
    const g = graph([info(D, "D"), info(C, "C"), info(B, "B"), info(A, "A")], [edge(A, D), edge(A, C), edge(A, B)]);
    const result = plotNeighborhood(g, A, options({ direction: "out", containment: false }));
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.nodes.map(({ id, hop, x, y }) => ({ id, hop, x: Number(x.toFixed(3)), y: Number(y.toFixed(3)) }))).toMatchInlineSnapshot(`
      [
        {
          "hop": 0,
          "id": "discriminator:A",
          "x": 0,
          "y": 0,
        },
        {
          "hop": 1,
          "id": "enum:C",
          "x": 0,
          "y": -120,
        },
        {
          "hop": 1,
          "id": "clause:B",
          "x": 103.923,
          "y": 60,
        },
        {
          "hop": 1,
          "id": "product:D",
          "x": -103.923,
          "y": 60,
        },
      ]
    `);
    expect(result.viewBox).toBe("-163.9 -180.0 327.8 300.0");
  });
});
