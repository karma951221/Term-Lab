/**
 * 조립 결과 문서트리(`RenderedDoc`) 재귀 렌더 — 조립 미리보기(`/products/[id]/preview`)와
 * 상품담보 미리보기(`/products/[id]/coverages/[pcId]`)가 함께 쓴다.
 *
 * 오류 마커 노드(`kind:'error'`)는 그 자리에 붉은 배지로 표시하고, 앵커(`id="node-<id>"`)를 심어
 * 오류 패널에서 클릭하면 해당 자리로 이동할 수 있게 한다. 순수 렌더 — 규칙 없음.
 */
import type {
  ErrorNode,
  RenderedArticle,
  RenderedDoc as RenderedDocType,
  RenderedGroup,
  RenderedInline,
  RenderedItem,
  RenderedParagraph,
  RenderedSection,
  RenderedStatic,
  RenderedSubitem,
} from "@/domain/assembly";

/** 정적 표·박스 — 임시 자리 표시 (실제 표시는 편집기 확장과 함께). */
function Static({ node }: { node: RenderedStatic }) {
  return <div id={`node-${node.id}`} className="ts-muted">[{node.kind === "table" ? `표${node.title ? `: ${node.title}` : ""}` : `박스: ${node.title}`}]</div>;
}

/** 오류 표식 — 문자 글리프(⚠)가 아니라 그린다. 색은 `currentColor` 로 상속된다 (디자인원칙 §1.6). */
function WarningIcon() {
  return (
    <svg className="ts-icon" width={12} height={12} viewBox="0 0 14 14" aria-hidden="true" focusable="false">
      <path d="M7 1.5 L13 12.5 L1 12.5 Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <line x1="7" y1="5.5" x2="7" y2="9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="7" cy="10.8" r="0.9" fill="currentColor" />
    </svg>
  );
}

function ErrorMark({ node }: { node: ErrorNode }) {
  return (
    <span id={`node-${node.id}`} className="ts-doc-error" role="alert" title={node.issue.message}>
      <WarningIcon />
      {node.issue.message}
    </span>
  );
}

function Inline({ node }: { node: RenderedInline }) {
  switch (node.kind) {
    case "text":
      return <>{node.text}</>;
    case "articleRef":
      return (
        <span id={`node-${node.id}`} className="ts-doc-ref">
          {node.label}
        </span>
      );
    case "appendixRef":
      return (
        <span id={`node-${node.id}`} className="ts-doc-ref">
          {node.label}
        </span>
      );
    case "error":
      return <ErrorMark node={node} />;
  }
}

function Subitem({ node }: { node: RenderedSubitem | ErrorNode }) {
  if (node.kind === "error") return <li><ErrorMark node={node} /></li>;
  return (
    <li id={`node-${node.id}`} className="ts-doc-subitem">
      {node.children.map((c, i) => (
        <Inline key={i} node={c} />
      ))}
    </li>
  );
}

function Item({ node }: { node: RenderedItem | RenderedStatic | ErrorNode }) {
  if (node.kind === "error") return <li><ErrorMark node={node} /></li>;
  if (node.kind !== "item") return <li><Static node={node} /></li>;
  return (
    <li id={`node-${node.id}`} className="ts-doc-item">
      {node.children.map((c, i) => (
        <Inline key={i} node={c} />
      ))}
      {node.subitems && node.subitems.length > 0 && (
        <ol className="ts-doc-subitems">
          {node.subitems.map((s, i) => (
            <Subitem key={i} node={s} />
          ))}
        </ol>
      )}
    </li>
  );
}

/** 항 — 호 목록이 있으면 `<div>` 로, 없으면 `<p>` 로 낸다 — `<ol>` 을 `<p>` 안에 두지 않기 위해서다 (문단 표시는 클래스가 한다). */
function Paragraph({ node }: { node: RenderedParagraph | RenderedStatic | ErrorNode }) {
  if (node.kind === "error")
    return (
      <p className="ts-doc-paragraph">
        <ErrorMark node={node} />
      </p>
    );
  if (node.kind !== "paragraph") return <Static node={node} />;
  const items = node.items ?? [];
  const body = (
    <>
      <span className="ts-doc-num">{node.label}</span>{" "}
      {node.children.map((c, i) => (
        <Inline key={i} node={c} />
      ))}
    </>
  );
  if (items.length === 0)
    return (
      <p id={`node-${node.id}`} className="ts-doc-paragraph">
        {body}
      </p>
    );
  return (
    <div id={`node-${node.id}`} className="ts-doc-paragraph">
      {body}
      <ol className="ts-doc-items">
        {items.map((it, i) => (
          <Item key={i} node={it} />
        ))}
      </ol>
    </div>
  );
}

function Section({ node }: { node: RenderedSection }) {
  return (
    <section id={`node-${node.id}`} className="ts-doc-section">
      <h2 className="ts-doc-section-title">
        {node.label} {node.title}
      </h2>
      {node.children.map((a, i) => (
        <Article key={i} node={a} />
      ))}
    </section>
  );
}

function Article({ node }: { node: RenderedArticle | RenderedSection | ErrorNode }) {
  if (node.kind === "error") return <div className="ts-doc-article"><ErrorMark node={node} /></div>;
  if (node.kind === "section") return <Section node={node} />;
  return (
    <section id={`node-${node.id}`} className="ts-doc-article">
      <h3 className="ts-doc-article-title">
        {node.label}({node.title})
      </h3>
      {node.children.map((p, i) => (
        <Paragraph key={i} node={p} />
      ))}
    </section>
  );
}

export function RenderedDoc({ doc }: { doc: RenderedDocType }) {
  return (
    <article className="ts-doc" data-owner={doc.ownerId}>
      <h2 className="ts-doc-title">{doc.title}</h2>
      {doc.children.map((a, i) => (
        <Article key={i} node={a} />
      ))}
    </article>
  );
}

export function RenderedGroupView({ group }: { group: RenderedGroup }) {
  return (
    <section className="ts-doc-group">
      <h2 className="ts-doc-group-title">{group.title}</h2>
      {group.docs.map((d, i) => (
        <RenderedDoc key={`${d.ownerId ?? d.id}-${i}`} doc={d} />
      ))}
    </section>
  );
}
