import { describe, expect, it } from "vitest";

import { CODE_PATTERN, formatCode, isValidCode, parseCode } from "./codes";

describe("구분자정의 S1 — 코드는 시스템 자동 채번 · 접두 + 순번", () => {
  it("구분자 코드는 D + 4자리 순번이다 (D0001)", () => {
    expect(formatCode("discriminator", 1)).toBe("D0001");
    expect(formatCode("discriminator", 42)).toBe("D0042");
  });

  it("필드 코드는 F + 2자리, enum 은 E + 4자리, enum 값은 V + 2자리다", () => {
    expect(formatCode("field", 1)).toBe("F01");
    expect(formatCode("enum", 7)).toBe("E0007");
    expect(formatCode("enumValue", 12)).toBe("V12");
  });

  it("순번이 자리수를 넘으면 자연 확장한다 — 잘리지 않는다", () => {
    expect(formatCode("field", 100)).toBe("F100");
    expect(formatCode("discriminator", 12345)).toBe("D12345");
  });

  it("순번은 1 이상의 정수만 — 0·음수·소수는 오류", () => {
    expect(() => formatCode("field", 0)).toThrow();
    expect(() => formatCode("field", -1)).toThrow();
    expect(() => formatCode("field", 1.5)).toThrow();
  });

  it("코드 문자열을 종류·순번으로 되읽을 수 있다", () => {
    expect(parseCode("D0042")).toEqual({ kind: "discriminator", seq: 42 });
    expect(parseCode("V03")).toEqual({ kind: "enumValue", seq: 3 });
    expect(parseCode("cov_pay")).toBeUndefined();
    expect(isValidCode("E0001")).toBe(true);
    expect(isValidCode("e0001")).toBe(false);
    expect(CODE_PATTERN.test("F01")).toBe(true);
  });
});
