import { describe, expect, it } from "vitest";

import type { RArticle, RParagraph, SInline, SubstitutedDoc } from "./types";
import { replaceGeneralWithBase } from "./base";

const p = (id: string, text: string): RParagraph<SInline> => ({ kind: "paragraph", id, children: [{ kind: "text", id: `${id}-t`, text }] });
const a = (id: string, title: string, text: string, linkedArticleId?: string): RArticle<SInline> => ({
  kind: "article",
  id,
  title,
  children: [p(`${id}-p`, text)],
  ...(linkedArticleId ? { linkedArticleId } : {}),
});
const d = (id: string, children: RArticle<SInline>[]): SubstitutedDoc => ({ kind: "document", id, title: id, children });

describe("3차 S4 — 기본계약 1개 모드 대치", () => {
  it("조연결된 기본계약 조의 결과 본문을 대응 보통약관 조 자리에 대치한다", () => {
    const general = d("g", [a("g-pay", "보험금의 지급사유", "")]);
    const base = d("b", [a("b-pay", "기본계약 지급사유", "기본계약 본문", "g-pay")]);
    const out = replaceGeneralWithBase(general, base, { productCoverageId: "pc-base", productCoverageName: "상해사망(기본계약)" });
    expect(out.doc.children[0]).toMatchObject({ id: "g-pay", title: "보험금의 지급사유", children: [{ children: [{ text: "기본계약 본문" }] }] });
    expect(out.issues).toEqual([]);
  });

  it("조연결 없는 기본계약 조는 대치하지 않고 warning으로 남긴다", () => {
    const out = replaceGeneralWithBase(d("g", []), d("b", [a("b-extra", "독자 조", "본문")]), { productCoverageId: "pc-base", productCoverageName: "상해사망(기본계약)" });
    expect(out.doc.children).toEqual([]);
    expect(out.issues).toEqual([
      expect.objectContaining({ kind: "unlinkedBaseArticle", severity: "warning", at: expect.objectContaining({ document: "special", ownerId: "pc-base", articleId: "b-extra" }) }),
    ]);
  });
});
