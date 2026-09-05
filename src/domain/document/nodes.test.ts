import { describe, expect, it } from "vitest";

import { nodeBuilders, sequentialIds } from "./builders";
import { allowedChildren, allowedListChildren, indexTree, validateTree, type DocumentNode } from "./nodes";

/** 결정적 id 로 만든 빌더 — 스냅샷·기대값에 id 가 그대로 나온다. */
function make() {
  return nodeBuilders(sequentialIds("n"));
}

function kinds(issues: { kind: string }[]): string[] {
  return issues.map((i) => i.kind);
}

describe("허용 자식 규칙 테이블 (ADR-0012 — 문서>조>항>호>목, 동적 노드는 자리에 대신 선다)", () => {
  it("문서 아래에는 조와 조건 블록만 선다", () => {
    expect(allowedChildren.document).toEqual(["article", "condBlock"]);
  });

  it("조 아래에는 항 · 조건 블록 · 공용조항 block 참조 · 반복 블록이 선다 (조는 반복 본문에 못 들어간다)", () => {
    expect(allowedChildren.article).toEqual(["paragraph", "condBlock", "clauseBlockRef", "forBlock"]);
    expect(allowedChildren.forBlock).not.toContain("article");
    expect(allowedChildren.forBlock).not.toContain("forBlock");
  });

  it("항·호·목의 children 은 인라인 노드다 — 인라인 조건 안에는 인라인 조건이 없다", () => {
    expect(allowedChildren.paragraph).toContain("text");
    expect(allowedChildren.paragraph).toContain("inlineCond");
    expect(allowedChildren.inlineCond).not.toContain("inlineCond");
    expect(allowedChildren.inlineFor).not.toContain("inlineFor");
  });

  it("호는 항의 items 에, 목은 호의 subitems 에 선다 (조건 블록도 그 자리에 설 수 있다)", () => {
    expect(allowedListChildren["paragraph.items"]).toEqual(["item", "condBlock"]);
    expect(allowedListChildren["item.subitems"]).toEqual(["subitem", "condBlock"]);
  });

  it("잎 노드(텍스트·슬롯·참조)는 자식이 없다", () => {
    for (const k of ["text", "slot", "articleRef", "appendixRef", "clauseInlineRef", "clauseBlockRef"] as const) {
      expect(allowedChildren[k]).toEqual([]);
    }
  });
});

describe("문면작성 S1 — 트리 색인", () => {
  it("모든 노드·가지를 id 로 찾고, 부모·자리·경로·소속 조를 안다", () => {
    const b = make();
    const doc = b.document("수술비", [
      b.article("보험금의 지급사유", [b.paragraph([b.text("회사는 "), b.slot("D0004")])]),
    ]);
    const ix = indexTree(doc);
    // 빌더는 인자(자식)를 먼저 만들므로 id 는 후위 순 — text n1 · slot n2 · paragraph n3 · article n4 · document n5
    const slot = ix.nodes.get("n2")!;
    expect(slot.node.kind).toBe("slot");
    expect(slot.parentId).toBe("n3");
    expect(slot.slot).toBe("children");
    expect(slot.index).toBe(1);
    expect(slot.path).toEqual(["n5", "n4", "n3", "n2"]);
    expect(slot.articleId).toBe("n4");
    expect(ix.nodes.get("n5")!.parentId).toBeUndefined();
  });

  it("조건 블록의 가지도 색인된다 — 가지 안 노드의 경로에 가지 id 가 들어간다", () => {
    const b = make();
    const doc = b.document("d", [b.condBlock([b.branch("D0001 = true", [b.article("보험기간", [])])])]);
    const ix = indexTree(doc);
    // article n1 · branch n2 · condBlock n3 · document n4
    expect(ix.branches.get("n2")?.ownerId).toBe("n3");
    expect(ix.nodes.get("n1")?.path).toEqual(["n4", "n3", "n2", "n1"]);
    expect(ix.nodes.get("n1")?.articleId).toBe("n1");
  });
});

