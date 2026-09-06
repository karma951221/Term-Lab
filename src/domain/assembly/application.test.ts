import { describe, expect, it } from "vitest";

import type { SubstitutedDoc } from "./types";
import { ensureApplicationArticle } from "./application";

describe("3차 S4 — 준용규정 자동 생성", () => {
  it("문면에 준용규정이 없으면 문서 끝에 최소형 한 항을 붙인다", () => {
    const doc: SubstitutedDoc = { kind: "document", id: "s", title: "특약", children: [] };
    const out = ensureApplicationArticle(doc);
    expect(out.children).toEqual([
      {
        kind: "article",
        id: "s::application-article",
        title: "준용규정",
        children: [{ kind: "paragraph", id: "s::application-paragraph", children: [{ kind: "text", id: "s::application-text", text: "이 특별약관에서 정하지 않은 사항은 보통약관을 따릅니다." }] }],
      },
    ]);
  });

  it("문면에 준용규정 조가 있으면 중복 생성하지 않는다", () => {
    const doc: SubstitutedDoc = { kind: "document", id: "s", title: "특약", children: [{ kind: "article", id: "manual", title: "준용규정", children: [] }] };
    expect(ensureApplicationArticle(doc)).toBe(doc);
  });
});
