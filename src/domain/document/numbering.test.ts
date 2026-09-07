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
  referenceTargetIndex,
  referenceTargetLabel,
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

  it("조·항·호·목 참조는 직전 위치와 같은 상위 번호를 생략한다", () => {
    const article = { id: "a1", n: 6, title: "해약환급금" };
    const paragraph1 = { kind: "paragraph" as const, article, paragraph: { id: "p1", n: 1 } };
    const paragraph2 = { kind: "paragraph" as const, article, paragraph: { id: "p2", n: 2 } };
    expect(referenceTargetLabel(paragraph1)).toBe("제6조(해약환급금) 제1항");
    expect(referenceTargetLabel(paragraph2, paragraph1)).toBe("제2항");
    expect(referenceTargetLabel({ kind: "item", article, paragraph: { id: "p1", n: 1 }, item: { id: "i2", n: 2 } }, paragraph1)).toBe("제2호");
    expect(referenceTargetLabel({ kind: "subitem", article, paragraph: { id: "p1", n: 1 }, item: { id: "i2", n: 2 }, subitem: { id: "s1", n: 1 } })).toBe("제6조(해약환급금) 제1항 제2호 제1목");
  });

  it("문서 트리의 참조 가능 조·항·호·목을 계산 번호 경로로 색인한다", () => {
    const b = nodeBuilders(sequentialIds("r"));
    const doc = b.document("d", [b.article("a", [b.paragraph([], [b.item([], [b.subitem([])])])])]);
    const index = referenceTargetIndex(doc, numberTree(doc));
    expect([...index.values()].map((target) => referenceTargetLabel(target))).toEqual(["제1조(a)", "제1조(a) 제1항", "제1조(a) 제1항 제1호", "제1조(a) 제1항 제1호 제1목"]);
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

describe("관 · 단항 조 (ADR-0029)", () => {
  it("관은 제N관, 조 번호는 관을 넘어 연속이고 표·박스는 번호가 없다", () => {
    const b = nodeBuilders(sequentialIds("n"));
    const t = b.table({ columns: [{}], rows: [] });
    const s1 = b.section("목적", [b.article("A", [b.paragraph([b.text("x")]), t])]);
    const s2 = b.section("지급", [b.article("B", [b.paragraph([b.text("y")]), b.paragraph([b.text("z")])])]);
    const doc = b.document("D", [s1, s2]);
    const n = numberTree(doc);
    expect(n.get(s1.id)).toEqual({ kind: "section", n: 1, label: "제1관" });
    expect(n.get(s2.id)).toEqual({ kind: "section", n: 2, label: "제2관" });
    expect(n.get(s1.children[0].id)?.label).toBe("제1조");
    expect(n.get(s2.children[0].id)?.label).toBe("제2조");
    expect(n.has(t.id)).toBe(false);
  });

  it("항이 하나뿐인 조는 항 마커를 찍지 않고, 둘 이상이면 ①②", () => {
    const b = nodeBuilders(sequentialIds("n"));
    const single = b.paragraph([b.text("x")]);
    const p1 = b.paragraph([b.text("y")]);
    const p2 = b.paragraph([b.text("z")]);
    const doc = b.document("D", [b.article("A", [single]), b.article("B", [p1, p2])]);
    const n = numberTree(doc);
    expect(n.get(single.id)).toEqual({ kind: "paragraph", n: 1, label: "" });
    expect(n.get(p1.id)?.label).toBe("①");
    expect(n.get(p2.id)?.label).toBe("②");
  });

  it("참조 색인은 관 안의 조도 찾는다", () => {
    const b = nodeBuilders(sequentialIds("n"));
    const a = b.article("A", [b.paragraph([b.text("x")])]);
    const doc = b.document("D", [b.section("관", [a])]);
    const index = referenceTargetIndex(doc, numberTree(doc));
    expect(index.get(a.id)).toEqual({ kind: "article", article: { id: a.id, n: 1, title: "A" } });
  });
});
