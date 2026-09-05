import { describe, expect, it } from "vitest";

import type { Discriminator } from "../catalog";
import { attachableDefinitions, attachedDefinitions, checkAttach, checkDetach, isAttached } from "./attachment";

/** 담보값입력 시나리오 픽스처 — 갱신유형(무조건 노출) · 수술급여기준(선택적 노출) · 급부 구조체 · 파생 · const */
const renew: Discriminator = {
  kind: "scalar",
  code: "D0001",
  label: "갱신유형",
  description: "",
  level: "coverage",
  alwaysExposed: true,
  type: { kind: "boolean" },
};
const surgeryBasis: Discriminator = {
  kind: "scalar",
  code: "D0002",
  label: "수술급여기준",
  description: "",
  level: "coverage",
  alwaysExposed: false,
  type: { kind: "string" },
  defaultValue: "약관 별표 기준",
};
const pay: Discriminator = {
  kind: "struct",
  code: "D0003",
  label: "보험금지급",
  description: "",
  level: "benefit",
  alwaysExposed: false,
  fields: [
    { code: "F01", label: "면책여부", type: { kind: "boolean" }, order: 0 },
    { code: "F02", label: "지급률", type: { kind: "number" }, order: 1 },
  ],
};
const exemptAny: Discriminator = {
  kind: "derived",
  code: "D0004",
  label: "면책여부합",
  description: "",
  level: "coverage",
  expression: "any(D0003.F01)",
};
const avgRate: Discriminator = { kind: "const", code: "D0005", label: "평균공시이율", description: "", value: "2.5%" };
const notice: Discriminator = {
  kind: "scalar",
  code: "D0006",
  label: "고지유형",
  description: "",
  level: "product",
  alwaysExposed: false,
  type: { kind: "string" },
};
const defs = [renew, surgeryBasis, pay, exemptAny, avgRate, notice];

function rejection(r: { ok: boolean; rejection?: unknown }) {
  if (r.ok) throw new Error("기대: 거부, 실제: ok");
  return r.rejection as { reason: string; what?: string; issues?: { kind: string }[] };
}

describe("담보값입력 S1 — 무조건 노출 구분자의 자동 표시", () => {
  it("무조건 노출 구분자는 부착 조작 없이 그 레벨 모든 실체에 부착된 것으로 본다", () => {
    expect(isAttached(renew, new Set())).toBe(true);
    expect(attachedDefinitions("coverage", defs, new Set()).map((d) => d.code)).toEqual(["D0001"]);
  });

  it("무조건 노출 구분자는 + 버튼 목록(부착 가능 구분자)에 나타나지 않는다", () => {
    expect(attachableDefinitions("coverage", defs, new Set()).map((d) => d.code)).toEqual(["D0002"]);
  });

  it("무조건 노출 구분자에 대한 부착·해제 요청은 서버가 거부한다 (D-P2-9)", () => {
    expect(rejection(checkAttach(renew, "coverage", new Set())).reason).toBe("invalid");
    expect(rejection(checkDetach(renew, "coverage", new Set())).reason).toBe("invalid");
  });
});

describe("담보값입력 S2 — 선택적 노출 구분자를 + 버튼으로 부착", () => {
  it("부착 전에는 목록에 없고, 부착 후에는 부착 목록에 나타난다 (무조건 노출 다음)", () => {
    expect(isAttached(surgeryBasis, new Set())).toBe(false);
    expect(attachedDefinitions("coverage", defs, new Set(["D0002"])).map((d) => d.code)).toEqual(["D0001", "D0002"]);
    expect(attachableDefinitions("coverage", defs, new Set(["D0002"]))).toEqual([]);
  });

  it("부착 가능: 레벨이 같은 선택적 노출 구분자(scalar·struct)만. 파생·const 는 값 자리가 없어 부착 대상이 아니다", () => {
    expect(checkAttach(surgeryBasis, "coverage", new Set()).ok).toBe(true);
    expect(checkAttach(pay, "benefit", new Set()).ok).toBe(true);
    expect(rejection(checkAttach(exemptAny, "coverage", new Set())).reason).toBe("invalid");
    expect(rejection(checkAttach(avgRate, "coverage", new Set())).reason).toBe("invalid");
    expect(attachableDefinitions("coverage", defs, new Set()).map((d) => d.code)).not.toContain("D0004");
  });

  it("부착 레벨 불일치는 거부 — 급부 구조체를 담보에 붙일 수 없다", () => {
    const r = rejection(checkAttach(pay, "coverage", new Set()));
    expect(r.reason).toBe("invalid");
    expect(r.issues?.[0].kind).toBe("typeMismatch");
  });

  it("이미 부착된 구분자는 duplicate", () => {
    expect(rejection(checkAttach(surgeryBasis, "coverage", new Set(["D0002"])))).toEqual({
      reason: "duplicate",
      what: "부착 수술급여기준(D0002)",
    });
  });

  it("해제는 부착돼 있어야 한다 — 미부착 해제는 notFound", () => {
    expect(rejection(checkDetach(surgeryBasis, "coverage", new Set())).reason).toBe("notFound");
    expect(checkDetach(surgeryBasis, "coverage", new Set(["D0002"])).ok).toBe(true);
  });

  it("다른 레벨 구분자는 그 레벨의 부착 목록에 나오지 않는다 (상품 레벨 고지유형)", () => {
    expect(attachedDefinitions("coverage", defs, new Set(["D0006"])).map((d) => d.code)).toEqual(["D0001"]);
    expect(attachedDefinitions("benefit", defs, new Set(["D0003"])).map((d) => d.code)).toEqual(["D0003"]);
  });
});
