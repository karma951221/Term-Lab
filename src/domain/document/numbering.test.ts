import { describe, expect, it } from "vitest";

import { nodeBuilders, sequentialIds } from "./builders";
import { surgeryFixture } from "./fixture";
import {
  appendixRefLabel,
  articleLabel,
  articleRefLabel,
  itemLabel,
  numberTree,
  paragraphLabel,
  subitemLabel,
} from "./numbering";

describe("번호 표기 (임시 규칙 — 실물 조사 후 확정)", () => {
  it("조 「제N조」 · 항 원문자 (20 넘으면 (N)) · 호 「N.」 · 목 「가.」", () => {
    expect(articleLabel(3)).toBe("제3조");
    expect(paragraphLabel(1)).toBe("①");
    expect(paragraphLabel(20)).toBe("⑳");
    expect(paragraphLabel(21)).toBe("(21)");
    expect(itemLabel(2)).toBe("2.");
    expect(subitemLabel(1)).toBe("가.");
    expect(subitemLabel(14)).toBe("하.");
    expect(subitemLabel(15)).toBe("(15)");
  });

  it("조 참조 슬롯 「제N조(조 명)」 · 별표 「【별표N(이름)】」", () => {
    expect(articleRefLabel(3, "보험금의 지급사유")).toBe("제3조(보험금의 지급사유)");
    expect(appendixRefLabel(13, "화상 분류표")).toBe("【별표13(화상 분류표)】");
  });
});

describe("문면작성 S1·S3 — 번호는 저장하지 않고 현재 트리에서 계산한다", () => {
  it("조·항·호·목 번호를 순서대로 매긴다 — 조건 블록 안의 조도 현재 트리 순서대로 (전체 뷰)", () => {
    const { special } = surgeryFixture();
    const numbers = numberTree(special);
    const view = Object.fromEntries([...numbers].map(([id, n]) => [id, n.label]));
    expect(view).toMatchSnapshot();
    // 조건 블록 안의 「보험기간」 조가 제2조로 끼고, 이후 조가 밀린다
    expect(numbers.get("s-art-term")?.label).toBe("제2조");
    expect(numbers.get("s-art-exempt")?.label).toBe("제3조");
  });

  it("조 자리의 조건 블록 앞에 조를 넣으면 이후 번호가 전부 밀린다", () => {
    const b = nodeBuilders(sequentialIds("n"));
    const doc = b.document("d", [
      b.article("a", []), // n1
      b.condBlock([b.branch("D0001", [b.article("b", [])])]), // article n2 · branch n3 · cond n4
      b.article("c", []), // n5
    ]);
    expect(numberTree(doc).get("n5")?.n).toBe(3);
    const withFront = { ...doc, children: [b.article("z", []), ...doc.children] };
    expect(numberTree(withFront).get("n5")?.n).toBe(4);
    expect(numberTree(withFront).get("n2")?.n).toBe(3);
  });

  it("사전평가 S1 경계 — 안 타는(notTaken) 가지의 조는 번호에서 빠져 이후 조가 당겨진다", () => {
    const { special } = surgeryFixture();
    const numbers = numberTree(special, { branchStates: new Map([["s-cond-term-if", "notTaken"]]) });
    expect(numbers.has("s-art-term")).toBe(false);
    expect(numbers.get("s-art-exempt")?.label).toBe("제2조");
    // 미결·오류 가지는 뺄 수 없다 — 그대로 센다
    const undetermined = numberTree(special, { branchStates: new Map([["s-cond-term-if", "undetermined"]]) });
    expect(undetermined.get("s-art-term")?.label).toBe("제2조");
  });

  it("공용조항 block 참조는 항 1개로 센다 (임시 — 실제 항 수는 조립이 안다)", () => {
    const b = nodeBuilders(sequentialIds("n"));
    const doc = b.document("d", [b.article("a", [b.paragraph([]), b.clauseBlock("C001", {}), b.paragraph([])])]);
    const numbers = numberTree(doc);
    expect(numbers.get("n1")?.label).toBe("①");
    expect(numbers.get("n2")?.label).toBe("②");
    expect(numbers.get("n3")?.label).toBe("③");
  });
});
