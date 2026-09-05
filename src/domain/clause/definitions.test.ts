import { describe, expect, it } from "vitest";

import { formatClauseCode, type ClauseNextSeq } from "./codes";
import {
  addOption,
  addOptionValue,
  createClause,
  duplicateClause,
  removeOption,
  removeOptionValue,
  renameClause,
  renameOption,
  renameOptionValue,
  reorderOptions,
  reorderOptionValues,
  setBody,
  setClauseDescription,
  setMode,
  setOptionValueBody,
  type ClauseContext,
} from "./definitions";
import type { Block, Inline } from "./nodes";
import type { BlockClause, Clause, InlineClause } from "./types";

function memorySeq(): ClauseNextSeq {
  const counters = new Map<string, number>();
  return (kind, scope) => {
    const key = `${kind}:${scope}`;
    const n = (counters.get(key) ?? 0) + 1;
    counters.set(key, n);
    return n;
  };
}

function ctx(over: Partial<ClauseContext> = {}): ClauseContext {
  return { nextSeq: memorySeq(), existing: [], ...over };
}

function unwrap<T>(r: { ok: true; value: T } | { ok: false; rejection: unknown }): T {
  if (!r.ok) throw new Error(`기대: ok, 실제: ${JSON.stringify(r.rejection)}`);
  return r.value;
}

function reasonOf(r: { ok: true } | { ok: false; rejection: { reason: string } }): string {
  if (r.ok) throw new Error("기대: 거부, 실제: ok");
  return r.rejection.reason;
}

const 소멸_본문: Block[] = [
  { id: "p1", kind: "paragraph", children: [{ id: "t1", kind: "text", text: "이 특별약관은 피보험자가 사망한 경우 소멸합니다." }] },
  { id: "p2", kind: "paragraph", children: [{ id: "t2", kind: "text", text: "계약자적립액을 지급합니다." }] },
];

const 준용_본문: Block[] = [
  { id: "p1", kind: "paragraph", children: [
    { id: "t1", kind: "text", text: "이 특별약관에서 정하지 않은 사항은 " },
    { id: "c1", kind: "inlineCond", branches: [
      { id: "b1", when: "D0003 = 'V02'", children: [{ id: "t2", kind: "text", text: "최초계약일" }] },
      { id: "b2", children: [{ id: "t3", kind: "text", text: "계약일" }] },
    ] },
    { id: "t4", kind: "text", text: " 기준으로 보통약관을 따릅니다." },
  ] },
];

describe("코드 채번 — C0001 · O01 · V01", () => {
  it("공용조항 C + 4자리, 옵션 O + 2자리, 선택지 V + 2자리. 자리수를 넘으면 자연 확장", () => {
    expect(formatClauseCode("clause", 1)).toBe("C0001");
    expect(formatClauseCode("option", 3)).toBe("O03");
    expect(formatClauseCode("optionValue", 120)).toBe("V120");
    expect(() => formatClauseCode("clause", 0)).toThrow(RangeError);
  });
});

