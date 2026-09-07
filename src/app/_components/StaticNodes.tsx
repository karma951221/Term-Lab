/**
 * 정적 표·박스 렌더 (ADR-0029) — 문면 편집기(DocBody)와 조립 미리보기(RenderedDoc)가 함께 쓴다.
 * 서식은 노드 필드가 정한다: 제목줄(header) 행은 <th>, 열 너비는 <col style=width%>.
 * 순수 렌더 — 규칙 없음. `controls` 는 편집 모드의 행 조작 묶음 자리.
 */
import type { ReactNode } from "react";

export interface StaticTableShape {
  id: string;
  title?: string;
  columns: { width?: number }[];
  rows: { header?: boolean; cells: string[] }[];
}

export interface StaticBoxShape {
  id: string;
  title: string;
  lines: string[];
}

export function StaticTable({ node, controls }: { node: StaticTableShape; controls?: ReactNode }) {
  return (
    <figure id={`node-${node.id}`} className="ts-doc-table-wrap">
      {controls}
      {node.title && <figcaption className="ts-doc-table-title">{node.title}</figcaption>}
      <table className="ts-doc-table">
        <colgroup>
          {node.columns.map((c, i) => (
            <col key={i} style={c.width ? { width: `${c.width}%` } : undefined} />
          ))}
        </colgroup>
        <tbody>
          {node.rows.map((r, i) => (
            <tr key={i}>{r.cells.map((cell, j) => (r.header ? <th key={j}>{cell}</th> : <td key={j}>{cell}</td>))}</tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export function StaticBox({ node, controls }: { node: StaticBoxShape; controls?: ReactNode }) {
  return (
    <aside id={`node-${node.id}`} className="ts-doc-box">
      {controls}
      {node.title && <p className="ts-doc-box-title">【{node.title}】</p>}
      {node.lines.map((l, i) => (
        <p key={i} className="ts-doc-box-line">
          {l}
        </p>
      ))}
    </aside>
  );
}
