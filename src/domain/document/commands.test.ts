import { describe, expect, it } from "vitest";

import type { Result } from "../types";
import { nodeBuilders, sequentialIds } from "./builders";
import { applyCommand, applyCommands, cloneTree, type Command } from "./commands";
import { indexTree, type ArticleNode, type CondBlockNode, type DocumentNode, type ParagraphNode } from "./nodes";

function make() {
  return nodeBuilders(sequentialIds("n"));
}

function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`기대: ok, 실제: ${JSON.stringify(r.rejection)}`);
  return r.value;
}

function rejection<T>(r: Result<T>) {
  if (r.ok) throw new Error("기대: 거부, 실제: ok");
  return r.rejection;
}

/**
 * 제1조(항 1개) + 제2조(빈 조) 인 문서. 빌더는 자식을 먼저 만들므로 id 는 후위 순:
 * text n1 · paragraph n2 · article「보험금의 지급사유」 n3 · article「보험기간」 n4 · document n5. 이후 빌더 호출은 n6 부터.
 */
function twoArticles() {
  const b = make();
  const doc = b.document("수술비", [b.article("보험금의 지급사유", [b.paragraph([b.text("회사는 ")])]), b.article("보험기간", [])]);
  return { b, doc };
}

describe("문면작성 S1 — 조·항·호·목 추가 (insert)", () => {
  it("조 블록 추가 → 문서 끝에 붙고, 원본 트리는 바뀌지 않는다 (불변 갱신)", () => {
    const { b, doc } = twoArticles();
    const before = JSON.stringify(doc);
    const next = unwrap(applyCommand(doc, { type: "insert", node: b.article("새 조", []), at: { parentId: "n5" } }));
    expect(next.children.map((c) => c.id)).toEqual(["n3", "n4", "n6"]);
    expect(JSON.stringify(doc)).toBe(before);
  });

  it("index 를 주면 그 자리에 끼어든다 — 이후 조의 번호가 밀리는 근거", () => {
    const { b, doc } = twoArticles();
    const next = unwrap(applyCommand(doc, { type: "insert", node: b.article("앞", []), at: { parentId: "n5", index: 0 } }));
    expect(next.children.map((c) => c.id)).toEqual(["n6", "n3", "n4"]);
  });

  it("항 아래 호 · 호 아래 목은 items / subitems 자리에 추가한다", () => {
    const { b, doc } = twoArticles();
    const next = unwrap(
      applyCommands(doc, [
        { type: "insert", node: b.item([b.text("1호")]), at: { parentId: "n2", slot: "items" } }, // text n6 · item n7
        { type: "insert", node: b.subitem([b.text("가목")]), at: { parentId: "n7", slot: "subitems" } }, // text n8 · subitem n9
      ]),
    );
    const p = indexTree(next).nodes.get("n2")!.node as ParagraphNode;
    expect(p.items?.map((i) => i.id)).toEqual(["n7"]);
    expect((p.items![0] as { subitems?: { id: string }[] }).subitems?.map((s) => s.id)).toEqual(["n9"]);
  });

  it("허용 자식 위반(문서 아래 항) → invalid/structure 거부, 트리 불변", () => {
    const { b, doc } = twoArticles();
    const r = applyCommand(doc, { type: "insert", node: b.paragraph([]), at: { parentId: "n5" } });
    const rej = rejection(r);
    expect(rej.reason).toBe("invalid");
    if (rej.reason === "invalid") expect(rej.issues[0].kind).toBe("structure");
  });

  it("없는 부모 → notFound · 그 종류에 없는 자리(items 를 조에) → invalid", () => {
    const { b, doc } = twoArticles();
    expect(rejection(applyCommand(doc, { type: "insert", node: b.article("x", []), at: { parentId: "zz" } })).reason).toBe("notFound");
    expect(rejection(applyCommand(doc, { type: "insert", node: b.item([]), at: { parentId: "n3", slot: "items" } })).reason).toBe("invalid");
  });

  it("이미 있는 id 를 가진 노드는 못 넣는다 (id 유일)", () => {
    const { doc } = twoArticles();
    const r = applyCommand(doc, { type: "insert", node: { id: "n4", kind: "article", title: "dup", children: [] }, at: { parentId: "n5" } });
    expect(rejection(r).reason).toBe("invalid");
  });
});