describe("공용조항 S1 — 정의와 요구 구분자 자동 추출", () => {
  it("block 「특별약관의 소멸」: 항 목록 본문으로 채번되고 (식이 없어) 요구 구분자는 빈 목록", async () => {
    const c = unwrap(await createClause({ label: "특별약관의 소멸", mode: "block", body: 소멸_본문 }, ctx()));
    expect(c).toEqual({
      code: "C0001",
      label: "특별약관의 소멸",
      mode: "block",
      description: "",
      body: 소멸_본문,
      options: [],
      required: { discriminators: [], attributes: [] },
    });
  });

  it("block 「준용규정」: 항 안 조건식이 읽는 구분자 D0003 이 요구 구분자에 나타난다", async () => {
    const c = unwrap(await createClause({ label: "준용규정", mode: "block", body: 준용_본문 }, ctx()));
    expect(c.required).toEqual({ discriminators: ["D0003"], attributes: [] });
  });

  it("inline 공용조항: 인라인 노드 열이 본문이다 · 본문 생략은 빈 본문", async () => {
    const body: Inline[] = [{ id: "t", kind: "text", text: "「보험금 지급사유」" }];
    const c = unwrap(await createClause({ label: "지급사유 문구", mode: "inline", body }, ctx()));
    expect(c.mode).toBe("inline");
    expect(c.body).toEqual(body);
    const empty = unwrap(await createClause({ label: "빈 것", mode: "block" }, ctx()));
    expect(empty.body).toEqual([]);
  });

  it("모드 미지정·잘못된 모드는 거부 · 빈 표시명 거부", async () => {
    const r = await createClause({ label: "x", mode: "row" as unknown as "inline" }, ctx());
    expect(reasonOf(r)).toBe("invalid");
    expect(reasonOf(await createClause({ label: "  ", mode: "inline" }, ctx()))).toBe("invalid");
  });

  it("표시명이 이미 있으면 duplicate (다른 공용조항과 표시명 중복 금지)", async () => {
    const c = ctx({ existing: [{ code: "C0001", label: "준용규정" }] });
    expect(reasonOf(await createClause({ label: "준용규정", mode: "block" }, c))).toBe("duplicate");
  });

  it("모드와 본문 모양이 어긋나면 거부 (inline 에 항, block 에 인라인)", async () => {
    const r1 = await createClause({ label: "a", mode: "inline", body: 소멸_본문 }, ctx());
    expect(reasonOf(r1)).toBe("invalid");
    const r2 = await createClause({ label: "b", mode: "block", body: [{ id: "t", kind: "text", text: "x" }] }, ctx());
    expect(reasonOf(r2)).toBe("invalid");
  });

  it("식 문법 오류가 있으면 저장 거부 (invalid)", async () => {
    const bad: Block[] = [{ id: "cb", kind: "condBlock", branches: [{ id: "b", when: "D0001 and", children: [] }] }];
    expect(reasonOf(await createClause({ label: "x", mode: "block", body: bad }, ctx()))).toBe("invalid");
  });

  it("옵션과 함께 생성하면 옵션 O01 · 선택지 V01·V02 가 채번되고 선택지 본문의 식도 요구 구분자에 든다", async () => {
    const c = unwrap(
      await createClause(
        {
          label: "소멸 사유",
          mode: "inline",
          body: [{ id: "o", kind: "optionSlot", optionCode: "O01" }],
          options: [
            { label: "사유", values: [
              { label: "사망형", body: [{ id: "a", kind: "text", text: "사망보험금 지급사유 발생" }] },
              { label: "일반형", body: [{ id: "b", kind: "slot", ref: "D0009" }] },
            ] },
          ],
        },
        ctx(),
      ),
    );
    expect(c.options).toEqual([
      { code: "O01", label: "사유", order: 0, values: [
        { code: "V01", label: "사망형", order: 0, body: [{ id: "a", kind: "text", text: "사망보험금 지급사유 발생" }] },
        { code: "V02", label: "일반형", order: 1, body: [{ id: "b", kind: "slot", ref: "D0009" }] },
      ] },
    ]);
    expect(c.required.discriminators).toEqual(["D0009"]);
  });

  it("본문이 정의에 없는 옵션 자리를 가리키면 거부", async () => {
    const r = await createClause({ label: "x", mode: "inline", body: [{ id: "o", kind: "optionSlot", optionCode: "O07" }] }, ctx());
    expect(reasonOf(r)).toBe("invalid");
  });
});

