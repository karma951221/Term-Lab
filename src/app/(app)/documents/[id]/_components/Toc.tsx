/**
 * L3 좌측 목차 — **조만** 싣는다 (디자인원칙 §2 L3: 「목차는 이동 수단이지 문서 구조 설명서가 아니다」).
 * 항·호로 내려가지 않고 참조 별표도 싣지 않는다. 현재 조는 주칠로 표시한다.
 */
import Link from "next/link";

import type { ArticleNode, DocumentNode, Node, NodeNumber } from "@/domain/document";
import type { Id } from "@/domain/types";

import type { LinkTo } from "./ctx";

/** 조건 블록을 투명하게 펼쳐 조만 순서대로. */
export function articlesOf(tree: DocumentNode): ArticleNode[] {
  const out: ArticleNode[] = [];
  const walk = (nodes: readonly Node[]): void => {
    for (const n of nodes) {
      if (n.kind === "article") out.push(n);
      else if (n.kind === "condBlock") for (const br of n.branches) walk(br.children);
    }
  };
  walk(tree.children);
  return out;
}

export function Toc({
  articles,
  numbers,
  currentArticleId,
  linkTo,
}: {
  articles: readonly ArticleNode[];
  numbers: ReadonlyMap<Id, NodeNumber>;
  currentArticleId?: Id;
  linkTo: LinkTo;
}) {
  return (
    <nav className="ts-l3-toc" aria-label="조 목차">
      {articles.length === 0 ? (
        <p className="ts-muted">조 없음</p>
      ) : (
        articles.map((a) => {
          const label = `${numbers.get(a.id)?.label ?? "조"}(${a.title})`;
          return (
            <Link key={a.id} href={`${linkTo({ art: a.id })}#art-${a.id}`} title={label} aria-current={a.id === currentArticleId ? "true" : undefined}>
              {label}
            </Link>
          );
        })
      )}
    </nav>
  );
}
