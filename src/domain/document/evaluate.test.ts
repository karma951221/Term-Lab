import { describe, expect, it } from "vitest";

import type { EvalContext, LookupResult } from "../expression";
import type { Value } from "../types";
import { nodeBuilders, sequentialIds } from "./builders";
import { surgeryFixture } from "./fixture";
import { preEvaluate } from "./evaluate";

/**
 * 담보 마스터 편집 문맥 흉내 (B1 의 masterEvalContext 자리) —
 * 담보 레벨 값은 주어진 대로, 상품 레벨(D0002)·담보속성은 미결, 급부 집계는 하위 문맥 열거.
 */
function masterContext(values: Record<string, Value | "notEntered">, benefits: Record<string, Value>[] = []): EvalContext {
  const lookup = (path: string): LookupResult => {
    if (path.startsWith("D0002")) return { kind: "undetermined" };
    const v = values[path];
    if (v === undefined) return { kind: "missing" };
    if (v === "notEntered") return { kind: "slot", slot: { entered: false } };
    return { kind: "slot", slot: { entered: true, value: v } };
  };
  const benefitCtx = (vals: Record<string, Value>): EvalContext => ({
    lookup: (ref) => {
      const path = ref.kind === "discriminator" ? (ref.field ? `${ref.code}.${ref.field}` : ref.code) : "";
      const v = vals[path];
      return v === undefined ? { kind: "missing" } : { kind: "slot", slot: { entered: true, value: v } };
    },
    attribute: () => ({ kind: "undetermined" }),
    children: () => undefined,
  });
  return {
    lookup: (ref) => lookup(ref.kind === "discriminator" ? (ref.field ? `${ref.code}.${ref.field}` : ref.code) : `builtin`),
    attribute: () => ({ kind: "undetermined" }),
    children: (ref) => (ref.kind === "discriminator" && ref.code === "D0003" ? benefits.map(benefitCtx) : undefined),
    coordinate: { document: "coverageMaster", ownerId: "cov-surgery" },
  };
}

function states(doc: Parameters<typeof preEvaluate>[0], ctx: EvalContext) {
  const r = preEvaluate(doc, ctx);
  return Object.fromEntries([...r.branches].map(([id, s]) => [id, s.state]));
}

describe("사전평가 S1 — 담보 마스터 값으로 안 타는 분기 톤다운", () => {
  it("갱신여부 = false 면 「최초계약일」 쪽·보험기간 조 가지는 notTaken, else 쪽은 taken", () => {
    const { special } = surgeryFixture();
    const ctx = masterContext({ D0001: false, D0004: "2.5%", D0005: true }, [{ "D0003.F01": true, "D0003.F02": 100 }]);
    const s = states(special, ctx);
    expect(s["s-inl-renew-if"]).toBe("notTaken");
    expect(s["s-inl-renew-else"]).toBe("taken");
    expect(s["s-cond-term-if"]).toBe("notTaken");
    expect(s["s-cond-exempt-if"]).toBe("taken");
  });

  it("마스터 값을 true 로 바꾸면 톤다운이 반대로 뒤집힌다", () => {
    const { special } = surgeryFixture();
    const ctx = masterContext({ D0001: true, D0004: "2.5%", D0005: false });
    const s = states(special, ctx);
    expect(s["s-inl-renew-if"]).toBe("taken");
    expect(s["s-inl-renew-else"]).toBe("notTaken");
    expect(s["s-cond-term-if"]).toBe("taken");
    expect(s["s-cond-exempt-if"]).toBe("notTaken");
  });

  it("슬롯 값 맵 — const 「평균공시이율」 값이 실린다", () => {
    const { special } = surgeryFixture();
    const r = preEvaluate(special, masterContext({ D0001: true, D0004: "2.5%", D0005: false }));
    expect(r.slots.get("s-slot-rate")).toEqual({ kind: "value", value: "2.5%" });
  });
});

