"use client";

import { useId, useRef, useState, type CSSProperties, type PointerEvent, type WheelEvent } from "react";

import { formatCoordinate } from "@/domain/coordinate";
import type { RefNodeKey } from "@/domain/refs";

import { VIA_LABEL, refTargetParams } from "./lib";
import { NODE_COLOR, type Plot, type PlotEdge, type PlotNode } from "./plot";

interface GraphPanelProps {
  plot: Plot;
  /** 그래프 옵션만 든 직렬화된 쿼리. 노드 링크가 조회 대상을 바꿀 때 그대로 물려준다. */
  optionQuery: string;
}

type ViewBox = [x: number, y: number, width: number, height: number];

function parseViewBox(value: string): ViewBox {
  const parts = value.split(/\s+/).map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 1, parts[3] ?? 1];
}

function targetHref(key: RefNodeKey, optionQuery: string): string {
  const params = new URLSearchParams(optionQuery);
  for (const name of ["kind", "code", "id", "level", "fieldCode", "valueCode"]) params.delete(name);
  for (const [name, value] of Object.entries(refTargetParams(key))) params.set(name, value);
  return `/relations?${params.toString()}`;
}

function edgeTitle(edge: PlotEdge): string {
  if (edge.style === "containment") return "포함 관계";
  const kinds = edge.vias.map((via) => VIA_LABEL[via]).join(" · ");
  const coordinates = edge.ats.map((at) => formatCoordinate(at, { source: true })).join("\n");
  return coordinates ? `${kinds}\n${coordinates}` : kinds;
}

function edgePath(edge: PlotEdge, byId: ReadonlyMap<string, PlotNode>): string {
  const from = byId.get(edge.from)!;
  const to = byId.get(edge.to)!;
  if (edge.from === edge.to) return `M ${from.x - 12} ${from.y - 16} C ${from.x - 38} ${from.y - 52}, ${from.x + 38} ${from.y - 52}, ${from.x + 12} ${from.y - 16}`;
  return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
}

function NodeShape({ node }: { node: PlotNode }) {
  if (node.shape === "circle") return <circle r="18" />;
  if (node.shape === "rect") return <rect x="-21" y="-16" width="42" height="32" rx="3" />;
  return <path d="M 0 -20 L 22 0 L 0 20 L -22 0 Z" />;
}

function LegendShape({ shape }: { shape: PlotNode["shape"] }) {
  return (
    <svg className="ts-graph-legend-shape" viewBox="0 0 24 24" aria-hidden="true">
      {shape === "circle" ? <circle cx="12" cy="12" r="7" /> : shape === "rect" ? <rect x="4" y="6" width="16" height="12" rx="1" /> : <path d="M 12 3 L 21 12 L 12 21 L 3 12 Z" />}
    </svg>
  );
}

function LegendLine({ style }: { style: "solid" | "dashed" | "dotted" | "containment" }) {
  return (
    <svg className="ts-graph-legend-line" viewBox="0 0 34 12" aria-hidden="true">
      <line x1="1" y1="6" x2="33" y2="6" className={`is-${style}`} />
    </svg>
  );
}