describe("문면작성 S2 — 인라인 조건 삽입", () => {
  it("문장 안에 인라인 조건 칩 삽입 — 참/else 가지 텍스트가 저장된다", () => {
    const { b, doc } = twoArticles();
    const chip = b.inlineCond([b.inlineBranch("D0001 = true", [b.text("최초계약일")]), b.inlineBranch(undefined, [b.text("계약일")])]);
    const next = unwrap(applyCommand(doc, { type: "insert", node: chip, at: { parentId: "n2", index: 1 } }));
    const p = next.children[0] as ArticleNode;
    expect((p.children[0] as ParagraphNode).children.map((c) => c.kind)).toEqual(["text", "inlineCond"]);
    expect(next).toMatchSnapshot();
  });

  it("인라인 조건 안에 다시 인라인 조건 → 거부 (중첩 금지)", () => {
    const { b, doc } = twoArticles();
    const chip = b.inlineCond([b.inlineBranch("D0001", [b.text("a")])]);
    const withChip = unwrap(applyCommand(doc, { type: "insert", node: chip, at: { parentId: "n2" } }));
    const branchId = chip.branches[0].id;
    const inner = b.inlineCond([b.inlineBranch("D0001", [b.text("b")])]);
    const r = applyCommand(withChip, { type: "insert", node: inner, at: { parentId: branchId } });
    const rej = rejection(r);
    expect(rej.reason).toBe("invalid");
    if (rej.reason === "invalid") expect(rej.issues[0].message).toContain("인라인 조건");
  });
});

describe("문면작성 S3 — 조 자리의 조건 블록과 가지 편집", () => {
  it("조 자리에 조건 블록(if) 추가 후 가지 안에 조 작성 · elif · else 추가", () => {
    const { b, doc } = twoArticles();
    const cond = b.condBlock([b.branch("D0001 = true", [])]); // 가지 n6 · 블록 n7
    const steps: Command[] = [
      { type: "insert", node: cond, at: { parentId: "n5", index: 1 } },
      { type: "insert", node: b.article("보험기간(갱신형)", []), at: { parentId: "n6" } }, // n8
      { type: "addBranch", condId: "n7", branch: b.branch("D0002 = 'V01'", []) }, // n9
      { type: "addBranch", condId: "n7", branch: b.branch(undefined, [b.article("그 외", [])]) }, // article n10 · 가지 n11
    ];
    const next = unwrap(applyCommands(doc, steps));
    const c = next.children[1] as CondBlockNode;
    expect(c.branches.map((br) => [br.id, br.when])).toEqual([
      ["n6", "D0001 = true"],
      ["n9", "D0002 = 'V01'"],
      ["n11", undefined],
    ]);
    expect(next).toMatchSnapshot();
  });

  it("else 뒤에 가지 추가 · else 를 마지막 밖으로 이동 · 이중 else → 거부 (D-P4-11)", () => {
    const { b, doc } = twoArticles();
    const cond = b.condBlock([b.branch("D0001", []), b.branch(undefined, [])]); // 가지 n6 n7 · 블록 n8
    const base = unwrap(applyCommand(doc, { type: "insert", node: cond, at: { parentId: "n5" } }));
    expect(rejection(applyCommand(base, { type: "addBranch", condId: "n8", branch: b.branch("D0002 = 'V01'", []) })).reason).toBe("invalid");
    expect(rejection(applyCommand(base, { type: "addBranch", condId: "n8", branch: b.branch(undefined, []) })).reason).toBe("invalid");
    expect(rejection(applyCommand(base, { type: "moveBranch", branchId: "n7", index: 0 })).reason).toBe("invalid");
    // elif 는 else 앞에 끼어들 수 있다
    const ok = unwrap(applyCommand(base, { type: "addBranch", condId: "n8", branch: b.branch("D0002 = 'V01'", []), index: 1 }));
    expect((ok.children[2] as CondBlockNode).branches.map((br) => br.when)).toEqual(["D0001", "D0002 = 'V01'", undefined]);
  });

  it("조건식 수정(setWhen) — else 로 바꾸면 마지막 가지여야 한다", () => {
    const { b, doc } = twoArticles();
    const cond = b.condBlock([b.branch("D0001", []), b.branch("D0002 = 'V01'", [])]); // 가지 n6 n7 · 블록 n8
    const base = unwrap(applyCommand(doc, { type: "insert", node: cond, at: { parentId: "n5" } }));
    const changed = unwrap(applyCommand(base, { type: "setWhen", branchId: "n6", when: "D0001 = false" }));
    expect((changed.children[2] as CondBlockNode).branches[0].when).toBe("D0001 = false");
    expect(rejection(applyCommand(base, { type: "setWhen", branchId: "n6", when: undefined })).reason).toBe("invalid");
    expect((unwrap(applyCommand(base, { type: "setWhen", branchId: "n7", when: undefined })).children[2] as CondBlockNode).branches[1].when).toBeUndefined();
  });

  it("가지 삭제 — 마지막 남은 가지는 삭제 불가 (D-P4-12), 가지 순서 변경은 평가 순서 변경", () => {
    const { b, doc } = twoArticles();
    const cond = b.condBlock([b.branch("D0001", []), b.branch("D0002 = 'V01'", []), b.branch("D0002 = 'V02'", [])]); // 가지 n6 n7 n8 · 블록 n9
    const base = unwrap(applyCommand(doc, { type: "insert", node: cond, at: { parentId: "n5" } }));
    const moved = unwrap(applyCommand(base, { type: "moveBranch", branchId: "n8", index: 0 }));
    expect((moved.children[2] as CondBlockNode).branches.map((br) => br.id)).toEqual(["n8", "n6", "n7"]);
    let cur = unwrap(applyCommand(moved, { type: "removeBranch", branchId: "n6" }));
    cur = unwrap(applyCommand(cur, { type: "removeBranch", branchId: "n7" }));
    expect((cur.children[2] as CondBlockNode).branches.map((br) => br.id)).toEqual(["n8"]);
    const rej = rejection(applyCommand(cur, { type: "removeBranch", branchId: "n8" }));
    expect(rej.reason).toBe("minimumStructure");
  });
});

