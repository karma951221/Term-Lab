import { describe, expect, it } from "vitest";

import { nodeBuilders, sequentialIds } from "./builders";
import { surgeryFixture } from "./fixture";
import { collectRefs, requiredDiscriminators } from "./refs";

describe("문면_기획 참조 무결성 — collectRefs 는 문서가 읽는 참조 전부를 좌표와 함께 뽑는다 (C1 역인덱스 재료)", () => {
  it("구분자(식 안·슬롯) · 담보속성 · 공용조항 · 조(자기·보통약관) · 별표 · 조연결", () => {
    const { special } = surgeryFixture();
    const refs = collectRefs(special, { document: "special", ownerId: "cov-surgery" });
    const summary = refs.map((r) => {
      switch (r.kind) {
        case "discriminator":
          return ["discriminator", r.path, r.via, r.at.articleId];
        case "attribute":
          return ["attribute", r.path, r.at.articleId];
        case "builtin":
          return ["builtin", r.path, r.at.articleId];
        case "clause":
          return ["clause", r.clauseCode, r.mode, r.at.articleId];
        case "article":
          return ["article", r.articleId, r.scope, r.at.articleId];
        case "appendix":
          return ["appendix", r.appendixCode, r.at.articleId];
        case "link":
          return ["link", r.linkedArticleId, r.at.articleId];
      }
    });
    expect(summary).toMatchSnapshot();
    expect(refs.every((r) => r.at.document === "special" && r.at.ownerId === "cov-surgery")).toBe(true);
    const slotRef = refs.find((r) => r.kind === "discriminator" && r.via === "slot");
    expect(slotRef?.at.nodePath).toEqual(["s-doc", "s-art-pay", "s-par-pay-1", "s-slot-rate"]);
    expect(slotRef?.at.refPath).toBe("D0004");
  });

  it("문법이 깨진 식은 참조를 내지 않는다 (문법 오류는 validateExpressions 몫)", () => {
    const b = nodeBuilders(sequentialIds("n"));
    const doc = b.document("d", [b.condBlock([b.branch("D0001 = = true", [b.article("x", [])])])]);
    expect(collectRefs(doc)).toEqual([]);
  });

  it("요구 구분자 = 문서 자체 참조 + 공용조항의 요구 구분자(게이트) — 중복 없이 등장 순", () => {
    const { special } = surgeryFixture();
    const own = requiredDiscriminators(special);
    expect(own).toEqual(["D0001", "D0004", "D0005", "D0003"]);
    const withGate = requiredDiscriminators(special, {
      clauseExists: () => true,
      requiredCodes: (code) => (code === "C001" ? ["D0009", "D0001"] : []),
      validateOptions: () => [],
    });
    expect(withGate).toEqual(["D0001", "D0004", "D0005", "D0003", "D0009"]);
  });
});