export function GraphPanel({ plot, optionQuery }: GraphPanelProps) {
  const naturalViewBox = plot.status === "ok" ? plot.viewBox : "0 0 1 1";
  const [viewBox, setViewBox] = useState(naturalViewBox);
  const [hoveredNode, setHoveredNode] = useState<string>();
  const drag = useRef<{ x: number; y: number } | null>(null);
  const markerId = useId().replaceAll(":", "");

  if (plot.status !== "ok") return null;

  const byId = new Map(plot.nodes.map((node) => [node.id, node]));
  const connected = new Set<string>();
  if (hoveredNode) {
    connected.add(hoveredNode);
    for (const edge of plot.edges) {
      if (edge.from === hoveredNode) connected.add(edge.to);
      if (edge.to === hoveredNode) connected.add(edge.from);
    }
  }

  const handleWheel = (event: WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const [x, y, width, height] = parseViewBox(viewBox);
    const natural = parseViewBox(naturalViewBox);
    const factor = Math.exp(event.deltaY * 0.001);
    const nextWidth = Math.min(natural[2] * 4, Math.max(natural[2] * 0.25, width * factor));
    const nextHeight = (height * nextWidth) / width;
    const rect = event.currentTarget.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width;
    const py = (event.clientY - rect.top) / rect.height;
    setViewBox(`${x + (width - nextWidth) * px} ${y + (height - nextHeight) * py} ${nextWidth} ${nextHeight}`);
  };

  const handlePointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    drag.current = { x: event.clientX, y: event.clientY };
  };

  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (!drag.current) return;
    const [x, y, width, height] = parseViewBox(viewBox);
    const rect = event.currentTarget.getBoundingClientRect();
    const dx = ((event.clientX - drag.current.x) * width) / rect.width;
    const dy = ((event.clientY - drag.current.y) * height) / rect.height;
    drag.current = { x: event.clientX, y: event.clientY };
    setViewBox(`${x - dx} ${y - dy} ${width} ${height}`);
  };

  const stopDragging = () => {
    drag.current = null;
  };

  const referenceCount = plot.edges.reduce((sum, edge) => sum + edge.count, 0);

  return (
    <div className="ts-graph-panel">
      <div className="ts-graph-toolbar">
        <button type="button" onClick={() => setViewBox(naturalViewBox)}>
          맞춤
        </button>
        <span className="ts-muted">휠로 확대 · 드래그로 이동</span>
      </div>
      <svg
        className="ts-graph-canvas"
        viewBox={viewBox}
        role="img"
        aria-labelledby={`${markerId}-title ${markerId}-desc`}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
        onPointerLeave={stopDragging}
      >
        <title id={`${markerId}-title`}>조회 대상의 이웃 그래프</title>
        <desc id={`${markerId}-desc`}>노드 {plot.nodes.length}개 간선 {referenceCount}개</desc>
        <defs>
          <marker id={`${markerId}-arrow`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 Z" fill="var(--ts-ink-2)" />
          </marker>
          <marker id={`${markerId}-error-arrow`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 Z" fill="var(--ts-error)" />
          </marker>
        </defs>

        <g className="ts-graph-edges">
          {plot.edges.map((edge) => {
            const dimmed = hoveredNode !== undefined && edge.from !== hoveredNode && edge.to !== hoveredNode;
            const from = byId.get(edge.from)!;
            const to = byId.get(edge.to)!;
            const labelX = edge.from === edge.to ? from.x : (from.x + to.x) / 2;
            const labelY = edge.from === edge.to ? from.y - 52 : (from.y + to.y) / 2;
            return (
              <g key={edge.id} className={`ts-graph-edge is-${edge.style}${edge.broken ? " is-broken" : ""}`} style={{ opacity: dimmed ? 0.25 : 1 }}>
                <title>{edgeTitle(edge)}</title>
                <path d={edgePath(edge, byId)} markerEnd={edge.style === "containment" ? undefined : `url(#${markerId}-${edge.broken ? "error-arrow" : "arrow"})`} />
                {edge.count > 1 && (
                  <text x={labelX} y={labelY} textAnchor="middle" dy="-4">
                    ×{edge.count}
                  </text>
                )}
              </g>
            );
          })}
        </g>

        <g className="ts-graph-nodes">
          {plot.nodes.map((node) => {
            const dimmed = hoveredNode !== undefined && !connected.has(node.id);
            const current = node.hop === 0;
            return (
              <a
                key={node.id}
                href={targetHref(node.key, optionQuery)}
                aria-label={`${node.fullLabel}${node.declared ? "" : " — 없음"} 조회`}
                data-graph-node={node.id}
                onMouseEnter={() => setHoveredNode(node.id)}
                onMouseLeave={() => setHoveredNode(undefined)}
                onFocus={() => setHoveredNode(node.id)}
                onBlur={() => setHoveredNode(undefined)}
                style={{ opacity: dimmed ? 0.25 : 1 }}
              >
                <g
                  className={`ts-graph-node${current ? " is-current" : ""}${node.declared ? "" : " is-missing"}`}
                  transform={`translate(${node.x} ${node.y})`}
                  style={{ "--ts-node-color": NODE_COLOR[node.kind] } as CSSProperties}
                >
                  <title>{node.fullLabel}</title>
                  <NodeShape node={node} />
                  <text y="31" textAnchor="middle">
                    {node.label}
                    {node.declared ? "" : " (없음)"}
                  </text>
                </g>
              </a>
            );
          })}
        </g>
      </svg>
      {plot.nodes.length === 1 && plot.edges.length === 0 && <p className="ts-muted ts-graph-empty">연결된 것이 없다.</p>}
      <div className="ts-graph-legend" aria-label="그래프 범례">
        <span><LegendShape shape="circle" /> 정의류</span>
        <span><LegendShape shape="rect" /> 문면류</span>
        <span><LegendShape shape="diamond" /> 모델링류</span>
        <span className="ts-graph-legend-separator" aria-hidden="true" />
        <span><LegendLine style="solid" /> 본문 참조</span>
        <span><LegendLine style="dashed" /> 구조 결합</span>
        <span><LegendLine style="dotted" /> 참조 아닌 관계</span>
        <span><LegendLine style="containment" /> 포함 관계</span>
      </div>
    </div>
  );
}
