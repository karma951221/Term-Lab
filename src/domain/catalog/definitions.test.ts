import { describe, expect, it } from "vitest";

import type { NextSeq } from "./codes";
import {
  addEnumValue,
  addField,
  changeFieldType,
  changeScalarType,
  createDiscriminator,
  createEnum,
  isAliasExpression,
  removeEnumValue,
  removeField,
  renameDiscriminator,
  renameEnumValue,
  renameField,
  reorderFields,
  setConstValue,
  setDefaultValue,
  setExpression,
  setFieldDefaultValue,
  type CatalogContext,
} from "./definitions";
import type {
  ConstDiscriminator,
  DerivedDiscriminator,
  EnumDef,
  NewDiscriminator,
  ScalarDiscriminator,
  StructDiscriminator,
} from "./types";

/** 테스트용 순번 소스 — (kind, scope) 마다 1 부터. */
function memorySeq(): NextSeq {
  const counters = new Map<string, number>();
  return (kind, scope) => {
    const key = `${kind}:${scope}`;
    const n = (counters.get(key) ?? 0) + 1;
    counters.set(key, n);
    return n;
  };
}

const 고지유형: EnumDef = {
  code: "E0001",
  label: "고지유형",
  values: [
    { code: "V01", label: "일반심사", order: 0 },
    { code: "V02", label: "간편심사", order: 1 },
  ],
};

function ctx(over: Partial<CatalogContext> = {}): CatalogContext {
  return {
    nextSeq: memorySeq(),
    existing: [],
    findEnum: (c) => (c === "E0001" ? 고지유형 : undefined),
    ...over,
  };
}

function unwrap<T>(r: { ok: true; value: T } | { ok: false; rejection: unknown }): T {
  if (!r.ok) throw new Error(`기대: ok, 실제: ${JSON.stringify(r.rejection)}`);
  return r.value;
}

describe("구분자정의 S1 — 구분자 채번: 코드 불변 + 표시명 가변", () => {
  it("표시명·타입·부착 레벨·노출여부만 넣으면 코드는 시스템이 D0001 부터 채번한다", async () => {
    const c = ctx();
    const def = unwrap(
      await createDiscriminator(
        { kind: "scalar", label: "갱신여부", level: "coverage", type: { kind: "boolean" }, alwaysExposed: true },
        c,
      ),
    );
    expect(def).toEqual({
      kind: "scalar",
      code: "D0001",
      label: "갱신여부",
      description: "",
      level: "coverage",
      alwaysExposed: true,
      type: { kind: "boolean" },
    });
    const second = unwrap(
      await createDiscriminator({ kind: "scalar", label: "다른것", level: "product", type: { kind: "string" } }, c),
    );
    expect(second.code).toBe("D0002");
  });

  it("생성 입력에는 code 필드가 없다 — 유저 입력 불가는 타입으로 강제", () => {
    const input: NewDiscriminator = {
      kind: "scalar",
      label: "갱신여부",
      level: "coverage",
      type: { kind: "boolean" },
      // @ts-expect-error code 는 입력 항목이 아니다
      code: "renewal",
    };
    expect(input).toBeDefined();
  });

  it("표시명 변경은 자유 — 코드는 그대로다", async () => {
    const def = unwrap(
      await createDiscriminator({ kind: "scalar", label: "갱신여부", level: "coverage", type: { kind: "boolean" } }, ctx()),
    );
    const renamed = unwrap(renameDiscriminator(def, "갱신형 여부", []));
    expect(renamed.code).toBe("D0001");
    expect(renamed.label).toBe("갱신형 여부");
  });

  it("표시명이 비면 invalid", async () => {
    const r = await createDiscriminator({ kind: "scalar", label: "  ", level: "coverage", type: { kind: "boolean" } }, ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejection.reason).toBe("invalid");
  });

  it("부착 레벨이 5레벨 밖이면 invalid (런타임 입력 방어)", async () => {
    const r = await createDiscriminator(
      { kind: "scalar", label: "x", level: "productCoverage" as never, type: { kind: "boolean" } },
      ctx(),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejection.reason).toBe("invalid");
  });
});

