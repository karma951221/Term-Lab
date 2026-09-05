import { describe, expect, it } from "vitest";

import type {
  ConstDiscriminator,
  DerivedDiscriminator,
  EnumDef,
  EnumLookup,
  ScalarDiscriminator,
  StructDiscriminator,
} from "@/domain/catalog/types";
import { entered, NOT_ENTERED, type ValueSlot } from "@/domain/types";

import {
  buildForm,
  formatValue,
  formReducer,
  initFormState,
  toSubmission,
  zodSchemaFor,
  zodValueSchema,
  type FormState,
} from "./model";

// ───────────────────────────── 픽스처 ─────────────────────────────

const 고지유형: EnumDef = {
  code: "E0001",
  label: "고지유형",
  values: [
    // order 역순으로 넣어 정렬을 검증한다
    { code: "V03", label: "건강고지", order: 2 },
    { code: "V01", label: "일반심사", order: 0 },
    { code: "V02", label: "간편심사", order: 1 },
  ],
};
const enums: EnumLookup = (c) => (c === "E0001" ? 고지유형 : undefined);

/** 6 타입을 모두 가진 구조체 — 폼 렌더러가 타입 매핑 하나로 그려야 한다. */
const 보험금지급: StructDiscriminator = {
  kind: "struct",
  code: "D0002",
  label: "보험금지급",
  description: "",
  level: "benefit",
  alwaysExposed: true,
  fields: [
    // order 역순으로 넣어 정렬을 검증한다
    { code: "F06", label: "적용유형", type: { kind: "list<enum>", enumCode: "E0001" }, order: 5 },
    { code: "F05", label: "고지유형", type: { kind: "enum", enumCode: "E0001" }, order: 4 },
    { code: "F04", label: "개시일", type: { kind: "date" }, order: 3 },
    { code: "F03", label: "비고", type: { kind: "string" }, order: 2 },
    { code: "F02", label: "지급률", type: { kind: "number" }, defaultValue: 100, order: 1 },
    { code: "F01", label: "면책여부", type: { kind: "boolean" }, order: 0 },
  ],
};

const 갱신여부: ScalarDiscriminator = {
  kind: "scalar",
  code: "D0001",
  label: "갱신여부",
  description: "",
  level: "coverage",
  alwaysExposed: true,
  type: { kind: "boolean" },
  defaultValue: false,
};

const 평균공시이율: ConstDiscriminator = {
  kind: "const",
  code: "D0003",
  label: "평균공시이율",
  description: "",
  value: "2.5%",
};

const 면책여부합: DerivedDiscriminator = {
  kind: "derived",
  code: "D0004",
  label: "면책여부합",
  description: "",
  level: "coverage",
  expression: "any(D0002.F01)",
};

const empty = new Map<string, ValueSlot>();

function stateOf(current: Map<string, ValueSlot> = empty): FormState {
  return initFormState(buildForm(보험금지급, enums, current));
}

// ───────────────────────────── buildForm ─────────────────────────────