describe("문면작성 S1 경계 — 허용 자식 규칙 위반은 저장 시점에 거부된다", () => {
  it("규칙을 지킨 문서>조>항>호>목 트리는 문제 없음", () => {
    const b = make();
    const doc = b.document("d", [
      b.article("a", [b.paragraph([b.text("t")], [b.item([b.text("h")], [b.subitem([b.text("m")])])])]),
    ]);
    expect(validateTree(doc)).toEqual([]);
  });

  it("목 아래 항 (허용 자식 위반) → structure 이슈 + 노드 경로 좌표", () => {
    const b = make();
    const bad = b.subitem([b.text("m")]);
    // 타입을 우회해 잘못된 자식을 심는다 — 저장 데이터가 깨졌을 때를 흉내
    (bad as unknown as { children: unknown[] }).children.push(b.paragraph([b.text("x")]));
    const doc = b.document("d", [b.article("a", [b.paragraph([], [b.item([], [bad])])])]);
    const issues = validateTree(doc);
    expect(kinds(issues)).toEqual(["structure"]);
    // text n1 · subitem n2 · text n3 · paragraph n4 · item n5 · paragraph n6 · article n7 · document n8
    expect(issues[0].at.nodePath).toEqual(["n8", "n7", "n6", "n5", "n2", "n4"]);
    expect(issues[0].at.articleId).toBe("n7");
    expect(issues[0].message).toContain("subitem");
    expect(issues[0].message).toContain("paragraph");
  });

  it("조건 블록은 서 있는 자리의 허용 집합을 물려받는다 — 문서 자리의 조건 블록 안에 항은 못 온다", () => {
    const b = make();
    const doc = b.document("d", [b.condBlock([b.branch("D0001", [b.paragraph([b.text("x")])])])]);
    expect(kinds(validateTree(doc))).toEqual(["structure"]);
  });

  it("블록 조건의 중첩은 허용 (문면작성 S3)", () => {
    const b = make();
    const doc = b.document("d", [
      b.condBlock([b.branch("D0001", [b.condBlock([b.branch("D0002 = 'V01'", [b.article("x", [])])])])]),
    ]);
    expect(validateTree(doc)).toEqual([]);
  });
});

describe("문면작성 S2 경계 — 인라인 조건 중첩 금지", () => {
  it("인라인 조건 안의 인라인 조건 → structure (인라인 반복을 거쳐도 마찬가지)", () => {
    const b = make();
    const inner = b.inlineCond([b.inlineBranch("D0001", [b.text("최초계약일")])]);
    const doc = b.document("d", [
      b.article("a", [b.paragraph([b.inlineCond([b.inlineBranch("D0001", [inner])])])]),
    ]);
    const issues = validateTree(doc);
    expect(kinds(issues)).toEqual(["structure"]);
    expect(issues[0].message).toContain("인라인 조건");
  });

  it("반복 안의 반복 (블록·인라인) 은 거부 (D-P4-16)", () => {
    const b = make();
    const doc = b.document("d", [
      b.article("a", [b.forBlock("subCoverage", [b.condBlock([b.branch("D0001", [b.forBlock("benefit", [b.paragraph([b.text("x")])])])])])]),
    ]);
    // 조건 블록을 거쳐도 조상에 반복이 있으면 거부 (허용 자식 테이블만으로는 못 잡는 경우)
    const issues = validateTree(doc);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.kind === "structure")).toBe(true);
    expect(issues.some((i) => i.message.includes("반복 안에 반복"))).toBe(true);
  });
});

describe("조건 가지 규칙 (D-P4-11 · D-P4-12)", () => {
  it("else 는 마지막에 최대 1개 — 중간 else · 이중 else 는 structure", () => {
    const b = make();
    const doc = b.document("d", [
      b.condBlock([b.branch(undefined, [b.article("x", [])]), b.branch("D0001", [b.article("y", [])])]),
      b.article("a", [
        b.paragraph([
          b.inlineCond([b.inlineBranch(undefined, [b.text("a")]), b.inlineBranch(undefined, [b.text("b")])]),
        ]),
      ]),
    ]);
    const issues = validateTree(doc);
    expect(kinds(issues)).toEqual(["structure", "structure"]);
    expect(issues[0].at.nodePath).toEqual(["n13", "n5"]); // document n13 · condBlock n5
  });

  it("가지가 하나도 없는 조건 노드는 structure", () => {
    const b = make();
    const doc = b.document("d", [b.condBlock([])]);
    expect(kinds(validateTree(doc))).toEqual(["structure"]);
  });
});