describe("문면작성 S1-6 — 이동 (형제 순서 · 부모 변경)", () => {
  it("조를 다른 조 앞으로 이동 → 순서가 바뀐다 (같은 목록 안 index 는 뺀 뒤 기준)", () => {
    const { doc } = twoArticles();
    const next = unwrap(applyCommand(doc, { type: "move", nodeId: "n4", to: { parentId: "n5", index: 0 } }));
    expect(next.children.map((c) => c.id)).toEqual(["n4", "n3"]);
  });

  it("다른 부모로 이동 — 항을 다른 조로 · 규칙 위반 자리로는 못 옮긴다 · 자기 하위로의 이동(순환)은 거부", () => {
    const { doc } = twoArticles();
    const moved = unwrap(applyCommand(doc, { type: "move", nodeId: "n2", to: { parentId: "n4" } }));
    expect((moved.children[0] as ArticleNode).children).toEqual([]);
    expect((moved.children[1] as ArticleNode).children.map((c) => c.id)).toEqual(["n2"]);
    expect(rejection(applyCommand(doc, { type: "move", nodeId: "n2", to: { parentId: "n5" } })).reason).toBe("invalid");
    expect(rejection(applyCommand(doc, { type: "move", nodeId: "n3", to: { parentId: "n2" } })).reason).toBe("invalid");
    expect(rejection(applyCommand(doc, { type: "move", nodeId: "n5", to: { parentId: "n3" } })).reason).toBe("invalid");
  });
});

describe("노드 삭제 — 참조되는 조는 삭제 거부 (D-P4-7 · 참조 무결성)", () => {
  it("하위 트리째 삭제되고 이후 노드는 그대로", () => {
    const { doc } = twoArticles();
    const next = unwrap(applyCommand(doc, { type: "remove", nodeId: "n3" }));
    expect(next.children.map((c) => c.id)).toEqual(["n4"]);
    expect(indexTree(next).nodes.has("n1")).toBe(false);
  });

  it("다른 곳의 조 참조 슬롯이 가리키는 조는 삭제 거부 — 참조처 좌표 제시. 같이 지워지는 참조는 무관", () => {
    const { b, doc } = twoArticles();
    const withRef = unwrap(
      applyCommands(doc, [
        { type: "insert", node: b.paragraph([b.articleRef("n4", "self")]), at: { parentId: "n3" } }, // ref n6 · paragraph n7
        { type: "insert", node: b.paragraph([b.articleRef("n3", "self")]), at: { parentId: "n3" } }, // ref n8 · paragraph n9 (자기 조 안)
      ]),
    );
    const rej = rejection(applyCommand(withRef, { type: "remove", nodeId: "n4" }));
    expect(rej.reason).toBe("invalid");
    if (rej.reason === "invalid") {
      expect(rej.issues[0].kind).toBe("brokenRef");
      expect(rej.issues[0].at.nodePath).toEqual(["n5", "n3", "n7", "n6"]);
    }
    // n3 을 지우면 n3 을 가리키는 n8 도 같이 사라지므로 허용
    expect(applyCommand(withRef, { type: "remove", nodeId: "n3" }).ok).toBe(true);
    expect(rejection(applyCommand(withRef, { type: "remove", nodeId: "n5" })).reason).toBe("invalid");
  });
});

