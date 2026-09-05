import { describe, expect, it } from "vitest";

import { analyzeBody, collectExpressions, allNodeIds } from "./body";
import type { Block, Inline } from "./nodes";
import type { OptionDef } from "./types";

function unwrap<T>(r: { ok: true; value: T } | { ok: false; rejection: unknown }): T {
  if (!r.ok) throw new Error(`기대: ok, 실제: ${JSON.stringify(r.rejection)}`);
  return r.value;
}

function issuesOf(r: { ok: true } | { ok: false; rejection: { reason: string; issues?: { kind: string; message: string }[] } }) {
  if (r.ok) throw new Error("기대: 거부, 실제: ok");
  expect(r.rejection.reason).toBe("invalid");
  return r.rejection.issues ?? [];
}

const 옵션: OptionDef[] = [
  {
    code: "O01",
    label: "소멸 사유",
    order: 0,
    values: [
      { code: "V01", label: "사망형", order: 0, body: [{ id: "v1t", kind: "text", text: "사망보험금 지급사유 발생" }] },
      { code: "V02", label: "일반형", order: 1, body: [{ id: "v2t", kind: "text", text: "피보험자 사망" }] },
    ],
  },
];

describe("공용조항 S1 — 본문 노드 규칙 (inline)", () => {
  it("텍스트·슬롯·인라인 조건·조 참조·별표 참조·옵션 자리로 된 inline 본문은 통과한다", () => {
    const body: Inline[] = [
      { id: "t1", kind: "text", text: "이 특별약관은 " },
      { id: "c1", kind: "inlineCond", branches: [
        { id: "b1", when: "attr.A0001 = 'V02'", children: [{ id: "t2", kind: "text", text: "최초계약일" }] },
        { id: "b2", children: [{ id: "t3", kind: "text", text: "계약일" }] },
      ] },
      { id: "s1", kind: "slot", ref: "D0001" },
      { id: "a1", kind: "articleRef", articleId: "art-1" },
      { id: "x1", kind: "appendixRef", appendixCode: "X0001" },
      { id: "o1", kind: "optionSlot", optionCode: "O01" },
    ];
    expect(unwrap(analyzeBody("inline", body, 옵션))).toEqual({ discriminators: ["D0001"], attributes: ["A0001"] });
  });

  it("inline 본문에 항(paragraph)이 오면 거부한다 — 항·조 노드는 inline 에 없다", () => {
    const body = [{ id: "p1", kind: "paragraph", children: [] }] as unknown as Inline[];
    const issues = issuesOf(analyzeBody("inline", body, []));
    expect(issues[0]?.kind).toBe("typeMismatch");
  });

  it("공용조항 안의 공용조항 참조(clauseInlineRef)는 거부한다 — 중첩 금지(MVP)", () => {
    const body = [{ id: "r1", kind: "clauseInlineRef", clauseCode: "C0002" }] as unknown as Inline[];
    const issues = issuesOf(analyzeBody("inline", body, []));
    expect(issues[0]?.kind).toBe("typeMismatch");
    expect(issues[0]?.message).toContain("중첩");
  });

  it("인라인 조건 안에 다시 인라인 조건을 두면 거부한다 — 인라인 중첩 금지", () => {
    const body: Inline[] = [
      { id: "c1", kind: "inlineCond", branches: [
        { id: "b1", when: "D0001", children: [
          { id: "c2", kind: "inlineCond", branches: [{ id: "b2", children: [] }] },
        ] },
      ] },
    ];
    const issues = issuesOf(analyzeBody("inline", body, []));
    expect(issues.map((i) => i.kind)).toEqual(["typeMismatch"]);
  });

  it("else 가지는 마지막에만 올 수 있고, 가지가 없는 조건은 거부한다", () => {
    const elseFirst: Inline[] = [
      { id: "c1", kind: "inlineCond", branches: [
        { id: "b1", children: [] },
        { id: "b2", when: "D0001", children: [] },
      ] },
    ];
    expect(issuesOf(analyzeBody("inline", elseFirst, [])).length).toBe(1);
    const empty: Inline[] = [{ id: "c1", kind: "inlineCond", branches: [] }];
    expect(issuesOf(analyzeBody("inline", empty, [])).length).toBe(1);
  });

  it("식 문법 오류는 저장 거부(invalid · syntax) — 좌표에 노드 경로가 실린다", () => {
    const body: Inline[] = [
      { id: "c1", kind: "inlineCond", branches: [{ id: "b1", when: "D0001 = ", children: [] }] },
      { id: "s1", kind: "slot", ref: "D0001." },
    ];
    const r = analyzeBody("inline", body, []);
    const issues = issuesOf(r);
    expect(issues.map((i) => i.kind)).toEqual(["syntax", "syntax"]);
    if (!r.ok && r.rejection.reason === "invalid") {
      expect(r.rejection.issues[0].at.nodePath).toEqual(["c1", "b1"]);
      expect(r.rejection.issues[1].at.nodePath).toEqual(["s1"]);
    }
  });

  it("슬롯 ref 는 참조 하나여야 한다 — 비교식·리터럴은 거부", () => {
    const body: Inline[] = [{ id: "s1", kind: "slot", ref: "D0001 = true" }];
    expect(issuesOf(analyzeBody("inline", body, []))[0]?.kind).toBe("typeMismatch");
  });

  it("정의에 없는 옵션을 가리키는 옵션 자리는 거부한다 (brokenRef)", () => {
    const body: Inline[] = [{ id: "o1", kind: "optionSlot", optionCode: "O09" }];
    expect(issuesOf(analyzeBody("inline", body, 옵션))[0]?.kind).toBe("brokenRef");
  });

  it("노드 id 는 본문과 선택지 본문을 통틀어 유일해야 한다", () => {
    const body: Inline[] = [{ id: "v1t", kind: "text", text: "중복 id" }];
    const issues = issuesOf(analyzeBody("inline", body, 옵션));
    expect(issues[0]?.message).toContain("v1t");
  });

  it("요구 구분자는 선택지 본문의 식에서도 추출된다 — 구조체 필드는 구분자 코드로 합친다", () => {
    const opts: OptionDef[] = [
      { code: "O01", label: "x", order: 0, values: [
        { code: "V01", label: "a", order: 0, body: [{ id: "a", kind: "slot", ref: "D0002.F01" }] },
        { code: "V02", label: "b", order: 1, body: [{ id: "b", kind: "slot", ref: "D0002.F02" }] },
      ] },
    ];
    const body: Inline[] = [{ id: "o", kind: "optionSlot", optionCode: "O01" }];
    expect(unwrap(analyzeBody("inline", body, opts))).toEqual({ discriminators: ["D0002"], attributes: [] });
  });

  it("식이 없는 본문의 요구 구분자는 빈 목록이다", () => {
    const body: Inline[] = [{ id: "t", kind: "text", text: "고정 문구" }];
    expect(unwrap(analyzeBody("inline", body, []))).toEqual({ discriminators: [], attributes: [] });
  });
});