describe("D-P1-1 — 같은 부착 레벨 안 표시명 완전 중복은 거부", () => {
  it("같은 레벨에 같은 표시명 → duplicate", async () => {
    const c = ctx({ existing: [{ code: "D0001", label: "갱신여부", level: "coverage" }] });
    const r = await createDiscriminator({ kind: "scalar", label: "갱신여부", level: "coverage", type: { kind: "boolean" } }, c);
    expect(r).toEqual({ ok: false, rejection: { reason: "duplicate", what: "담보 레벨 표시명 「갱신여부」" } });
  });

  it("다른 레벨이면 같은 표시명도 채번된다", async () => {
    const c = ctx({ existing: [{ code: "D0001", label: "갱신여부", level: "coverage" }] });
    const r = await createDiscriminator({ kind: "scalar", label: "갱신여부", level: "product", type: { kind: "boolean" } }, c);
    expect(r.ok).toBe(true);
  });

  it("표시명 변경도 같은 중복 규칙을 탄다 — 자기 자신은 제외", async () => {
    const def = unwrap(
      await createDiscriminator({ kind: "scalar", label: "갱신여부", level: "coverage", type: { kind: "boolean" } }, ctx()),
    );
    const others = [
      { code: "D0001", label: "갱신여부", level: "coverage" as const },
      { code: "D0002", label: "면책여부", level: "coverage" as const },
    ];
    expect(renameDiscriminator(def, "면책여부", others).ok).toBe(false);
    expect(renameDiscriminator(def, "갱신여부", others).ok).toBe(true);
  });
});

describe("구분자정의 S2 — enum 정의와 값 추가", () => {
  it("enum 「고지유형」 정의 — 값 3개는 V01·V02·V03, enum 은 E0001", async () => {
    const c = ctx();
    const e = unwrap(
      await createEnum({ label: "고지유형", values: [{ label: "일반심사" }, { label: "간편심사" }, { label: "건강고지" }] }, c),
    );
    expect(e.code).toBe("E0001");
    expect(e.values.map((v) => [v.code, v.label, v.order])).toEqual([
      ["V01", "일반심사", 0],
      ["V02", "간편심사", 1],
      ["V03", "건강고지", 2],
    ]);
  });

  it("상품 레벨 enum 구분자가 이 enum 을 참조한다 — 없는 enum 이면 invalid(brokenRef)", async () => {
    const ok = await createDiscriminator(
      { kind: "scalar", label: "고지유형", level: "product", type: { kind: "enum", enumCode: "E0001" } },
      ctx(),
    );
    expect(ok.ok).toBe(true);
    const bad = await createDiscriminator(
      { kind: "scalar", label: "고지유형", level: "product", type: { kind: "enum", enumCode: "E9999" } },
      ctx(),
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok && bad.rejection.reason === "invalid") expect(bad.rejection.issues[0].kind).toBe("brokenRef");
  });

  it("값 추가는 자유 — 다음 코드를 받는다 (삭제된 순번 재사용 없음)", async () => {
    const c = ctx();
    const e = unwrap(await createEnum({ label: "고지유형", values: [{ label: "일반심사" }, { label: "간편심사" }] }, c));
    const e2 = unwrap(await addEnumValue(e, { label: "건강고지" }, c.nextSeq));
    expect(e2.values[2]).toEqual({ code: "V03", label: "건강고지", order: 2 });
    const e3 = removeEnumValue(e2, "V03");
    const e4 = unwrap(await addEnumValue(unwrap(e3), { label: "재추가" }, c.nextSeq));
    expect(e4.values.at(-1)?.code).toBe("V04");
  });

  it("값 표시명 변경은 자유 — 코드 불변", async () => {
    const e = unwrap(await createEnum({ label: "고지유형", values: [{ label: "간편심사" }] }, ctx()));
    const e2 = unwrap(renameEnumValue(e, "V01", "간편고지심사"));
    expect(e2.values[0]).toEqual({ code: "V01", label: "간편고지심사", order: 0 });
    expect(renameEnumValue(e, "V99", "x").ok).toBe(false);
  });

  it("enum 표시명 중복은 거부 (D-P1-7) · 한 enum 안 값 표시명 중복도 거부", async () => {
    const dup = await createEnum({ label: "고지유형" }, ctx({ existing: [], existingEnumLabels: ["고지유형"] }));
    expect(dup).toEqual({ ok: false, rejection: { reason: "duplicate", what: "enum 표시명 「고지유형」" } });
    const dupValue = await createEnum({ label: "x", values: [{ label: "a" }, { label: "a" }] }, ctx());
    expect(dupValue.ok).toBe(false);
  });
});