describe("텍스트 · 조 명 · 슬롯 · 참조 대상 · 옵션 수정", () => {
  it("텍스트런 편집 · 조 명 수정 · 문서 제목 수정", () => {
    const { doc } = twoArticles();
    const next = unwrap(
      applyCommands(doc, [
        { type: "setText", nodeId: "n1", text: "회사는 피보험자가 " },
        { type: "setTitle", nodeId: "n3", title: "보험금의 지급사유(개정)" },
        { type: "setTitle", nodeId: "n5", title: "수술비 특별약관" },
      ]),
    );
    expect(next.title).toBe("수술비 특별약관");
    expect((next.children[0] as ArticleNode).title).toBe("보험금의 지급사유(개정)");
    expect(((next.children[0] as ArticleNode).children[0] as ParagraphNode).children[0]).toMatchObject({ text: "회사는 피보험자가 " });
    expect(rejection(applyCommand(doc, { type: "setText", nodeId: "n3", text: "x" })).reason).toBe("invalid");
    expect(rejection(applyCommand(doc, { type: "setTitle", nodeId: "n2", title: "x" })).reason).toBe("invalid");
  });

  it("슬롯 참조 대상 변경 · 별표 코드 변경 · 조 참조 대상 변경 (삽입과 같은 검증)", () => {
    const { b, doc } = twoArticles();
    const base = unwrap(
      applyCommand(doc, {
        type: "insert",
        node: b.paragraph([b.slot("D0004"), b.appendixRef("APX_A"), b.articleRef("n4", "self")]), // slot n6 · apx n7 · ref n8 · paragraph n9
        at: { parentId: "n3" },
      }),
    );
    const env = { appendixExists: (c: string) => c === "APX_B" };
    const next = unwrap(
      applyCommands(
        base,
        [
          { type: "setSlotRef", nodeId: "n6", ref: "D0003.F02" },
          { type: "setAppendixRef", nodeId: "n7", appendixCode: "APX_B" },
          { type: "setArticleRef", nodeId: "n8", articleId: "n3", scope: "self" },
        ],
        { env },
      ),
    );
    const p = (next.children[0] as ArticleNode).children[1] as ParagraphNode;
    expect(p.children).toMatchObject([{ ref: "D0003.F02" }, { appendixCode: "APX_B" }, { articleId: "n3" }]);
    expect(rejection(applyCommand(base, { type: "setAppendixRef", nodeId: "n7", appendixCode: "APX_X" }, { env })).reason).toBe("invalid");
    expect(rejection(applyCommand(base, { type: "setArticleRef", nodeId: "n8", articleId: "ghost", scope: "self" })).reason).toBe("invalid");
  });

  it("공용조항 참조 — 게이트가 코드를 모르면 삽입 실패 · 옵션 미선택은 삽입 시 통과(ADR-0017) · 옵션 변경", () => {
    const { b, doc } = twoArticles();
    const gate = {
      clauseExists: (c: string) => c === "C001",
      requiredCodes: () => [],
      validateOptions: (_c: string, o: Record<string, string>) =>
        o.tone === undefined ? [{ kind: "optionUnselected" as const, message: "미선택", at: {} }] : [],
    };
    const env = { clauseGate: gate };
    expect(rejection(applyCommand(doc, { type: "insert", node: b.clauseBlock("C999", {}), at: { parentId: "n3" } }, { env })).reason).toBe("invalid"); // n6
    const next = unwrap(applyCommand(doc, { type: "insert", node: b.clauseBlock("C001", {}), at: { parentId: "n3" } }, { env })); // n7
    const opt = unwrap(applyCommand(next, { type: "setClauseOptions", nodeId: "n7", options: { tone: "a" } }, { env }));
    expect((opt.children[0] as ArticleNode).children[1]).toMatchObject({ clauseCode: "C001", options: { tone: "a" } });
  });

  it("반복 노드 속성(소스·별칭·구분 문자열) 은 자리만 저장한다 (P7)", () => {
    const { b, doc } = twoArticles();
    const base = unwrap(
      applyCommand(doc, { type: "insert", node: b.inlineFor("subCoverage", [b.slot("builtin.subCoverage.name")]), at: { parentId: "n2" } }), // slot n6 · for n7
    );
    const next = unwrap(applyCommand(base, { type: "setFor", nodeId: "n7", alias: "sc", separator: ", " }));
    expect(((next.children[0] as ArticleNode).children[0] as ParagraphNode).children[1]).toMatchObject({ source: "subCoverage", alias: "sc", separator: ", " });
  });
});

