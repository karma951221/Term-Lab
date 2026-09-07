/**
 * 관계정보 이웃 그래프의 탐색·배치 — React·DB 에 기대지 않는 순수 모듈.
 *
 * 참조 조회는 도메인의 `referencesFrom`/`usagesOf` 의미(자신과 하위)를 그대로 쓰고,
 * 화면에는 조회 노드와 발견된 반대편 노드를 잇는 이웃 간선으로 투영한다.
 */
import type { Coordinate } from "@/domain/types";
import {
  ancestorKeys,
  describeKey,
  nodeKey,
  referencesFrom,
  usagesOf,
  type EdgeVia,
  type RefEdge,
  type RefGraph,
  type RefNodeKey,
  type RefNodeKind,
} from "@/domain/refs";

export type NodeShape = "circle" | "rect" | "diamond";
export type EdgeStyle = "solid" | "dashed" | "dotted" | "containment";
export type Direction = "both" | "in" | "out";

export interface PlotOptions {
  depth: number;
  direction: Direction;
  kinds: ReadonlySet<RefNodeKind>;
  vias: ReadonlySet<EdgeVia>;
  containment: boolean;
  maxNodes?: number;
  maxEdges?: number;
}

export interface PlotNode {
  id: string;
  key: RefNodeKey;
  kind: RefNodeKind;
  shape: NodeShape;
  label: string;
  fullLabel: string;
  hop: number;
  declared: boolean;
  x: number;
  y: number;
}

export interface PlotEdge {
  id: string;
  from: string;
  to: string;
  style: EdgeStyle;
  count: number;
  vias: EdgeVia[];
  broken: boolean;
  ats: Coordinate[];
}

export type Plot =
  | { status: "ok"; nodes: PlotNode[]; edges: PlotEdge[]; viewBox: string }
  | { status: "tooLarge"; nodeCount: number; edgeCount: number };

export const NODE_SHAPE = {
  discriminator: "circle",
  field: "circle",
  enum: "circle",
  enumValue: "circle",
  attribute: "circle",
  attributeValue: "circle",
  document: "rect",
  article: "rect",
  clause: "rect",
  clauseOption: "rect",
  clauseOptionValue: "rect",
  appendix: "rect",
  coverageNode: "diamond",
  product: "diamond",
  productCoverage: "diamond",
  entity: "diamond",
} as const satisfies Record<RefNodeKind, NodeShape>;

export const EDGE_STYLE = {
  when: "solid",
  slot: "solid",
  expression: "solid",
  clauseRef: "dashed",
  optionSelect: "dashed",
  articleRef: "dashed",
  link: "dashed",
  appendixRef: "dashed",
  generalDocument: "dashed",
  document: "dashed",
  override: "dashed",
  attach: "dotted",
  type: "dotted",
  mount: "dotted",
  combination: "dotted",
} as const satisfies Record<EdgeVia, Exclude<EdgeStyle, "containment">>;

/** 가까운 종류끼리 한 흙빛을 공유한다. 모양이 1차, 이 색이 2차 구별 수단이다. */
export const NODE_COLOR = {
  discriminator: "var(--ts-graph-1)",
  field: "var(--ts-graph-1)",
  enum: "var(--ts-graph-2)",
  enumValue: "var(--ts-graph-2)",
  attribute: "var(--ts-graph-3)",
  attributeValue: "var(--ts-graph-3)",
  clause: "var(--ts-graph-4)",
  clauseOption: "var(--ts-graph-4)",
  clauseOptionValue: "var(--ts-graph-4)",
  document: "var(--ts-graph-5)",
  article: "var(--ts-graph-5)",
  appendix: "var(--ts-graph-6)",
  coverageNode: "var(--ts-graph-7)",
  productCoverage: "var(--ts-graph-7)",
  product: "var(--ts-graph-8)",
  entity: "var(--ts-graph-8)",
} as const satisfies Record<RefNodeKind, string>;

