import { describe, expect, it } from "vitest";

import { entered, NOT_ENTERED, type ValueSlot } from "../types";
import type {
  EnumDef,
  EnumLookup,
  ScalarDiscriminator,
  StructDiscriminator,
} from "./types";
import { missingSlots, prefill, slotType, validateValue, valueSlotsOf } from "./values";

const 고지유형: EnumDef = {
  code: "E0001",
  label: "고지유형",
  values: [
    { code: "V01", label: "일반심사", order: 0 },
    { code: "V02", label: "간편심사", order: 1 },
    { code: "V03", label: "건강고지", order: 2 },
  ],
};
const enums: EnumLookup = (c) => (c === "E0001" ? 고지유형 : undefined);

describe("값 규칙 — validateValue(fieldType, value, enums)", () => {
  it("string · number · boolean 은 JS 원시 타입이 맞아야 한다", () => {
    expect(validateValue({ kind: "string" }, "2.5%", enums)).toEqual([]);
    expect(validateValue({ kind: "number" }, 100, enums)).toEqual([]);
    expect(validateValue({ kind: "boolean" }, false, enums)).toEqual([]);
    expect(validateValue({ kind: "number" }, "100", enums)[0].kind).toBe("typeMismatch");
    expect(validateValue({ kind: "boolean" }, 0, enums)[0].kind).toBe("typeMismatch");
    expect(validateValue({ kind: "number" }, Number.NaN, enums)[0].kind).toBe("typeMismatch");
  });

  it("date 는 YYYY-MM-DD 문자열이고 실제 존재하는 날짜여야 한다", () => {
    expect(validateValue({ kind: "date" }, "2026-01-01", enums)).toEqual([]);
    expect(validateValue({ kind: "date" }, "2026-02-30", enums)[0].kind).toBe("typeMismatch");
    expect(validateValue({ kind: "date" }, "20260101", enums)[0].kind).toBe("typeMismatch");
  });

  it("enum 값은 그 enum 의 값 코드여야 한다 — 표시명이 아니다", () => {
    expect(validateValue({ kind: "enum", enumCode: "E0001" }, "V02", enums)).toEqual([]);
    expect(validateValue({ kind: "enum", enumCode: "E0001" }, "간편심사", enums)[0].kind).toBe(
      "brokenRef",
    );
  });

  it("없는 enum 을 가리키면 brokenRef", () => {
    const issues = validateValue({ kind: "enum", enumCode: "E9999" }, "V01", enums);
    expect(issues[0].kind).toBe("brokenRef");
  });

  it("list<enum> 은 값 코드 배열 — 중복 없이", () => {
    const t = { kind: "list<enum>", enumCode: "E0001" } as const;
    expect(validateValue(t, ["V01", "V03"], enums)).toEqual([]);
    expect(validateValue(t, [], enums)).toEqual([]);
    expect(validateValue(t, "V01", enums)[0].kind).toBe("typeMismatch");
    expect(validateValue(t, ["V01", "V01"], enums)[0].kind).toBe("typeMismatch");
    expect(validateValue(t, ["V01", "V09"], enums)[0].kind).toBe("brokenRef");
  });

  it("좌표를 주면 Issue 에 실린다", () => {
    const issues = validateValue({ kind: "number" }, "x", enums, { refPath: "D0002.F02" });
    expect(issues[0].at.refPath).toBe("D0002.F02");
  });
});

const 보험금지급: StructDiscriminator = {
  kind: "struct",
  code: "D0002",
  label: "보험금지급",
  description: "",
  level: "benefit",
  alwaysExposed: true,
  fields: [
    { code: "F01", label: "면책여부", type: { kind: "boolean" }, order: 0 },
    { code: "F02", label: "지급률", type: { kind: "number" }, defaultValue: 100, order: 1 },
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

describe("값 자리 — valueSlotsOf · slotType", () => {
  it("구조체는 필드마다 자리 하나 (`D0002.F01`), scalar 는 자리 하나 (`D0001`)", () => {
    expect(valueSlotsOf(보험금지급)).toEqual(["D0002.F01", "D0002.F02"]);
    expect(valueSlotsOf(갱신여부)).toEqual(["D0001"]);
  });

  it("const · derived 는 값 자리가 없다 — 입력 경로 없음 (구분자정의 S4)", () => {
    expect(
      valueSlotsOf({ kind: "const", code: "D0003", label: "평균공시이율", description: "", value: "2.5%" }),
    ).toEqual([]);
    expect(
      valueSlotsOf({
        kind: "derived",
        code: "D0004",
        label: "면책여부합",
        description: "",
        level: "coverage",
        expression: "any(D0002.F01)",
      }),
    ).toEqual([]);
  });

  it("자리의 타입을 경로로 찾는다", () => {
    expect(slotType(보험금지급, "D0002.F02")).toEqual({ kind: "number" });
    expect(slotType(갱신여부, "D0001")).toEqual({ kind: "boolean" });
    expect(slotType(보험금지급, "D0002.F09")).toBeUndefined();
    expect(slotType(보험금지급, "D0001")).toBeUndefined();
  });
});

describe("폼입력 S1 — 기본값 프리필: 저장 전에는 미입력", () => {
  it("prefill 은 기본값이 있는 자리만 폼 초기값으로 돌려준다 — 저장소로 가지 않는다", () => {
    expect(prefill(보험금지급)).toEqual({ "D0002.F02": 100 });
    expect(prefill(갱신여부)).toEqual({ "D0001": false });
  });

  it("기본값이 있어도 저장소가 비어 있으면 미입력으로 집계된다", () => {
    const empty = () => undefined;
    expect(missingSlots(보험금지급, empty)).toEqual(["D0002.F01", "D0002.F02"]);
    expect(missingSlots(갱신여부, empty)).toEqual(["D0001"]);
  });
});

describe("폼입력 S2 — 미입력 상태로 중간 저장", () => {
  it("일부만 입력된 구조체의 미입력 목록은 나머지 자리다 — entered:false 도 미입력", () => {
    const store: Record<string, ValueSlot> = {
      "D0002.F01": entered(true),
      "D0002.F02": NOT_ENTERED,
    };
    expect(missingSlots(보험금지급, (p) => store[p])).toEqual(["D0002.F02"]);
  });

  it("전부 입력되면 미입력 없음", () => {
    const store: Record<string, ValueSlot> = {
      "D0002.F01": entered(false),
      "D0002.F02": entered(50),
    };
    expect(missingSlots(보험금지급, (p) => store[p])).toEqual([]);
  });
});
