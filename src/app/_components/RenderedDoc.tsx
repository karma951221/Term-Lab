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
  RenderedSubitem,
} from "@/domain/assembly";

function ErrorMark({ node }: { node: ErrorNode }) {
  return (
    <span id={`node-${node.id}`} className="ts-doc-error" role="alert" title={node.issue.message}>
      ⚠ {node.issue.message}
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

function Item({ node }: { node: RenderedItem | ErrorNode }) {
  if (node.kind === "error") return <li><ErrorMark node={node} /></li>;
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

function Paragraph({ node }: { node: RenderedParagraph | ErrorNode }) {
  if (node.kind === "error") return <p><ErrorMark node={node} /></p>;
  return (
    <p id={`node-${node.id}`} className="ts-doc-paragraph">
      <span className="ts-doc-num">{node.label}</span>{" "}
      {node.children.map((c, i) => (
        <Inline key={i} node={c} />
      ))}
      {node.items && node.items.length > 0 && (
        <ol className="ts-doc-items">
          {node.items.map((it, i) => (
            <Item key={i} node={it} />
          ))}
        </ol>
      )}
    </p>
  );
}

function Article({ node }: { node: RenderedArticle | ErrorNode }) {
  if (node.kind === "error") return <div className="ts-doc-article"><ErrorMark node={node} /></div>;
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
      {group.docs.map((d) => (
        <RenderedDoc key={d.id} doc={d} />
      ))}
    </section>
  );
}
