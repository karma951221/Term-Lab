/** 담보 문면에 준용규정 조가 없으면 조립 결과 끝에 MVP 최소형을 붙인다. 관 안의 조도 센다 (2026-09-08 리뷰 5). */
import type { SubstitutedDoc } from "./types";
import { articlesOf } from "./walk";

export function ensureApplicationArticle(doc: SubstitutedDoc): SubstitutedDoc {
  if (articlesOf(doc).some((article) => article.title === "준용규정")) return doc;
  return {
    ...doc,
    children: [
      ...doc.children,
      {
        kind: "article",
        id: `${doc.id}::application-article`,
        title: "준용규정",
        children: [
          {
            kind: "paragraph",
            id: `${doc.id}::application-paragraph`,
            children: [{ kind: "text", id: `${doc.id}::application-text`, text: "이 특별약관에서 정하지 않은 사항은 보통약관을 따릅니다." }],
          },
        ],
      },
    ],
  };
}