describe("공용조항 — 표시명 · 설명 · 본문 · 모드 수정", () => {
  let clause: BlockClause;
  const c = ctx();

  it("준비: 「준용규정」", async () => {
    clause = unwrap(await createClause({ label: "준용규정", mode: "block", body: 준용_본문 }, c)) as BlockClause;
  });

  it("표시명 변경은 코드 불변 · 중복 거부 · 빈 이름 거부", () => {
    const r = unwrap(renameClause(clause, "준용 규정", [{ code: "C0001", label: "준용규정" }, { code: "C0002", label: "소멸" }]));
    expect(r.code).toBe("C0001");
    expect(r.label).toBe("준용 규정");
    expect(reasonOf(renameClause(clause, "소멸", [{ code: "C0002", label: "소멸" }]))).toBe("duplicate");
    expect(reasonOf(renameClause(clause, "", []))).toBe("invalid");
    // 원본 불변
    expect(clause.label).toBe("준용규정");
  });

  it("설명 변경", () => {
    expect(unwrap(setClauseDescription(clause, "실물 10건 공통")).description).toBe("실물 10건 공통");
  });

  it("본문 수정 시 요구 구분자를 다시 계산한다 — 새 구분자를 읽으면 늘고, 참조를 빼면 준다", () => {
    const more: Block[] = [
      ...준용_본문,
      { id: "cb", kind: "condBlock", branches: [{ id: "b", when: "exist(D0010)", children: [] }] },
    ];
    const grown = unwrap(setBody(clause, more)) as BlockClause;
    expect(grown.required.discriminators).toEqual(["D0003", "D0010"]);
    const shrunk = unwrap(setBody(grown, 소멸_본문)) as BlockClause;
    expect(shrunk.required.discriminators).toEqual([]);
  });

  it("본문 수정도 모드와 어긋나면 거부", () => {
    expect(reasonOf(setBody(clause, [{ id: "t", kind: "text", text: "x" }] as Inline[]))).toBe("invalid");
  });

  it("모드 변경은 그 모드의 새 본문과 함께만 — 옵션·요구 구분자는 새 본문 기준으로 다시 계산", () => {
    const inlineBody: Inline[] = [{ id: "s", kind: "slot", ref: "D0020" }];
    const changed = unwrap(setMode(clause, "inline", inlineBody)) as InlineClause;
    expect(changed.mode).toBe("inline");
    expect(changed.body).toEqual(inlineBody);
    expect(changed.required.discriminators).toEqual(["D0020"]);
    // 같은 모드로의 변경은 본문만 교체
    expect(unwrap(setMode(clause, "block", 소멸_본문)).body).toEqual(소멸_본문);
    // 본문 모양이 새 모드와 안 맞으면 거부
    expect(reasonOf(setMode(clause, "inline", 소멸_본문))).toBe("invalid");
  });
});