describe("buildForm — 구조체 메타만으로 폼 모델이 만들어진다 (ADR-0001)", () => {
  it("scalar 구분자는 필드 1개 — 경로는 구분자 코드", () => {
    const form = buildForm(갱신여부, enums, empty);
    expect(form.code).toBe("D0001");
    expect(form.label).toBe("갱신여부");
    expect(form.fields).toHaveLength(1);
    expect(form.fields[0].path).toBe("D0001");
    expect(form.fields[0].label).toBe("갱신여부");
    expect(form.fields[0].type).toEqual({ kind: "boolean" });
  });

  it("struct 구분자는 필드 목록 — order 오름차순, 경로는 `구분자.필드`", () => {
    const form = buildForm(보험금지급, enums, empty);
    expect(form.fields.map((f) => f.path)).toEqual([
      "D0002.F01",
      "D0002.F02",
      "D0002.F03",
      "D0002.F04",
      "D0002.F05",
      "D0002.F06",
    ]);
    expect(form.fields.map((f) => f.label)).toEqual([
      "면책여부",
      "지급률",
      "비고",
      "개시일",
      "고지유형",
      "적용유형",
    ]);
  });

  it("const · derived 는 값 자리가 없다 — 필드 0개", () => {
    expect(buildForm(평균공시이율, enums, empty).fields).toEqual([]);
    expect(buildForm(면책여부합, enums, empty).fields).toEqual([]);
  });

  it("enum · list<enum> 필드는 선택지를 코드+표시명으로 갖는다 — order 순 (ADR-0005)", () => {
    const form = buildForm(보험금지급, enums, empty);
    const 고지 = form.fields.find((f) => f.path === "D0002.F05")!;
    const 적용 = form.fields.find((f) => f.path === "D0002.F06")!;
    expect(고지.enumOptions).toEqual([
      { code: "V01", label: "일반심사" },
      { code: "V02", label: "간편심사" },
      { code: "V03", label: "건강고지" },
    ]);
    expect(적용.enumOptions).toEqual(고지.enumOptions);
    expect(form.fields.find((f) => f.path === "D0002.F03")!.enumOptions).toBeUndefined();
  });

  it("없는 enum 을 가리키는 필드는 선택지가 빈 목록이다 (깨진 참조 — 폼은 죽지 않는다)", () => {
    const form = buildForm(
      {
        ...보험금지급,
        fields: [{ code: "F01", label: "x", type: { kind: "enum", enumCode: "E9999" }, order: 0 }],
      },
      enums,
      empty,
    );
    expect(form.fields[0].enumOptions).toEqual([]);
  });

  it("값 자리는 기본값 지정 여부와 무관하게 「미입력」으로 태어난다 (ADR-0004)", () => {
    const form = buildForm(보험금지급, enums, empty);
    const 지급률 = form.fields.find((f) => f.path === "D0002.F02")!;
    expect(지급률.state).toBe("notEntered");
    expect(지급률.value).toBeUndefined();
    // 기본값은 prefill 로만 실린다
    expect(지급률.prefill).toBe(100);
    expect(form.fields.find((f) => f.path === "D0002.F01")!.prefill).toBeUndefined();
  });

  it("저장소에 명시 값이 있으면 entered + 값", () => {
    const current = new Map<string, ValueSlot>([
      ["D0002.F01", entered(true)],
      ["D0002.F02", NOT_ENTERED],
    ]);
    const form = buildForm(보험금지급, enums, current);
    const 면책 = form.fields.find((f) => f.path === "D0002.F01")!;
    expect(면책.state).toBe("entered");
    expect(면책.value).toBe(true);
    // entered:false 도, 자리를 모르는 것도 미입력
    expect(form.fields.find((f) => f.path === "D0002.F02")!.state).toBe("notEntered");
    expect(form.fields.find((f) => f.path === "D0002.F03")!.state).toBe("notEntered");
  });

  it("scalar 의 기본값도 prefill 로만 — 저장 전엔 미입력", () => {
    const form = buildForm(갱신여부, enums, empty);
    expect(form.fields[0].state).toBe("notEntered");
    expect(form.fields[0].prefill).toBe(false);
  });
});

// ───────────────────────────── 리듀서 ─────────────────────────────

describe("initFormState — 편집 상태의 초기값", () => {
  it("저장 값이 있으면 draft 에 문자열로 실리고 entered", () => {
    const current = new Map<string, ValueSlot>([
      ["D0002.F02", entered(80)],
      ["D0002.F01", entered(false)],
      ["D0002.F06", entered(["V01", "V03"])],
    ]);
    const s = stateOf(current);
    expect(s.fields["D0002.F02"]).toMatchObject({ draft: "80", entered: true, value: 80 });
    expect(s.fields["D0002.F01"]).toMatchObject({ draft: "false", entered: true, value: false });
    expect(s.fields["D0002.F06"]).toMatchObject({
      draft: ["V01", "V03"],
      entered: true,
      value: ["V01", "V03"],
    });
  });

  it("시나리오 1 — 기본값은 화면에 프리필로 미리 보이지만 상태는 여전히 미입력", () => {
    const s = stateOf();
    const 지급률 = s.fields["D0002.F02"];
    expect(지급률.view.prefill).toBe(100);
    expect(지급률.entered).toBe(false);
    expect(지급률.value).toBeUndefined();
    expect(지급률.draft).toBe("");
  });

  it("미입력 필드의 draft 는 빈 값 — list<enum> 은 빈 배열", () => {
    const s = stateOf();
    expect(s.fields["D0002.F03"].draft).toBe("");
    expect(s.fields["D0002.F06"].draft).toEqual([]);
  });
});