describe("구분자정의 S3 — 구조체(폼) 정의와 필드", () => {
  const input: NewDiscriminator = {
    kind: "struct",
    label: "보험금지급",
    level: "benefit",
    alwaysExposed: true,
    fields: [
      { label: "면책여부", type: { kind: "boolean" } },
      { label: "지급률", type: { kind: "number" }, defaultValue: 100 },
    ],
  };

  it("구조체 하나 = 채번 1회. 필드 코드는 구조체 안에서 F01 부터", async () => {
    const def = unwrap(await createDiscriminator(input, ctx())) as StructDiscriminator;
    expect(def.code).toBe("D0001");
    expect(def.fields).toEqual([
      { code: "F01", label: "면책여부", type: { kind: "boolean" }, order: 0 },
      { code: "F02", label: "지급률", type: { kind: "number" }, defaultValue: 100, order: 1 },
    ]);
  });

  it("두 구조체의 필드 순번은 서로 독립이다 (scope = 구조체 코드)", async () => {
    const c = ctx();
    const a = unwrap(await createDiscriminator(input, c)) as StructDiscriminator;
    const b = unwrap(await createDiscriminator({ ...input, label: "다른폼" }, c)) as StructDiscriminator;
    expect(a.fields[0].code).toBe("F01");
    expect(b.fields[0].code).toBe("F01");
  });

  it("필드 타입으로 구조체를 지정하면 거부 — 중첩 금지", async () => {
    const r = await createDiscriminator(
      { kind: "struct", label: "x", level: "benefit", fields: [{ label: "소그룹", type: { kind: "struct" } as never }] },
      ctx(),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejection.reason).toBe("invalid");
  });

  it("필드 추가는 비파괴 — 새 필드는 다음 코드를 받고 맨 뒤에 붙는다", async () => {
    const c = ctx();
    const def = unwrap(await createDiscriminator(input, c)) as StructDiscriminator;
    const added = unwrap(await addField(def, { label: "감액기간", type: { kind: "number" } }, c));
    expect(added.fields.map((f) => f.code)).toEqual(["F01", "F02", "F03"]);
    expect(added.fields[2].order).toBe(2);
    expect(def.fields).toHaveLength(2); // 원본 불변
  });

  it("한 구조체 안 필드 표시명 중복은 거부", async () => {
    const c = ctx();
    const def = unwrap(await createDiscriminator(input, c)) as StructDiscriminator;
    const r = await addField(def, { label: "지급률", type: { kind: "string" } }, c);
    expect(r).toEqual({ ok: false, rejection: { reason: "duplicate", what: "필드 표시명 「지급률」" } });
  });

  it("필드 표시명 변경·순서 변경은 비파괴 — 코드 불변", async () => {
    const def = unwrap(await createDiscriminator(input, ctx())) as StructDiscriminator;
    const renamed = unwrap(renameField(def, "F01", "면책 여부"));
    expect(renamed.fields[0]).toMatchObject({ code: "F01", label: "면책 여부" });
    const reordered = unwrap(reorderFields(def, ["F02", "F01"]));
    expect(reordered.fields.map((f) => [f.code, f.order])).toEqual([
      ["F02", 0],
      ["F01", 1],
    ]);
    expect(reorderFields(def, ["F02"]).ok).toBe(false); // 전체 코드를 다 줘야 한다
  });

  it("필드 기본값은 타입에 맞아야 하고, 해제(undefined)할 수 있다", async () => {
    const bad = await createDiscriminator(
      { kind: "struct", label: "x", level: "benefit", fields: [{ label: "지급률", type: { kind: "number" }, defaultValue: "100" }] },
      ctx(),
    );
    expect(bad.ok).toBe(false);
    const def = unwrap(await createDiscriminator(input, ctx())) as StructDiscriminator;
    const cleared = unwrap(setFieldDefaultValue(def, "F02", undefined, () => undefined));
    expect(cleared.fields[1].defaultValue).toBeUndefined();
    expect(setFieldDefaultValue(def, "F02", "x", () => undefined).ok).toBe(false);
  });
});

describe("구분자정의 S4 — const 구분자: 평균공시이율", () => {
  it("const 는 string 값만 갖고 부착 레벨·노출여부가 없다 (D-P1-13)", async () => {
    const def = unwrap(await createDiscriminator({ kind: "const", label: "평균공시이율", value: "2.5%" }, ctx()));
    expect(def).toEqual({ kind: "const", code: "D0001", label: "평균공시이율", description: "", value: "2.5%" });
    expect("level" in def).toBe(false);
  });

  it("string 외 값을 넣으면 거부 (런타임 방어)", async () => {
    const r = await createDiscriminator({ kind: "const", label: "x", value: 2.5 as never }, ctx());
    expect(r.ok).toBe(false);
  });

  it("값 변경은 마스터 한 곳에서 — 편집자도 가능한 비파괴 변경", async () => {
    const def = unwrap(await createDiscriminator({ kind: "const", label: "평균공시이율", value: "2.5%" }, ctx())) as ConstDiscriminator;
    expect(unwrap(setConstValue(def, "2.65%")).value).toBe("2.65%");
    expect(setConstValue(def, 3 as never).ok).toBe(false);
  });

  it("const 끼리는 표시명 중복을 거부한다 (레벨 없음 = 하나의 범위)", async () => {
    const c = ctx({ existing: [{ code: "D0001", label: "평균공시이율" }] });
    const r = await createDiscriminator({ kind: "const", label: "평균공시이율", value: "1%" }, c);
    expect(r.ok).toBe(false);
  });
});