describe("문면작성 S6 — 조연결", () => {
  it("조에 보통약관 조 id 를 저장 · 해제 · 대상 집합 밖이면 거부 · 보통약관 문서에는 불가", () => {
    const { doc } = twoArticles();
    const env = { kind: "special" as const, generalArticleIds: new Set(["g1", "g2"]) };
    const linked = unwrap(applyCommand(doc, { type: "link", articleId: "n3", linkedArticleId: "g1" }, { env }));
    expect((linked.children[0] as ArticleNode).linkedArticleId).toBe("g1");
    const unlinked = unwrap(applyCommand(linked, { type: "link", articleId: "n3", linkedArticleId: undefined }, { env }));
    expect((unlinked.children[0] as ArticleNode).linkedArticleId).toBeUndefined();
    expect(rejection(applyCommand(doc, { type: "link", articleId: "n3", linkedArticleId: "g9" }, { env })).reason).toBe("invalid");
    expect(rejection(applyCommand(doc, { type: "link", articleId: "n3", linkedArticleId: "g1" }, { env: { kind: "general" } })).reason).toBe("invalid");
    expect(rejection(applyCommand(doc, { type: "link", articleId: "n2", linkedArticleId: "g1" }, { env })).reason).toBe("invalid");
  });
});

describe("복제 (D-P4-9) — 하위 트리·조연결·참조 대상 id 를 그대로, 노드 id 는 새로", () => {
  it("조 복제 → 바로 뒤에 사본, 사본 안의 자기 조 참조는 사본을 가리킨다", () => {
    const { b, doc } = twoArticles();
    const base = unwrap(
      applyCommands(doc, [
        { type: "link", articleId: "n3", linkedArticleId: "g1" },
        { type: "insert", node: b.paragraph([b.articleRef("n3", "self"), b.articleRef("n4", "self")]), at: { parentId: "n3" } }, // ref n6 n7 · paragraph n8
      ]),
    );
    const next = unwrap(applyCommand(base, { type: "duplicate", nodeId: "n3" }, { newId: sequentialIds("c") }));
    expect(next.children.map((c) => c.id)).toEqual(["n3", "c1", "n4"]);
    const copy = next.children[1] as ArticleNode;
    expect(copy.linkedArticleId).toBe("g1");
    const refs = (copy.children[1] as ParagraphNode).children as { articleId: string }[];
    expect(refs.map((r) => r.articleId)).toEqual(["c1", "n4"]);
    expect(next).toMatchSnapshot();
  });
});

describe("문서 복제 (D-P4-4) — cloneTree", () => {
  it("모든 노드·가지 id 가 새로 매겨지고 내부 조 참조는 따라간다, 보통약관 참조·조연결은 그대로", () => {
    const b = make();
    const doc: DocumentNode = b.document("원본", [
      b.article("a", [b.paragraph([b.articleRef("n4", "self"), b.articleRef("g1", "general")])], { linkedArticleId: "g1" }), // ref n1 n2 · paragraph n3 · article n4
      b.condBlock([b.branch("D0001", [b.article("b", [])])]),
    ]);
    const copy = cloneTree(doc, sequentialIds("c"), "사본");
    expect(copy.title).toBe("사본");
    const ids = [...indexTree(copy).nodes.keys(), ...indexTree(copy).branches.keys()];
    expect(ids.every((id) => id.startsWith("c"))).toBe(true);
    const a = copy.children[0] as ArticleNode;
    expect((a.children[0] as ParagraphNode).children).toMatchObject([{ articleId: a.id }, { articleId: "g1" }]);
    expect(a.linkedArticleId).toBe("g1");
  });
});
