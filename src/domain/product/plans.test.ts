import { describe, expect, it } from "vitest";

import type { Discriminator } from "../catalog";
import { planOptionLabel, validateNewPlanOption, validatePlanCombination, validatePlanType } from "./plans";
import type { PlanOption } from "./types";

const productId = "p1";
const waiver: Discriminator = { kind: "struct", code: "D0010", label: "납입면제유형", description: "", level: "plan", alwaysExposed: false, fields: [] };
const disclosure: Discriminator = { kind: "scalar", code: "D0002", label: "고지유형", description: "", level: "product", alwaysExposed: true, type: { kind: "enum", enumCode: "E0001" } };
const coverageStruct: Discriminator = { kind: "struct", code: "D0020", label: "보험금지급", description: "", level: "benefit", alwaysExposed: true, fields: [] };

function opt(id: string, axis: PlanOption["axis"], number: number, name: string, planTypeCode: string): PlanOption {
  return { id, productId, axis, number, name, planTypeCode };
}

const type1 = opt("t1", "type", 1, "보험료 납입면제 미적용형", "D0010");
const type2 = opt("t2", "type", 2, "보험료 납입면제형", "D0010");
const form1 = opt("f1", "form", 1, "해약환급금지급형", "D0011");
const form2 = opt("f2", "form", 2, "해약환급금미지급형", "D0011");
const form4 = opt("f4", "form", 4, "계약전환형", "D0012");

describe("세목구성 S2 · S4 — 세목유형 = plan 레벨 구조체 구분자", () => {
  it("plan 레벨 구조체는 세목유형이 된다", () => {
    expect(validatePlanType(waiver)).toEqual([]);
  });
  it("고지유형(상품 레벨 enum)은 세목유형이 아니다 · 없는 코드 · 다른 레벨 구조체도 거부", () => {
    expect(validatePlanType(disclosure).map((i) => i.kind)).toEqual(["typeMismatch"]);
    expect(validatePlanType(undefined).map((i) => i.kind)).toEqual(["brokenRef"]);
    expect(validatePlanType(coverageStruct)).toHaveLength(1);
  });
});

describe("세목구성 S2 — 종·형 축 선택지 (ADR-0006)", () => {
  it("종 축에 1종·2종(납입면제유형), 형 축에 1형·2형(무저해지)·4형(계약전환형) — 여러 유형이 한 축에 공존", () => {
    expect(validateNewPlanOption({ axis: "type", number: 1, name: type1.name, planTypeCode: "D0010" }, [])).toEqual([]);
    expect(validateNewPlanOption({ axis: "form", number: 4, name: "계약전환형", planTypeCode: "D0012" }, [type1, type2, form1, form2])).toEqual([]);
  });

  it("한 유형은 한 축에만 — 종 축에 걸린 납입면제유형을 형 축 선택지로 다시 걸면 거부", () => {
    const issues = validateNewPlanOption({ axis: "form", number: 3, name: "x", planTypeCode: "D0010" }, [type1, type2, form1]);
    expect(issues.map((i) => i.kind)).toEqual(["typeMismatch"]);
    expect(issues[0].message).toContain("한 축");
  });

  it("같은 축 번호 중복 거부 · 번호는 1 이상 정수 필수 (D-P5-10) · 빈 이름 거부 · 종·형 아닌 축 거부", () => {
    expect(validateNewPlanOption({ axis: "type", number: 1, name: "y", planTypeCode: "D0010" }, [type1])).toHaveLength(1);
    expect(validateNewPlanOption({ axis: "type", number: 0, name: "y", planTypeCode: "D0010" }, [])).toHaveLength(1);
    expect(validateNewPlanOption({ axis: "type", number: 1.5, name: "y", planTypeCode: "D0010" }, [])).toHaveLength(1);
    expect(validateNewPlanOption({ axis: "type", number: 3, name: " ", planTypeCode: "D0010" }, [])).toHaveLength(1);
    expect(validateNewPlanOption({ axis: "grade" as never, number: 1, name: "y", planTypeCode: "D0010" }, [])).toHaveLength(1);
  });

  it("번호 변경 시 자기 자신은 중복 검사에서 제외한다", () => {
    expect(validateNewPlanOption({ ...type1, number: 1 }, [type1, type2], type1.id)).toEqual([]);
    expect(validateNewPlanOption({ ...type1, number: 2 }, [type1, type2], type1.id)).toHaveLength(1);
  });

  it("문면 표기 — 번호 + 이름 병기: 제2종(보험료 납입면제형)", () => {
    expect(planOptionLabel(type2)).toBe("제2종(보험료 납입면제형)");
    expect(planOptionLabel(form4)).toBe("제4형(계약전환형)");
  });
});

describe("세목구성 S3 · S5 — 유효 조합 명시 등록 (카테시안 아님)", () => {
  const all = [type1, type2, form1, form2, form4];

  it("(1종,1형)·(2종,1형)·(2종,4형) 등록 — 축마다 하나씩, 유형이 엇갈려도 성립", () => {
    expect(validatePlanCombination(["t1", "f1"], all, [])).toEqual({ ok: true, value: [type1, form1] });
    expect(validatePlanCombination(["f4", "t2"], all, []).ok).toBe(true);
  });

  it("사용 중인 축(형)에서 선택 누락 · 같은 축 두 개 · 없는 선택지 → invalid", () => {
    expect(validatePlanCombination(["t1"], all, []).ok).toBe(false);
    expect(validatePlanCombination(["t1", "t2"], all, []).ok).toBe(false);
    expect(validatePlanCombination(["t1", "f1", "f2"], all, []).ok).toBe(false);
    expect(validatePlanCombination(["t1", "zzz"], all, []).ok).toBe(false);
  });

  it("같은 축 번호 구성의 중복 등록은 거부 (D-P5-11) — 순서가 달라도 같은 조합", () => {
    const registered = [{ id: "pl1", productId, options: [type1, form1] }];
    const r = validatePlanCombination(["f1", "t1"], all, registered);
    expect(r).toEqual({ ok: false, rejection: { reason: "duplicate", what: "상품세목 조합 (제1종, 제1형)" } });
  });

  it("종 축만 쓰는 상품은 조합이 종 번호 하나로 구성된다", () => {
    expect(validatePlanCombination(["t2"], [type1, type2], [])).toEqual({ ok: true, value: [type2] });
  });

  it("0종 0형 상품 — 선택지가 없으면 빈 조합은 등록할 수 없다 (조합 0건이 정상 상태)", () => {
    expect(validatePlanCombination([], [], []).ok).toBe(false);
  });
});