describe("공용조항 옵션 — 추가 · 수정 · 삭제 · 순서 (D-P3-4 · D-P3-6 · D-P3-7)", () => {
  let clause: Clause;
  const c = ctx();

  it("준비: inline 공용조항", async () => {
    clause = unwrap(await createClause({ label: "소멸 사유", mode: "inline", body: [{ id: "t", kind: "text", text: "고정" }] }, c));
  });

  it("옵션 자리 추가 — 선택지 2개 미만이면 거부 (D-P3-4), 2개면 O01 + V01·V02 채번, 기본 선택지 없음", async () => {
    expect(reasonOf(await addOption(clause, { label: "x", values: [{ label: "하나" }] }, c))).toBe("invalid");
    clause = unwrap(await addOption(clause, { label: "사유", values: [{ label: "사망형" }, { label: "일반형", body: [{ id: "v2", kind: "slot", ref: "D0005" }] }] }, c));
    expect(clause.options).toEqual([
      { code: "O01", label: "사유", order: 0, values: [
        { code: "V01", label: "사망형", order: 0, body: [] },
        { code: "V02", label: "일반형", order: 1, body: [{ id: "v2", kind: "slot", ref: "D0005" }] },
      ] },
    ]);
    expect(clause.required.discriminators).toEqual(["D0005"]);
    expect("defaultValue" in clause.options[0]).toBe(false);
  });

  it("두 번째 옵션은 O02, 그 선택지는 다시 V01 부터 (옵션마다 순번)", async () => {
    clause = unwrap(await addOption(clause, { label: "지급물", values: [{ label: "적립액" }, { label: "미경과보험료" }] }, c));
    expect(clause.options[1].code).toBe("O02");
    expect(clause.options[1].values.map((v) => v.code)).toEqual(["V01", "V02"]);
  });

  it("선택지 추가 — 기존 선택은 유지되고 새 코드 V03 이 붙는다 · 선택지 본문 식은 요구 구분자에 든다", async () => {
    clause = unwrap(await addOptionValue(clause, "O01", { label: "혼합형", body: [{ id: "v3", kind: "slot", ref: "D0006.F01" }] }, c));
    expect(clause.options[0].values.map((v) => v.code)).toEqual(["V01", "V02", "V03"]);
    expect(clause.required.discriminators).toEqual(["D0005", "D0006"]);
    expect(reasonOf(await addOptionValue(clause, "O09", { label: "x" }, c))).toBe("notFound");
  });

  it("옵션·선택지 표시명 변경은 코드 불변", () => {
    clause = unwrap(renameOption(clause, "O01", "소멸 사유"));
    expect(clause.options[0].label).toBe("소멸 사유");
    clause = unwrap(renameOptionValue(clause, "O01", "V02", "일반 담보형"));
    expect(clause.options[0].values[1].label).toBe("일반 담보형");
    expect(reasonOf(renameOptionValue(clause, "O01", "V09", "x"))).toBe("notFound");
  });

  it("선택지 문구 수정 — 이 선택지를 고른 사용처 전부에 전파되는 마스터 문구. 요구 구분자 재계산", () => {
    clause = unwrap(setOptionValueBody(clause, "O01", "V01", [{ id: "v1", kind: "text", text: "사망보험금 지급사유 발생으로" }]));
    expect(clause.options[0].values[0].body[0]).toMatchObject({ kind: "text" });
    const bad = setOptionValueBody(clause, "O01", "V01", [{ id: "x", kind: "slot", ref: "D0001 =" }]);
    expect(reasonOf(bad)).toBe("invalid");
  });

  it("순서 변경 — 옵션·선택지 모두 코드 목록으로. 빠지거나 낯선 코드가 있으면 거부", () => {
    clause = unwrap(reorderOptions(clause, ["O02", "O01"]));
    expect(clause.options.map((o) => [o.code, o.order])).toEqual([["O02", 0], ["O01", 1]]);
    clause = unwrap(reorderOptionValues(clause, "O01", ["V03", "V01", "V02"]));
    expect(clause.options[1].values.map((v) => v.code)).toEqual(["V03", "V01", "V02"]);
    expect(reasonOf(reorderOptions(clause, ["O01"]))).toBe("invalid");
    expect(reasonOf(reorderOptionValues(clause, "O01", ["V01", "V02", "V03", "V09"]))).toBe("invalid");
  });

  it("선택지 삭제 — 2개 아래로 내려가면 minimumStructure 거부 (D-P3-4). 요구 구분자 재계산", () => {
    clause = unwrap(removeOptionValue(clause, "O01", "V03"));
    expect(clause.options[1].values.map((v) => v.code)).toEqual(["V01", "V02"]);
    expect(clause.required.discriminators).toEqual(["D0005"]);
    // O02 는 선택지가 정확히 2개 — 하나를 빼면 1개가 되므로 거부
    expect(reasonOf(removeOptionValue(clause, "O02", "V01"))).toBe("minimumStructure");
    expect(reasonOf(removeOptionValue(clause, "O02", "V09"))).toBe("notFound");
  });

  it("옵션 자리 삭제 — 본문이 아직 그 자리를 쓰면 거부, 안 쓰면 제거 + 요구 구분자 재계산", () => {
    const using = unwrap(setBody(clause, [{ id: "o", kind: "optionSlot", optionCode: "O01" }]));
    expect(reasonOf(removeOption(using, "O01"))).toBe("invalid");
    const removed = unwrap(removeOption(clause, "O01"));
    expect(removed.options.map((o) => o.code)).toEqual(["O02"]);
    expect(removed.required.discriminators).toEqual([]);
    expect(reasonOf(removeOption(clause, "O09"))).toBe("notFound");
  });
});

describe("공용조항 복제 (D-P3-3)", () => {
  it("본문·옵션을 복사한 새 정의 — 새 코드, 표시명 「(복제)」 접미, 이미 있으면 「(복제2)」", async () => {
    const c = ctx();
    const origin = unwrap(await createClause({ label: "특별약관의 소멸", mode: "block", body: 소멸_본문, options: [
      { label: "사유", values: [{ label: "a" }, { label: "b" }] },
    ] }, c));
    const copy = unwrap(await duplicateClause(origin, { ...c, existing: [{ code: "C0001", label: "특별약관의 소멸" }] }));
    expect(copy.code).toBe("C0002");
    expect(copy.label).toBe("특별약관의 소멸(복제)");
    expect(copy.body).toEqual(origin.body);
    expect(copy.body).not.toBe(origin.body);
    expect(copy.options).toEqual(origin.options);
    expect(copy.required).toEqual(origin.required);

    const again = unwrap(
      await duplicateClause(origin, {
        ...c,
        existing: [{ code: "C0001", label: "특별약관의 소멸" }, { code: "C0002", label: "특별약관의 소멸(복제)" }],
      }),
    );
    expect(again.label).toBe("특별약관의 소멸(복제2)");
  });
});