describe("공용조항 S1 — 본문 노드 규칙 (block)", () => {
  const 준용규정: Block[] = [
    { id: "p1", kind: "paragraph", children: [{ id: "t1", kind: "text", text: "이 특별약관에서 정하지 않은 사항은 보통약관을 따릅니다." }] },
    { id: "cb", kind: "condBlock", branches: [
      { id: "cb1", when: "D0003 = 'V02'", children: [
        { id: "p2", kind: "paragraph", children: [{ id: "t2", kind: "text", text: "최초계약일 기준 문구" }],
          items: [{ id: "i1", kind: "item", children: [{ id: "t3", kind: "text", text: "호" }],
            subitems: [{ id: "si1", kind: "subitem", children: [{ id: "t4", kind: "text", text: "목" }] }] }] },
        { id: "cb-in", kind: "condBlock", branches: [{ id: "cb-in-1", when: "any(D0004.F01)", children: [] }] },
      ] },
      { id: "cb2", children: [] },
    ] },
  ];

  it("항 목록 + 조건 블록(중첩 허용) + 호·목 으로 된 block 본문은 통과하고 요구 구분자가 추출된다", () => {
    expect(unwrap(analyzeBody("block", 준용규정, []))).toEqual({ discriminators: ["D0003", "D0004"], attributes: [] });
  });

  it("block 본문에 조(article) 노드가 오면 거부한다 — 조는 항상 사용처 소유", () => {
    const body = [{ id: "a1", kind: "article", title: "준용규정", children: [] }] as unknown as Block[];
    const issues = issuesOf(analyzeBody("block", body, []));
    expect(issues[0]?.kind).toBe("typeMismatch");
  });

  it("block 본문에 인라인 노드가 직접 오면 거부한다", () => {
    const body = [{ id: "t1", kind: "text", text: "x" }] as unknown as Block[];
    expect(issuesOf(analyzeBody("block", body, [])).length).toBe(1);
  });

  it("공용조항 block 참조(clauseBlockRef)는 거부한다 — 중첩 금지(MVP)", () => {
    const body = [{ id: "r1", kind: "clauseBlockRef", clauseCode: "C0002" }] as unknown as Block[];
    expect(issuesOf(analyzeBody("block", body, []))[0]?.message).toContain("중첩");
  });

  it("식 수집: 모든 slot ref · when 을 노드 경로와 함께 돌려준다", () => {
    const exprs = collectExpressions(준용규정);
    expect(exprs.map((e) => [e.source, e.nodePath.join("/")])).toEqual([
      ["D0003 = 'V02'", "cb/cb1"],
      ["any(D0004.F01)", "cb/cb1/cb-in/cb-in-1"],
    ]);
  });

  it("id 수집: 본문의 모든 노드 id (가지 포함)", () => {
    expect(allNodeIds(준용규정)).toEqual(["p1", "t1", "cb", "cb1", "p2", "t2", "i1", "t3", "si1", "t4", "cb-in", "cb-in-1", "cb2"]);
  });
});
