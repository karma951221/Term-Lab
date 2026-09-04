import { describe, expect, it } from "vitest";

import { entered } from "../types";
import type { Code } from "../types";
import { checkCondition, evaluate, extractRefs, format, isAliasExpression, parse, refPath } from "./index";
import type { EvalContext, ExprType, Ref } from "./index";

/**
 * 관통 시나리오 — 파서 → 참조 추출 → 타입 검사 → 평가를 한 흐름으로.
 * 다른 에이전트(B2 공용조항 · B3 문면 · C2 조립)가 이 모듈을 쓰는 방식의 본보기다.
 */
describe("식 언어 관통", () => {
  const src = "any(cov_pay.exempt) and (notexist(attr.add) or attr.add = 'plus')";

  const types: Record<string, ExprType> = {
    "cov_pay.exempt": { kind: "boolean" },
    "attr.add": { kind: "attribute", validValues: ["base", "plus"] },
  };

  const benefit = (exempt: boolean): EvalContext => ({
    coordinate: { articleTitle: "급부" },
    lookup: (ref) => (refPath(ref) === "cov_pay.exempt" ? { kind: "slot", slot: entered(exempt) } : { kind: "missing" }),
    attribute: () => ({ kind: "unused" }),
    children: () => undefined,
  });

  const productCoverage = (add: Code | undefined, exempts: boolean[]): EvalContext => ({
    coordinate: { document: "special", ownerName: "일반상해사망" },
    lookup: () => ({ kind: "undetermined" }),
    attribute: (code) => (code === "add" && add !== undefined ? { kind: "value", value: add } : { kind: "unused" }),
    children: (ref) => (refPath(ref) === "cov_pay.exempt" ? exempts.map(benefit) : undefined),
  });

  it("공용조항 정의 저장: 파싱 → 요구 구분자 추출 → 별칭형 아님 → 조건 타입 통과", () => {
    const parsed = parse(src);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(extractRefs(parsed.value).map((r) => [r.path, r.aggregate])).toEqual([
      ["cov_pay.exempt", "any"],
      ["attr.add", "notexist"],
      ["attr.add", undefined],
    ]);
    expect(isAliasExpression(parsed.value)).toBe(false);
    expect(checkCondition(parsed.value, (ref: Ref) => types[refPath(ref)]).ok).toBe(true);
  });

  it("조립: 상품담보 문맥에서 평가한다", () => {
    const parsed = parse(src);
    if (!parsed.ok) throw new Error("파싱 실패");
    expect(evaluate(parsed.value, productCoverage("plus", [false, true]))).toEqual({ kind: "value", value: true });
    expect(evaluate(parsed.value, productCoverage("base", [false, true]))).toEqual({ kind: "value", value: false });
    expect(evaluate(parsed.value, productCoverage(undefined, [true]))).toEqual({ kind: "value", value: true });
    expect(evaluate(parsed.value, productCoverage("plus", [false]))).toEqual({ kind: "value", value: false });
  });

  it("편집기: 표시명으로 보여주고 다시 코드로 저장한다", () => {
    const parsed = parse(src);
    if (!parsed.ok) throw new Error("파싱 실패");
    const names: Record<string, string> = { "cov_pay.exempt": "보험금지급.면책여부", "attr.add": "부가유형" };
    expect(format(parsed.value, (ref) => names[refPath(ref)] ?? refPath(ref))).toBe(
      "any(보험금지급.면책여부) and (notexist(부가유형) or 부가유형 = 'plus')",
    );
    expect(format(parsed.value)).toBe(src);
  });
});