describe("사전평가 S2 — 미입력 값을 읽는 분기는 미결이 아니라 오류로 드러난다 (조용한 false 없음)", () => {
  it("미입력 참조 → error + notEntered 이슈(좌표) · 값이 들어오면 taken/notTaken 으로 갈린다", () => {
    const { special } = surgeryFixture();
    const r = preEvaluate(special, masterContext({ D0001: "notEntered", D0004: "2.5%", D0005: false }));
    expect(r.branches.get("s-cond-term-if")).toMatchObject({ state: "error", issue: { kind: "notEntered" } });
    expect(r.branches.get("s-cond-term-if")?.issue?.at).toMatchObject({
      document: "coverageMaster",
      ownerId: "cov-surgery",
      nodePath: ["s-doc", "s-cond-term", "s-cond-term-if"],
      refPath: "D0001",
    });
    expect(r.issues.map((i) => i.kind)).toContain("notEntered");
  });
});

describe("사전평가 S3 — 상품 레벨·담보속성 조건은 미결", () => {
  it("상품 레벨(D0002)·담보속성 조건은 undetermined — 뒤따르는 가지(else 포함)도 미결", () => {
    const b = nodeBuilders(sequentialIds("n"));
    const doc = b.document("d", [
      b.condBlock([
        b.branch("D0002 = 'V01'", [b.article("a", [])]), // 가지 n2
        b.branch("attr.renew_type = 'renew'", [b.article("b", [])]), // 가지 n4
        b.branch(undefined, [b.article("c", [])]), // 가지 n6
      ]),
    ]);
    const r = preEvaluate(doc, masterContext({}));
    expect(r.branches.get("n2")).toMatchObject({ state: "undetermined", reason: "D0002" });
    expect(r.branches.get("n4")?.state).toBe("undetermined");
    expect(r.branches.get("n6")?.state).toBe("undetermined");
  });

  it("앞 가지가 taken 이면 뒤 가지는 평가 없이 notTaken · 앞이 false 고 뒤가 미결이면 else 도 미결", () => {
    const b = nodeBuilders(sequentialIds("n"));
    const doc = b.document("d", [
      b.condBlock([
        b.branch("D0001 = true", [b.article("a", [])]), // 가지 n2
        b.branch("D0002 = 'V01'", [b.article("b", [])]), // 가지 n4
        b.branch(undefined, [b.article("c", [])]), // 가지 n6
      ]),
    ]);
    const taken = preEvaluate(doc, masterContext({ D0001: true }));
    expect([taken.branches.get("n2")?.state, taken.branches.get("n4")?.state, taken.branches.get("n6")?.state]).toEqual(["taken", "notTaken", "notTaken"]);
    const und = preEvaluate(doc, masterContext({ D0001: false }));
    expect([und.branches.get("n2")?.state, und.branches.get("n4")?.state, und.branches.get("n6")?.state]).toEqual(["notTaken", "undetermined", "undetermined"]);
  });

  it("문법 오류 조건식은 error(syntax) · 그 뒤 가지는 미결", () => {
    const b = nodeBuilders(sequentialIds("n"));
    const doc = b.document("d", [b.condBlock([b.branch("D0001 = =", [b.article("a", [])]), b.branch(undefined, [])])]);
    const r = preEvaluate(doc, masterContext({ D0001: true }));
    expect(r.branches.get("n2")).toMatchObject({ state: "error", issue: { kind: "syntax" } }); // 가지 n2 · else 가지 n3
    expect(r.branches.get("n3")?.state).toBe("undetermined");
  });

  it("톤다운된 가지 안의 중첩 조건도 독립적으로 평가된다 (톤다운은 잠금이 아니다 — 사전평가 S4)", () => {
    const b = nodeBuilders(sequentialIds("n"));
    const doc = b.document("d", [
      b.condBlock([b.branch("D0001 = true", [b.condBlock([b.branch("D0005 = true", [b.article("a", [])])])])]), // 안 가지 n2 · 바깥 가지 n4
    ]);
    const r = preEvaluate(doc, masterContext({ D0001: false, D0005: true }));
    expect(r.branches.get("n4")?.state).toBe("notTaken");
    expect(r.branches.get("n2")?.state).toBe("taken");
  });
});