describe("노드 id 유일성 (ADR-0012 — 노드 id 는 트리 안에서 유일)", () => {
  it("같은 id 가 두 번 나오면 structure — 두 번째 등장 위치를 좌표로", () => {
    const b = make();
    const t = b.text("x");
    const doc = b.document("d", [b.article("a", [b.paragraph([t, { ...t }])])]);
    const issues = validateTree(doc);
    expect(kinds(issues)).toEqual(["structure"]);
    expect(issues[0].message).toContain("n1");
    expect(indexTree(doc).duplicates).toEqual(["n1"]);
  });
});

describe("문면작성 S4·S6 — 참조 대상 존재 검증", () => {
  it("같은 문서 조 참조는 대상 조가 있어야 한다 — 없으면 brokenRef", () => {
    const b = make();
    const doc = b.document("d", [
      b.article("a", [b.paragraph([b.articleRef("n4", "self"), b.articleRef("ghost", "self")])]), // 조 = n4
    ]);
    const issues = validateTree(doc);
    expect(kinds(issues)).toEqual(["brokenRef"]);
    expect(issues[0].at.nodePath).toEqual(["n5", "n4", "n3", "n2"]);
  });

  it("보통약관 조 참조·조연결은 대응 보통약관의 조 집합으로 검증한다 (D-P4-5) — 집합이 없으면 검사하지 않는다", () => {
    const b = make();
    const doc = b.document("d", [
      b.article("준용규정", [b.paragraph([b.articleRef("g-art-1", "general"), b.articleRef("g-ghost", "general")])], {
        linkedArticleId: "g-ghost",
      }),
    ]);
    expect(validateTree(doc)).toEqual([]);
    const issues = validateTree(doc, { kind: "special", generalArticleIds: new Set(["g-art-1"]) });
    expect(kinds(issues)).toEqual(["brokenRef", "brokenRef"]);
    expect(issues.map((i) => i.at.nodePath)).toEqual([
      ["n5", "n4"],
      ["n5", "n4", "n3", "n2"],
    ]);
  });

  it("보통약관 문서의 조에는 조연결·보통약관 조 참조를 둘 수 없다 (D-P4-20 · D-P4-22)", () => {
    const b = make();
    const doc = b.document("g", [
      b.article("a", [b.paragraph([b.articleRef("x", "general")])], { linkedArticleId: "y" }),
    ]);
    expect(kinds(validateTree(doc, { kind: "general" }))).toEqual(["structure", "structure"]);
  });

  it("별표 참조는 별표 마스터 코드 존재로 검증한다", () => {
    const b = make();
    const doc = b.document("d", [b.article("a", [b.paragraph([b.appendixRef("APX_BURN"), b.appendixRef("APX_NO")])])]);
    const issues = validateTree(doc, { appendixExists: (c) => c === "APX_BURN" });
    expect(kinds(issues)).toEqual(["brokenRef"]);
    expect(issues[0].message).toContain("APX_NO");
  });
});

describe("문면작성 S5 — 공용조항 게이트 (ClauseGate 주입)", () => {
  const gate = {
    clauseExists: (code: string) => code === "C001",
    requiredCodes: () => ["D0001"],
    validateOptions: (code: string, options: Record<string, string>) =>
      options.tone === undefined
        ? [{ kind: "optionUnselected" as const, message: "옵션 tone 미선택", at: {} }]
        : [],
  };

  it("없는 공용조항 코드 → brokenRef · 옵션 미선택은 저장 검증에서 optionUnselected (ADR-0017)", () => {
    const b = make();
    const doc = b.document("d", [
      b.article("소멸", [b.clauseBlock("C001", {}), b.clauseBlock("C999", { tone: "a" })]),
      b.article("준용", [b.paragraph([b.clauseInline("C001", { tone: "a" })])]),
    ]);
    const issues = validateTree(doc, { clauseGate: gate });
    expect(kinds(issues)).toEqual(["optionUnselected", "brokenRef"]);
    expect(issues[0].at.nodePath).toEqual(["n7", "n3", "n1"]);
    expect(issues[0].at.articleTitle).toBe("소멸");
  });

  it("게이트가 없으면 공용조항 참조는 통과한다 (기본 통과)", () => {
    const b = make();
    const doc: DocumentNode = b.document("d", [b.article("소멸", [b.clauseBlock("C999", {})])]);
    expect(validateTree(doc)).toEqual([]);
  });
});
