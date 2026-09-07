/**
 * 중간 표현 순회 헬퍼 — 관(section)을 투명하게 다룬다 (ADR-0029).
 * 파이프라인 각 단계는 조 목록이 필요할 때 `articlesOf`, 조를 바꿔 문서를 다시 만들 때 `mapArticles` 를 쓴다.
 */
import type { ErrorNode, RArticle, RDoc, RSection } from "./types";

/** 관을 투명하게 펼친 조 목록 (오류 마커 제외). */
export function articlesOf<I>(doc: RDoc<I>): RArticle<I>[] {
  const out: RArticle<I>[] = [];
  for (const c of doc.children) {
    if (c.kind === "article") out.push(c);
    else if (c.kind === "section") for (const a of c.children) if (a.kind === "article") out.push(a);
  }
  return out;
}

/** 조마다 fn 을 적용해 문서를 다시 만든다. null 이면 그 조를 뺀다. 관·오류 마커는 유지. */
export function mapArticles<I, J>(doc: RDoc<I>, fn: (a: RArticle<I>) => RArticle<J> | ErrorNode | null): RDoc<J> {
  const one = (c: RArticle<I> | ErrorNode): (RArticle<J> | ErrorNode)[] => {
    if (c.kind === "error") return [c];
    const r = fn(c);
    return r === null ? [] : [r];
  };
  return {
    ...doc,
    children: doc.children.flatMap((c): (RArticle<J> | RSection<J> | ErrorNode)[] => {
      if (c.kind === "section") return [{ ...c, children: c.children.flatMap(one) }];
      return one(c);
    }),
  };
}