describe("구분자정의 S5 · 체증체감납 S4 — 파생 구분자: 식은 데이터 · 별칭 금지", () => {
  it("식이 문자열 그대로 저장된다 (블랙박스 없음)", async () => {
    const def = unwrap(
      await createDiscriminator({ kind: "derived", label: "면책여부합", level: "coverage", expression: "any(D0002.F01)" }, ctx()),
    );
    expect(def).toEqual({
      kind: "derived",
      code: "D0001",
      label: "면책여부합",
      description: "",
      level: "coverage",
      expression: "any(D0002.F01)",
    });
  });

  it("별칭형 파생(A = B) 은 거부 — 기본 판정은 「단일 참조 경로뿐인 식」", async () => {
    expect(isAliasExpression("D0001")).toBe(true);
    expect(isAliasExpression("  D0002.F01 ")).toBe(true);
    expect(isAliasExpression("any(D0002.F01)")).toBe(false);
    expect(isAliasExpression("D0001 and D0003")).toBe(false);
    const r = await createDiscriminator(
      { kind: "derived", label: "보험료가벼운납입형여부", level: "product", expression: "D0001" },
      ctx(),
    );
    expect(r.ok).toBe(false);
    if (!r.ok && r.rejection.reason === "invalid") expect(r.rejection.issues[0].kind).toBe("syntax");
  });

  it("별칭 판정은 주입으로 바꿀 수 있다 (expression 모듈이 담당)", async () => {
    const c = ctx({ isAlias: (e) => e.includes("ALIAS") });
    expect((await createDiscriminator({ kind: "derived", label: "a", level: "product", expression: "D0001" }, c)).ok).toBe(true);
    expect((await createDiscriminator({ kind: "derived", label: "b", level: "product", expression: "ALIAS" }, c)).ok).toBe(false);
  });

  it("빈 식은 거부 · 식 수정도 같은 검증을 탄다 (D-P1-12 비파괴)", async () => {
    expect((await createDiscriminator({ kind: "derived", label: "a", level: "product", expression: " " }, ctx())).ok).toBe(false);
    const def = unwrap(
      await createDiscriminator({ kind: "derived", label: "a", level: "product", expression: "any(D0002.F01)" }, ctx()),
    ) as DerivedDiscriminator;
    expect(unwrap(setExpression(def, "all(D0002.F01)")).expression).toBe("all(D0002.F01)");
    expect(setExpression(def, "D0002.F01").ok).toBe(false);
  });
});

describe("구분자정의 S6 (순수 변환) — 타입 변경 · 필드 삭제의 정의 쪽 결과", () => {
  it("scalar 타입 변경은 기본값을 함께 버린다 (옛 타입의 값이라 무효)", async () => {
    const def = unwrap(
      await createDiscriminator(
        { kind: "scalar", label: "갱신여부", level: "coverage", type: { kind: "boolean" }, defaultValue: false },
        ctx(),
      ),
    ) as ScalarDiscriminator;
    const changed = unwrap(changeScalarType(def, { kind: "enum", enumCode: "E0001" }, (c) => (c === "E0001" ? 고지유형 : undefined)));
    expect(changed.type).toEqual({ kind: "enum", enumCode: "E0001" });
    expect(changed.defaultValue).toBeUndefined();
    expect(changeScalarType(def, { kind: "enum", enumCode: "E9" }, () => undefined).ok).toBe(false);
  });

  it("필드 타입 변경·필드 삭제 — 없는 필드면 notFound", async () => {
    const def = unwrap(
      await createDiscriminator(
        {
          kind: "struct",
          label: "보험금지급",
          level: "benefit",
          fields: [{ label: "면책여부", type: { kind: "boolean" } }, { label: "지급률", type: { kind: "number" }, defaultValue: 100 }],
        },
        ctx(),
      ),
    ) as StructDiscriminator;
    const changed = unwrap(changeFieldType(def, "F02", { kind: "string" }, () => undefined));
    expect(changed.fields[1]).toEqual({ code: "F02", label: "지급률", type: { kind: "string" }, order: 1 });
    const removed = unwrap(removeField(def, "F01"));
    expect(removed.fields.map((f) => [f.code, f.order])).toEqual([["F02", 0]]);
    expect(removeField(def, "F09")).toEqual({ ok: false, rejection: { reason: "notFound", what: "필드 F09" } });
  });

  it("scalar 기본값 지정·해제", async () => {
    const def = unwrap(
      await createDiscriminator({ kind: "scalar", label: "갱신여부", level: "coverage", type: { kind: "boolean" } }, ctx()),
    ) as ScalarDiscriminator;
    expect(unwrap(setDefaultValue(def, true, () => undefined)).defaultValue).toBe(true);
    expect(setDefaultValue(def, "yes", () => undefined).ok).toBe(false);
    expect(unwrap(setDefaultValue({ ...def, defaultValue: true }, undefined, () => undefined)).defaultValue).toBeUndefined();
  });
});