describe("formReducer — edit: 문자열 입력을 타입에 맞게 파싱한다", () => {
  it("string 은 그대로", () => {
    const s = formReducer(stateOf(), { type: "edit", path: "D0002.F03", draft: "특약 비고" });
    expect(s.fields["D0002.F03"]).toMatchObject({ entered: true, value: "특약 비고", dirty: true });
    expect(s.fields["D0002.F03"].error).toBeUndefined();
  });

  it("number 는 숫자로 — 숫자가 아니면 필드 오류", () => {
    const ok = formReducer(stateOf(), { type: "edit", path: "D0002.F02", draft: "80.5" });
    expect(ok.fields["D0002.F02"]).toMatchObject({ entered: true, value: 80.5 });
    const bad = formReducer(stateOf(), { type: "edit", path: "D0002.F02", draft: "팔십" });
    expect(bad.fields["D0002.F02"].value).toBeUndefined();
    expect(bad.fields["D0002.F02"].error).toBeTruthy();
    expect(bad.fields["D0002.F02"].draft).toBe("팔십"); // 입력 원문은 남는다
  });

  it("date 는 YYYY-MM-DD 실제 날짜만", () => {
    const ok = formReducer(stateOf(), { type: "edit", path: "D0002.F04", draft: "2026-01-01" });
    expect(ok.fields["D0002.F04"].value).toBe("2026-01-01");
    const bad = formReducer(stateOf(), { type: "edit", path: "D0002.F04", draft: "2026-02-30" });
    expect(bad.fields["D0002.F04"].error).toBeTruthy();
  });

  it("boolean 은 'true' / 'false' 만", () => {
    const t = formReducer(stateOf(), { type: "edit", path: "D0002.F01", draft: "true" });
    expect(t.fields["D0002.F01"].value).toBe(true);
    const f = formReducer(stateOf(), { type: "edit", path: "D0002.F01", draft: "false" });
    expect(f.fields["D0002.F01"].value).toBe(false);
    const bad = formReducer(stateOf(), { type: "edit", path: "D0002.F01", draft: "yes" });
    expect(bad.fields["D0002.F01"].error).toBeTruthy();
  });

  it("enum 은 값 코드 — 선택지에 없는 코드는 오류 (표시명도 오류)", () => {
    const ok = formReducer(stateOf(), { type: "edit", path: "D0002.F05", draft: "V02" });
    expect(ok.fields["D0002.F05"].value).toBe("V02");
    const bad = formReducer(stateOf(), { type: "edit", path: "D0002.F05", draft: "간편심사" });
    expect(bad.fields["D0002.F05"].error).toBeTruthy();
  });

  it("list<enum> 은 코드 배열 — 중복·없는 코드는 오류, 빈 배열은 미입력", () => {
    const ok = formReducer(stateOf(), { type: "edit", path: "D0002.F06", draft: ["V01", "V03"] });
    expect(ok.fields["D0002.F06"]).toMatchObject({ entered: true, value: ["V01", "V03"] });
    const dup = formReducer(stateOf(), { type: "edit", path: "D0002.F06", draft: ["V01", "V01"] });
    expect(dup.fields["D0002.F06"].error).toBeTruthy();
    const unknown = formReducer(stateOf(), { type: "edit", path: "D0002.F06", draft: ["V09"] });
    expect(unknown.fields["D0002.F06"].error).toBeTruthy();
    const none = formReducer(ok, { type: "edit", path: "D0002.F06", draft: [] });
    expect(none.fields["D0002.F06"]).toMatchObject({ entered: false, value: undefined });
  });

  it("빈 입력은 값이 아니라 미입력이다 — 오류도 아니다 (null 없음)", () => {
    const typed = formReducer(stateOf(), { type: "edit", path: "D0002.F02", draft: "80" });
    const erased = formReducer(typed, { type: "edit", path: "D0002.F02", draft: "" });
    expect(erased.fields["D0002.F02"]).toMatchObject({ entered: false, value: undefined });
    expect(erased.fields["D0002.F02"].error).toBeUndefined();
  });

  it("모르는 경로는 무시한다 (상태 동일 객체)", () => {
    const s = stateOf();
    expect(formReducer(s, { type: "edit", path: "D9999", draft: "x" })).toBe(s);
  });
});

