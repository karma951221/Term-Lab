/** 기본계약 1개 모드: 조연결된 기본계약 조의 해소·치환 결과로 보통약관 조 본문을 대치한다. */
import type { Id, Issue } from "../types";
import type { RArticle, SInline, SubstitutedDoc } from "./types";
import { articlesOf, mapArticles } from "./walk";

export interface BaseOwner {
  productCoverageId: Id;
  productCoverageName: string;
}

export interface BaseReplacementOutcome {
  doc: SubstitutedDoc;
  issues: Issue[];
  /** 대치된 기본계약 조 id → 보통약관 조 id. 기본계약 문면 안의 자기 조 참조를 렌더가 이걸로 푼다. */
  aliases: Map<Id, Id>;
}

export function replaceGeneralWithBase(general: SubstitutedDoc, base: SubstitutedDoc, owner: BaseOwner): BaseReplacementOutcome {
  const replacements = new Map<Id, RArticle<SInline>>();
  const aliases = new Map<Id, Id>();
  const issues: Issue[] = [];
  for (const node of articlesOf(base)) {
    if (node.linkedArticleId === undefined) {
      issues.push({
        kind: "unlinkedBaseArticle",
        severity: "warning",
        message: `기본계약 조 「${node.title}」에 대응 보통약관 조가 연결되지 않아 출력하지 않습니다`,
        at: { document: "special", ownerId: owner.productCoverageId, ownerName: owner.productCoverageName, articleId: node.id, articleTitle: node.title },
      });
      continue;
    }
    replacements.set(node.linkedArticleId, node);
    aliases.set(node.id, node.linkedArticleId);
  }
  return {
    doc: mapArticles(general, (node) => {
      const replacement = replacements.get(node.id);
      return replacement ? { ...node, children: replacement.children } : node;
    }),
    issues,
    aliases,
  };
}
