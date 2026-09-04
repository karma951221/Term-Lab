import { describe, expect, it } from "vitest";

import type { Expr, Ref } from "./ast";
import { refPath } from "./ast";
import { format } from "./format";
import { parse } from "./parser";

function ast(src: string): Expr {
  const r = parse(src);
  if (!r.ok) throw new Error(`파싱 실패: ${JSON.stringify(r.rejection)}`);
  return r.value;
}

describe("format — AST → 소스 문자열", () => {
  it("리터럴을 소스 표기 그대로 찍는다", () => {
    expect(format(ast("'a\\'b'"))).toBe("'a\\'b'");
    expect(format(ast("-2.5"))).toBe("-2.5");
    expect(format(ast("true"))).toBe("true");
    expect(format(ast("d'2026-01-01'"))).toBe("d'2026-01-01'");
  });

  it("참조는 코드 경로로 찍는다", () => {
    expect(format(ast("cov_pay.exempt"))).toBe("cov_pay.exempt");
    expect(format(ast("builtin.benefit.name"))).toBe("builtin.benefit.name");
    expect(format(ast("exist(attr.renew)"))).toBe("exist(attr.renew)");
  });

  it("≠ 로 정규화된 연산자는 ≠ 로 찍는다", () => {
    expect(format(ast("a != 1"))).toBe("a ≠ 1");
  });

  it("우선순위가 낮은 자식만 괄호로 감싼다", () => {
    expect(format(ast("(a or b) and c"))).toBe("(a or b) and c");
    expect(format(ast("a or b and c"))).toBe("a or b and c");
    expect(format(ast("not (a = b)"))).toBe("not (a = b)");
    expect(format(ast("not a = b"))).toBe("not a = b");
    expect(format(ast("a and (b and c)"))).toBe("a and (b and c)");
    expect(format(ast("a and b and c"))).toBe("a and b and c");
  });

  it("표시명 변환 훅을 주면 참조 자리에 표시명을 찍는다", () => {
    const names: Record<string, string> = {
      "cov_pay.exempt": "보험금지급.면책여부",
      "attr.renew": "갱신유형",
    };
    const displayName = (ref: Ref) => names[refPath(ref)] ?? refPath(ref);
    expect(format(ast("any(cov_pay.exempt) and attr.renew = 'r'"), displayName)).toBe(
      "any(보험금지급.면책여부) and 갱신유형 = 'r'",
    );
  });

  it("parse(format(parse(s))) 는 parse(s) 와 같다", () => {
    const sources = [
      "a",
      "not not a",
      "a = 'x' and (b ≠ 2 or not c) or d'2026-12-31' <= e.f",
      "count(builtin.plan.name) > 1 and any(cov_pay.exempt) and notexist(attr.add)",
      "exist(attr.renew) and attr.renew = 'renewable'",
      "(a or b) and (c or d)",
      "a or (b or c)",
      "'it\\'s' = x",
      "-1 < sum(pay.rate)",
    ];
    for (const s of sources) {
      const once = ast(s);
      expect(ast(format(once))).toEqual(once);
    }
  });
});
