import { describe, expect, it } from "vitest";

import type { RArticle, RParagraph, SInline, SubstitutedDoc } from "./types";
import { judgeOmission } from "./omission";

const paragraph = (id: string, text: string, excludeFromComparison = false): RParagraph<SInline> => ({
  kind: "paragraph",
  id,
  children: [{ kind: "text", id: `${id}-text`, text }],
  ...(excludeFromComparison ? { excludeFromComparison: true } : {}),
});

const article = (id: string, title: string, paragraphs: RParagraph<SInline>[], linkedArticleId?: string): RArticle<SInline> => ({
  kind: "article",
  id,
  title,
  children: paragraphs,
  ...(linkedArticleId ? { linkedArticleId } : {}),
});

const doc = (id: string, children: RArticle<SInline>[]): SubstitutedDoc => ({ kind: "document", id, title: id, children });
const owner = { productCoverageId: "pc-1", productCoverageName: "일반상해사망" };

describe("3차 S4 — 항 단위 생략·준용·통째 판정", () => {
  it("항 순서와 무관하게 집합이 같으면 생략한다", () => {
    const general = doc("g", [article("g-a", "일반 조", [paragraph("g-1", "하나"), paragraph("g-2", "둘")])]);
    const special = doc("s", [article("s-a", "특약 조", [paragraph("s-2", "둘"), paragraph("s-1", "하나")], "g-a")]);
    const out = judgeOmission(special, general, owner);
    expect(out.doc.children).toEqual([]);
    expect(out.records).toEqual([{ ...owner, articleId: "s-a", articleTitle: "특약 조", linkedArticleId: "g-a", disposition: "omitted" }]);
  });

  it("보통약관의 모든 항과 추가 항이 있으면 준용 문장 + 추가 항만 남긴다", () => {
    const general = doc("g", [article("g-a", "해약환급금", [paragraph("g-1", "공통 1"), paragraph("g-2", "공통 2")])]);
    const special = doc("s", [article("s-a", "보험금의 감액지급", [paragraph("s-1", "공통 1"), paragraph("s-extra", "추가"), paragraph("s-2", "공통 2")], "g-a")]);
    const out = judgeOmission(special, general, owner);
    const judged = out.doc.children[0];
    expect(judged.kind).toBe("article");
    if (judged.kind !== "article") return;
    expect(judged.children.map((p) => p.id)).toEqual(["s-a::application", "s-extra"]);
    expect(judged.children[0]).toMatchObject({ children: [{ text: "이 특별약관의 보험금의 감액지급은 " }, { kind: "articleRef", scope: "general", targets: [{ nodeId: "g-a" }] }, { text: "를 준용합니다." }] });
    expect(out.records[0].disposition).toBe("applied");
  });

  it("보통약관 항 중 없는 것이 있으면 통째로 유지한다", () => {
    const general = doc("g", [article("g-a", "일반 조", [paragraph("g-1", "공통"), paragraph("g-2", "없음")])]);
    const original = article("s-a", "특약 조", [paragraph("s-1", "공통"), paragraph("s-x", "특약")], "g-a");
    const out = judgeOmission(doc("s", [original]), general, owner);
    expect(out.doc.children).toEqual([original]);
    expect(out.records[0].disposition).toBe("full");
  });

  it("보통약관 block 공용조항의 비교 제외 항은 판정 집합에서 뺀다", () => {
    const general = doc("g", [article("g-a", "일반 조", [paragraph("g-1", "공통"), paragraph("g-x", "제외", true)])]);
    const special = doc("s", [article("s-a", "특약 조", [paragraph("s-1", "공통")], "g-a")]);
    expect(judgeOmission(special, general, owner).records[0].disposition).toBe("omitted");
  });
});