describe("formReducer — clear · applyPrefill", () => {
  it("clear: 값을 지워 미입력으로 만든다 — 저장 값이 있던 자리도", () => {
    const s = stateOf(new Map([["D0002.F02", entered(80)]]));
    const cleared = formReducer(s, { type: "clear", path: "D0002.F02" });
    expect(cleared.fields["D0002.F02"]).toMatchObject({
      entered: false,
      value: undefined,
      draft: "",
      dirty: true,
    });
    const list = formReducer(stateOf(new Map([["D0002.F06", entered(["V01"])]])), {
      type: "clear",
      path: "D0002.F06",
    });
    expect(list.fields["D0002.F06"].draft).toEqual([]);
  });

  it("applyPrefill: 기본값을 draft 로 끌어와 entered 가 된다 — 사람이 「보고 채운」 행위", () => {
    const s = formReducer(stateOf(), { type: "applyPrefill", path: "D0002.F02" });
    expect(s.fields["D0002.F02"]).toMatchObject({ entered: true, value: 100, draft: "100", dirty: true });
  });

  it("applyPrefill: 기본값이 없는 필드에는 아무 일도 없다", () => {
    const s = stateOf();
    expect(formReducer(s, { type: "applyPrefill", path: "D0002.F01" })).toBe(s);
  });
});

// ───────────────────────────── 제출 ─────────────────────────────

describe("toSubmission — 저장할 값 목록 (기본값 자동 유입 없음)", () => {
  it("시나리오 1 — 프리필만 보고 저장하면 그 필드는 제출되지 않는다 (미입력 유지)", () => {
    const sub = toSubmission(stateOf());
    expect(sub.values).toEqual([]);
    expect(sub.issues).toEqual([]);
  });

  it("시나리오 1 — 「기본값 채우기」 후 저장해야 비로소 명시 값 100", () => {
    const s = formReducer(stateOf(), { type: "applyPrefill", path: "D0002.F02" });
    expect(toSubmission(s).values).toEqual([{ path: "D0002.F02", value: 100 }]);
  });

  it("시나리오 2 — 일부만 입력하고 저장: 입력한 것만 제출, 나머지는 미입력으로 남는다", () => {
    let s = stateOf();
    s = formReducer(s, { type: "edit", path: "D0002.F01", draft: "true" });
    s = formReducer(s, { type: "edit", path: "D0002.F06", draft: ["V02"] });
    expect(toSubmission(s).values).toEqual([
      { path: "D0002.F01", value: true },
      { path: "D0002.F06", value: ["V02"] },
    ]);
  });

  it("저장돼 있던 값을 지우면 value: undefined 로 제출된다 (값 지우기)", () => {
    const s = formReducer(stateOf(new Map([["D0002.F02", entered(80)]])), {
      type: "clear",
      path: "D0002.F02",
    });
    expect(toSubmission(s).values).toEqual([{ path: "D0002.F02", value: undefined }]);
  });

  it("원래 미입력이던 자리를 지워도 제출하지 않는다", () => {
    const s = formReducer(stateOf(), { type: "clear", path: "D0002.F02" });
    expect(toSubmission(s).values).toEqual([]);
  });

  it("저장 값이 있고 손대지 않은 필드도 제출된다 (사람이 보고 저장한 값)", () => {
    const s = stateOf(new Map([["D0002.F03", entered("메모")]]));
    expect(toSubmission(s).values).toEqual([{ path: "D0002.F03", value: "메모" }]);
  });

  it("파싱 오류가 있는 필드는 Issue(typeMismatch + refPath) 로 보고되고 값은 빠진다", () => {
    const s = formReducer(stateOf(), { type: "edit", path: "D0002.F02", draft: "팔십" });
    const sub = toSubmission(s);
    expect(sub.values).toEqual([]);
    expect(sub.issues).toHaveLength(1);
    expect(sub.issues[0].kind).toBe("typeMismatch");
    expect(sub.issues[0].at.refPath).toBe("D0002.F02");
  });

  it("저장소에서 온 값이 지금 enum 에 없으면 (값 삭제됨) brokenRef 로 보고된다", () => {
    const s = stateOf(new Map([["D0002.F05", entered("V99")]]));
    const sub = toSubmission(s);
    expect(sub.issues[0].kind).toBe("brokenRef");
    expect(sub.issues[0].at.refPath).toBe("D0002.F05");
    expect(sub.values).toEqual([]);
  });

  it("제출 순서는 폼 순서(order)를 따른다", () => {
    let s = stateOf();
    s = formReducer(s, { type: "edit", path: "D0002.F05", draft: "V01" });
    s = formReducer(s, { type: "edit", path: "D0002.F01", draft: "false" });
    expect(toSubmission(s).values.map((v) => v.path)).toEqual(["D0002.F01", "D0002.F05"]);
  });
});