const SHAPE_ORDER = { circle: 0, rect: 1, diamond: 2 } as const satisfies Record<NodeShape, number>;
const VIEWBOX_MARGIN = 40;

interface FoundNode {
  key: RefNodeKey;
  hop: number;
}

interface FoundEdge {
  edge: RefEdge;
  from: string;
  to: string;
  order: number;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareNodes(a: Pick<PlotNode, "shape" | "kind" | "id">, b: Pick<PlotNode, "shape" | "kind" | "id">): number {
  return SHAPE_ORDER[a.shape] - SHAPE_ORDER[b.shape] || compareText(a.kind, b.kind) || compareText(a.id, b.id);
}

function shortLabel(fullLabel: string): string {
  const last = fullLabel.split(" › ").at(-1) ?? fullLabel;
  const letters = Array.from(last);
  return letters.length > 14 ? `${letters.slice(0, 13).join("")}…` : last;
}

function roundOne(value: number): string {
  const rounded = Math.abs(value) < 0.05 ? 0 : value;
  return rounded.toFixed(1);
}

function nodeHalfSize(shape: NodeShape): { x: number; y: number } {
  if (shape === "circle") return { x: 18, y: 18 };
  if (shape === "rect") return { x: 21, y: 16 };
  return { x: 22, y: 20 };
}

function groupEdges(graph: RefGraph, found: readonly FoundEdge[]): PlotEdge[] {
  const grouped = new Map<string, PlotEdge>();
  for (const { edge, from, to } of [...found].sort((a, b) => a.order - b.order || compareText(a.from, b.from) || compareText(a.to, b.to))) {
    const style = EDGE_STYLE[edge.via];
    const id = `${from}→${to}#${style}`;
    const current = grouped.get(id);
    if (current) {
      current.count += 1;
      if (!current.vias.includes(edge.via)) current.vias.push(edge.via);
      if (current.ats.length < 5) current.ats.push(edge.at);
      current.broken ||= !graph.nodes.has(nodeKey(edge.to));
    } else {
      grouped.set(id, {
        id,
        from,
        to,
        style,
        count: 1,
        vias: [edge.via],
        broken: !graph.nodes.has(nodeKey(edge.to)),
        ats: [edge.at],
      });
    }
  }
  return [...grouped.values()].sort((a, b) => compareText(a.id, b.id));
}

function containmentEdges(graph: RefGraph, nodes: ReadonlyMap<string, FoundNode>): PlotEdge[] {
  const out: PlotEdge[] = [];
  for (const child of [...nodes.values()].sort((a, b) => compareText(nodeKey(a.key), nodeKey(b.key)))) {
    const childId = nodeKey(child.key);
    const parentId = ancestorKeys(graph, child.key).slice(1).find((id) => nodes.has(id));
    if (!parentId) continue;
    out.push({
      id: `${childId}→${parentId}#containment`,
      from: childId,
      to: parentId,
      style: "containment",
      count: 1,
      vias: [],
      broken: false,
      ats: [],
    });
  }
  return out;
}

/** 조회 대상을 중심으로 최대 3홉의 결정적 동심원 그림 데이터를 만든다. */
export function plotNeighborhood(graph: RefGraph, target: RefNodeKey, opts: PlotOptions): Plot {
  const depth = Math.max(1, Math.min(3, Math.trunc(opts.depth)));
  const maxNodes = opts.maxNodes ?? 300;
  const maxEdges = opts.maxEdges ?? 600;
  const targetId = nodeKey(target);
  const nodes = new Map<string, FoundNode>([[targetId, { key: target, hop: 0 }]]);
  const foundEdges: FoundEdge[] = [];
  const seenEdges = new Set<RefEdge>();
  const edgeOrder = new Map(graph.edges.map((edge, index) => [edge, index]));

  for (let hop = 0; hop < depth; hop += 1) {
    const ring = [...nodes.values()]
      .filter((node) => node.hop === hop)
      .sort((a, b) => compareText(nodeKey(a.key), nodeKey(b.key)));

    for (const current of ring) {
      const currentId = nodeKey(current.key);
      const candidates: Array<{ edge: RefEdge; neighbor: RefNodeKey; from: string; to: string }> = [];
      if (opts.direction === "both" || opts.direction === "out") {
        for (const edge of referencesFrom(graph, current.key)) {
          candidates.push({ edge, neighbor: edge.to, from: currentId, to: nodeKey(edge.to) });
        }
      }
      if (opts.direction === "both" || opts.direction === "in") {
        for (const edge of usagesOf(graph, current.key)) {
          candidates.push({ edge, neighbor: edge.from, from: nodeKey(edge.from), to: currentId });
        }
      }

      candidates.sort(
        (a, b) =>
          compareText(nodeKey(a.neighbor), nodeKey(b.neighbor)) ||
          (edgeOrder.get(a.edge) ?? 0) - (edgeOrder.get(b.edge) ?? 0) ||
          compareText(a.from, b.from) ||
          compareText(a.to, b.to),
      );

      for (const candidate of candidates) {
        const { edge, neighbor, from, to } = candidate;
        if (!opts.vias.has(edge.via) || !opts.kinds.has(neighbor.kind)) continue;
        const neighborId = nodeKey(neighbor);
        if (!nodes.has(neighborId)) nodes.set(neighborId, { key: neighbor, hop: hop + 1 });
        if (!seenEdges.has(edge)) {
          seenEdges.add(edge);
          foundEdges.push({ edge, from, to, order: edgeOrder.get(edge) ?? 0 });
        }
      }
    }
  }

  const references = groupEdges(graph, foundEdges);
  const containments = opts.containment ? containmentEdges(graph, nodes) : [];
  const edgeCount = foundEdges.length + containments.length;
  if (nodes.size > maxNodes || edgeCount > maxEdges) return { status: "tooLarge", nodeCount: nodes.size, edgeCount };

  const plotted: PlotNode[] = [...nodes.values()].map(({ key, hop }) => {
    const id = nodeKey(key);
    const fullLabel = describeKey(key, graph);
    return {
      id,
      key,
      kind: key.kind,
      shape: NODE_SHAPE[key.kind],
      label: shortLabel(fullLabel),
      fullLabel,
      hop,
      declared: graph.nodes.has(id),
      x: 0,
      y: 0,
    };
  });

  for (let hop = 1; hop <= depth; hop += 1) {
    const ring = plotted.filter((node) => node.hop === hop).sort(compareNodes);
    const radius = Math.max(120 * hop, (44 * ring.length) / (2 * Math.PI));
    ring.forEach((node, index) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * index) / ring.length;
      node.x = radius * Math.cos(angle);
      node.y = radius * Math.sin(angle);
    });
  }

  plotted.sort((a, b) => a.hop - b.hop || compareNodes(a, b));
  const minX = Math.min(...plotted.map((node) => node.x - nodeHalfSize(node.shape).x)) - VIEWBOX_MARGIN;
  const minY = Math.min(...plotted.map((node) => node.y - nodeHalfSize(node.shape).y)) - VIEWBOX_MARGIN;
  const maxX = Math.max(...plotted.map((node) => node.x + nodeHalfSize(node.shape).x)) + VIEWBOX_MARGIN;
  const maxY = Math.max(...plotted.map((node) => node.y + nodeHalfSize(node.shape).y)) + VIEWBOX_MARGIN;

  return {
    status: "ok",
    nodes: plotted,
    edges: [...references, ...containments].sort((a, b) => compareText(a.id, b.id)),
    viewBox: `${roundOne(minX)} ${roundOne(minY)} ${roundOne(maxX - minX)} ${roundOne(maxY - minY)}`,
  };
}