// ───────────────────────────── 표시 ─────────────────────────────

describe("formatValue — 읽기 전용 표시 문자열 (표시명으로, ADR-0005)", () => {
  it("enum 은 코드가 아니라 표시명, list<enum> 은 표시명 나열", () => {
    const form = buildForm(
      보험금지급,
      enums,
      new Map([
        ["D0002.F05", entered("V02")],
        ["D0002.F06", entered(["V03", "V01"])],
      ]),
    );
    expect(formatValue(form.fields.find((f) => f.path === "D0002.F05")!)).toBe("간편심사");
    expect(formatValue(form.fields.find((f) => f.path === "D0002.F06")!)).toBe("건강고지, 일반심사");
  });

  it("boolean 은 예/아니오, 나머지는 문자열 그대로", () => {
    const form = buildForm(
      보험금지급,
      enums,
      new Map([
        ["D0002.F01", entered(true)],
        ["D0002.F02", entered(80)],
        ["D0002.F04", entered("2026-01-01")],
      ]),
    );
    expect(formatValue(form.fields.find((f) => f.path === "D0002.F01")!)).toBe("예");
    expect(formatValue(form.fields.find((f) => f.path === "D0002.F02")!)).toBe("80");
    expect(formatValue(form.fields.find((f) => f.path === "D0002.F04")!)).toBe("2026-01-01");
  });

  it("미입력이면 undefined — 화면이 배지로 대신한다", () => {
    const form = buildForm(보험금지급, enums, empty);
    expect(formatValue(form.fields[0])).toBeUndefined();
  });

  it("enum 값 코드가 선택지에 없으면 코드를 그대로 보여준다 (깨진 참조가 숨지 않게)", () => {
    const form = buildForm(보험금지급, enums, new Map([["D0002.F05", entered("V99")]]));
    expect(formatValue(form.fields.find((f) => f.path === "D0002.F05")!)).toBe("V99");
  });
});

// ───────────────────────────── zod ─────────────────────────────

describe("zodValueSchema — 타입 하나의 값 스키마", () => {
  it("6 타입 각각을 받아들이고 모양이 틀리면 거부한다", () => {
    expect(zodValueSchema({ kind: "string" }, enums).safeParse("a").success).toBe(true);
    expect(zodValueSchema({ kind: "string" }, enums).safeParse(1).success).toBe(false);
    expect(zodValueSchema({ kind: "number" }, enums).safeParse(1.5).success).toBe(true);
    expect(zodValueSchema({ kind: "number" }, enums).safeParse("1").success).toBe(false);
    expect(zodValueSchema({ kind: "number" }, enums).safeParse(Number.NaN).success).toBe(false);
    expect(zodValueSchema({ kind: "boolean" }, enums).safeParse(false).success).toBe(true);
    expect(zodValueSchema({ kind: "boolean" }, enums).safeParse(0).success).toBe(false);
    expect(zodValueSchema({ kind: "date" }, enums).safeParse("2026-01-01").success).toBe(true);
    expect(zodValueSchema({ kind: "date" }, enums).safeParse("2026-02-30").success).toBe(false);
    expect(zodValueSchema({ kind: "date" }, enums).safeParse("20260101").success).toBe(false);
    const e = zodValueSchema({ kind: "enum", enumCode: "E0001" }, enums);
    expect(e.safeParse("V01").success).toBe(true);
    expect(e.safeParse("일반심사").success).toBe(false);
    const l = zodValueSchema({ kind: "list<enum>", enumCode: "E0001" }, enums);
    expect(l.safeParse(["V01", "V02"]).success).toBe(true);
    expect(l.safeParse([]).success).toBe(true);
    expect(l.safeParse(["V01", "V01"]).success).toBe(false);
    expect(l.safeParse(["V09"]).success).toBe(false);
    expect(l.safeParse("V01").success).toBe(false);
  });

  it("없는 enum 을 가리키면 어떤 값도 받지 않는다", () => {
    expect(zodValueSchema({ kind: "enum", enumCode: "E9999" }, enums).safeParse("V01").success).toBe(
      false,
    );
  });
});

describe("zodSchemaFor — 제출 목록 스키마 (서버 액션 입력 검증)", () => {
  const schema = zodSchemaFor(보험금지급, enums);

  it("폼이 만든 제출 목록을 그대로 받아들인다", () => {
    let s = stateOf(new Map([["D0002.F03", entered("메모")]]));
    s = formReducer(s, { type: "edit", path: "D0002.F02", draft: "80" });
    s = formReducer(s, { type: "edit", path: "D0002.F06", draft: ["V01"] });
    s = formReducer(s, { type: "clear", path: "D0002.F03" });
    const sub = toSubmission(s);
    expect(schema.safeParse(sub.values).success).toBe(true);
  });

  it("경로마다 타입이 맞아야 한다 — 지급률에 문자열은 거부", () => {
    expect(schema.safeParse([{ path: "D0002.F02", value: "80" }]).success).toBe(false);
    expect(schema.safeParse([{ path: "D0002.F05", value: "V09" }]).success).toBe(false);
  });

  it("value 없음(undefined) 은 값 지우기로 허용한다", () => {
    expect(schema.safeParse([{ path: "D0002.F02" }]).success).toBe(true);
    expect(schema.safeParse([{ path: "D0002.F02", value: undefined }]).success).toBe(true);
  });

  it("이 구분자의 자리가 아닌 경로는 거부한다", () => {
    expect(schema.safeParse([{ path: "D0001", value: true }]).success).toBe(false);
    expect(schema.safeParse([{ path: "D0002.F99", value: "x" }]).success).toBe(false);
  });

  it("scalar 구분자는 경로가 구분자 코드 하나", () => {
    const s = zodSchemaFor(갱신여부, enums);
    expect(s.safeParse([{ path: "D0001", value: true }]).success).toBe(true);
    expect(s.safeParse([{ path: "D0001", value: "true" }]).success).toBe(false);
  });

  it("const · derived 는 값 자리가 없다 — 빈 목록만 허용", () => {
    const s = zodSchemaFor(평균공시이율, enums);
    expect(s.safeParse([]).success).toBe(true);
    expect(s.safeParse([{ path: "D0003", value: "x" }]).success).toBe(false);
  });
});
