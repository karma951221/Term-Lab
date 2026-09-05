import { describe, expect, it } from "vitest";

import type { Discriminator } from "../catalog";
import { evaluate, parse, type EvalResult } from "../expression";
import { entered, NOT_ENTERED } from "../types";
import { masterCatalog, masterEvalContext, nodeEvalContext } from "./evalContext";
import { addBenefit, addSubCoverage, createCoverageTree } from "./tree";
import type { MasterValues } from "./values";

/** 관통 1 픽스처 (2차구현_계획 §5) — 갱신여부 · 보험금지급{면책여부, 지급률} · 평균공시이율 · 면책여부합 · 고지유형(상품) */
const renew: Discriminator = {
  kind: "scalar",
  code: "renew",
  label: "갱신여부",
  description: "",
  level: "coverage",
  alwaysExposed: true,
  type: { kind: "boolean" },
};
const pay: Discriminator = {
  kind: "struct",
  code: "cov_pay",
  label: "보험금지급",
  description: "",
  level: "benefit",
  alwaysExposed: true,
  fields: [
    { code: "exempt", label: "면책여부", type: { kind: "boolean" }, order: 0 },
    { code: "rate", label: "지급률", type: { kind: "number" }, order: 1 },
  ],
};
const avgRate: Discriminator = { kind: "const", code: "avg_rate", label: "평균공시이율", description: "", value: "2.5%" };
const exemptAny: Discriminator = {
  kind: "derived",
  code: "exempt_any",
  label: "면책여부합",
  description: "",
  level: "coverage",
  expression: "any(cov_pay.exempt)",
};
const notice: Discriminator = {
  kind: "scalar",
  code: "notice",
  label: "고지유형",
  description: "",
  level: "product",
  alwaysExposed: true,
  type: { kind: "string" },
};
const surgeryBasis: Discriminator = {
  kind: "scalar",
  code: "basis",
  label: "수술급여기준",
  description: "",
  level: "coverage",
  alwaysExposed: false,
  type: { kind: "string" },
};
const subNote: Discriminator = {
  kind: "scalar",
  code: "sub_note",
  label: "세부보장비고",
  description: "",
  level: "subCoverage",
  alwaysExposed: true,
  type: { kind: "string" },
};
const defs = [renew, pay, avgRate, exemptAny, notice, surgeryBasis, subNote];

let seq = 0;
const newId = () => `id-${++seq}`;
function unwrap<T>(r: { ok: true; value: T } | { ok: false; rejection: unknown }): T {
  if (!r.ok) throw new Error(`기대: ok, 실제: ${JSON.stringify(r.rejection)}`);
  return r.value;
}

/** 수술비: 1종수술{수술보험금} · 2종수술{수술보험금, 입원보험금} */
function surgery() {
  seq = 0;
  let tree = unwrap(createCoverageTree({ name: "수술비", subCoverageName: "1종수술", benefitName: "수술보험금" }, newId, []));
  tree = unwrap(addSubCoverage(tree, { name: "2종수술", benefitName: "수술보험금" }, newId));
  tree = unwrap(addBenefit(tree, tree.subCoverages[1].id, "입원보험금", newId));
  const b11 = tree.subCoverages[0].benefits[0].id;
  const [b21, b22] = tree.subCoverages[1].benefits.map((b) => b.id);
  return { tree, b11, b21, b22 };
}

function mv(slots: Record<string, Record<string, ReturnType<typeof entered> | typeof NOT_ENTERED>>, attached: Record<string, string[]> = {}): MasterValues {
  return {
    slots: new Map(Object.entries(slots).map(([id, s]) => [id, new Map(Object.entries(s))])),
    attached: new Map(Object.entries(attached).map(([id, codes]) => [id, new Set(codes)])),
  };
}

function run(src: string, ctx: ReturnType<typeof masterEvalContext>): EvalResult {
  return evaluate(unwrap(parse(src)), ctx);
}
const value = (v: unknown): EvalResult => ({ kind: "value", value: v as never });

describe("masterEvalContext — 담보 마스터 값으로 만든 평가 문맥", () => {
  it("담보 레벨 값 자리는 담보 값에서 읽힌다 · 미입력은 notEntered 오류", () => {
    const { tree } = surgery();
    const ctx = masterEvalContext(tree, mv({ [tree.id]: { renew: entered(true) } }), masterCatalog(defs));
    expect(run("renew", ctx)).toEqual(value(true));
    const ctx2 = masterEvalContext(tree, mv({}), masterCatalog(defs));
    expect(run("renew", ctx2)).toMatchObject({ kind: "error", issue: { kind: "notEntered", at: { document: "coverageMaster", ownerId: tree.id, refPath: "renew" } } });
  });

  it("집계 범위 = 부착점 하위 트리 — 담보 문맥의 any(급부.면책여부) 는 아래 모든 급부를 본다", () => {
    const { tree, b11, b21, b22 } = surgery();
    const values = mv({
      [b11]: { "cov_pay.exempt": entered(false), "cov_pay.rate": entered(100) },
      [b21]: { "cov_pay.exempt": entered(false), "cov_pay.rate": entered(50) },
      [b22]: { "cov_pay.exempt": entered(true), "cov_pay.rate": entered(30) },
    });
    const ctx = masterEvalContext(tree, values, masterCatalog(defs));
    expect(run("any(cov_pay.exempt)", ctx)).toEqual(value(true));
    expect(run("all(cov_pay.exempt)", ctx)).toEqual(value(false));
    expect(run("sum(cov_pay.rate)", ctx)).toEqual(value(180));
    expect(run("count(cov_pay.rate)", ctx)).toEqual(value(3));
  });

  it("세부보장 문맥의 집계는 자기 급부들뿐 — 세부보장 단위 조건식 (핵심 개선)", () => {
    const { tree, b11, b21, b22 } = surgery();
    const values = mv({
      [b11]: { "cov_pay.exempt": entered(true) },
      [b21]: { "cov_pay.exempt": entered(false) },
      [b22]: { "cov_pay.exempt": entered(false) },
    });
    const one = nodeEvalContext(tree, { level: "subCoverage", id: tree.subCoverages[0].id }, values, masterCatalog(defs));
    const two = nodeEvalContext(tree, { level: "subCoverage", id: tree.subCoverages[1].id }, values, masterCatalog(defs));
    expect(run("any(cov_pay.exempt)", one!)).toEqual(value(true));
    expect(run("any(cov_pay.exempt)", two!)).toEqual(value(false));
  });

  it("하위 급부 하나라도 미입력이면 집계는 오류 + 그 급부의 좌표", () => {
    const { tree, b11, b21 } = surgery();
    const values = mv({ [b11]: { "cov_pay.exempt": entered(false) }, [b21]: { "cov_pay.exempt": entered(false) } });
    const ctx = masterEvalContext(tree, values, masterCatalog(defs));
    expect(run("any(cov_pay.exempt)", ctx)).toMatchObject({
      kind: "error",
      issue: { kind: "notEntered", at: { ownerName: "수술비 > 2종수술 > 입원보험금", refPath: "cov_pay.exempt" } },
    });
  });

  it("내장 경로 builtin.<레벨>.name 은 뼈대 이름이다 — 급부 문맥은 조상 이름도 안다", () => {
    const { tree, b22 } = surgery();
    const values = mv({});
    const cov = masterEvalContext(tree, values, masterCatalog(defs));
    expect(run("builtin.coverage.name", cov)).toEqual(value("수술비"));
    expect(run("count(builtin.subCoverage.name)", cov)).toEqual(value(2));
    expect(run("count(builtin.benefit.name)", cov)).toEqual(value(2)); // distinct — 수술보험금 ×2 · 입원보험금
    const ben = nodeEvalContext(tree, { level: "benefit", id: b22 }, values, masterCatalog(defs))!;
    expect(run("builtin.benefit.name", ben)).toEqual(value("입원보험금"));
    expect(run("builtin.subCoverage.name", ben)).toEqual(value("2종수술"));
    expect(run("builtin.coverage.name = '수술비'", ben)).toEqual(value(true));
  });

  it("아래 레벨 값 자리를 집계 없이 직접 읽으면 값 자리가 없다 (notAttached) — 위 레벨 값은 조상에서 읽힌다", () => {
    const { tree, b11 } = surgery();
    const values = mv({ [tree.id]: { renew: entered(true) } });
    const cov = masterEvalContext(tree, values, masterCatalog(defs));
    expect(run("cov_pay.exempt", cov)).toMatchObject({ kind: "error", issue: { kind: "notAttached" } });
    const ben = nodeEvalContext(tree, { level: "benefit", id: b11 }, values, masterCatalog(defs))!;
    expect(run("renew", ben)).toEqual(value(true));
    expect(run("renew and builtin.subCoverage.name = '1종수술'", ben)).toEqual(value(true));
  });

  it("const 구분자는 정의의 값이다", () => {
    const { tree } = surgery();
    expect(run("avg_rate = '2.5%'", masterEvalContext(tree, mv({}), masterCatalog(defs)))).toEqual(value(true));
  });

  it("파생 구분자는 그 레벨 문맥에서 식을 평가한 값이다 — 입력이 미입력이면 파생 자리도 미입력(notEntered)", () => {
    const { tree, b11, b21, b22 } = surgery();
    const ok = mv({
      [b11]: { "cov_pay.exempt": entered(false) },
      [b21]: { "cov_pay.exempt": entered(true) },
      [b22]: { "cov_pay.exempt": entered(false) },
    });
    expect(run("exempt_any", masterEvalContext(tree, ok, masterCatalog(defs)))).toEqual(value(true));
    // 급부 문맥에서 담보 레벨 파생을 읽으면 담보 문맥(조상)에서 평가된다
    const ben = nodeEvalContext(tree, { level: "benefit", id: b11 }, ok, masterCatalog(defs))!;
    expect(run("exempt_any", ben)).toEqual(value(true));
    const partial = mv({ [b11]: { "cov_pay.exempt": entered(false) } });
    expect(run("exempt_any", masterEvalContext(tree, partial, masterCatalog(defs)))).toMatchObject({
      kind: "error",
      issue: { kind: "notEntered", at: { refPath: "exempt_any" } },
    });
  });

  it("상품 레벨 참조와 담보속성은 마스터 문맥에서 미결(undetermined)이다 — 조립 때 결정", () => {
    const { tree } = surgery();
    const ctx = masterEvalContext(tree, mv({ [tree.id]: { renew: entered(true) } }), masterCatalog(defs));
    expect(run("notice = 'V01'", ctx)).toEqual({ kind: "undetermined", reason: "notice" });
    expect(run("attr.renew_type = 'renewal'", ctx)).toEqual({ kind: "undetermined", reason: "attr.renew_type" });
    expect(run("exist(attr.renew_type)", ctx)).toEqual({ kind: "undetermined", reason: "attr.renew_type" });
    expect(run("count(notice) > 1", ctx)).toEqual({ kind: "undetermined", reason: "notice" });
    // 미결 가드 관용구 — 왼쪽이 결정되면 오른쪽은 평가하지 않는다
    expect(run("not renew or notice = 'V01'", ctx)).toEqual({ kind: "undetermined", reason: "notice" });
    expect(run("renew or notice = 'V01'", ctx)).toEqual(value(true));
  });

  it("선택적 노출 구분자는 부착된 실체에서만 값 자리가 있다 — 미부착이면 notAttached", () => {
    const { tree } = surgery();
    const detached = masterEvalContext(tree, mv({ [tree.id]: { basis: entered("x") } }), masterCatalog(defs));
    expect(run("basis", detached)).toMatchObject({ kind: "error", issue: { kind: "notAttached" } });
    const attached = masterEvalContext(tree, mv({ [tree.id]: { basis: entered("x") } }, { [tree.id]: ["basis"] }), masterCatalog(defs));
    expect(run("basis = 'x'", attached)).toEqual(value(true));
  });

  it("없는 구분자·필드 참조는 brokenRef", () => {
    const { tree } = surgery();
    const ctx = masterEvalContext(tree, mv({}), masterCatalog(defs));
    expect(run("gone", ctx)).toMatchObject({ kind: "error", issue: { kind: "brokenRef" } });
    expect(run("any(cov_pay.gone)", ctx)).toMatchObject({ kind: "error", issue: { kind: "brokenRef" } });
  });

  it("세부보장 레벨 무조건 노출 값을 담보 문맥에서 집계하면 세부보장들을 본다", () => {
    const { tree } = surgery();
    const [s1, s2] = tree.subCoverages;
    const values = mv({ [s1.id]: { sub_note: entered("a") }, [s2.id]: { sub_note: entered("a") } });
    expect(run("count(sub_note)", masterEvalContext(tree, values, masterCatalog(defs)))).toEqual(value(1));
  });

  it("nodeEvalContext 는 트리에 없는 노드면 undefined", () => {
    const { tree } = surgery();
    expect(nodeEvalContext(tree, { level: "benefit", id: "nope" }, mv({}), masterCatalog(defs))).toBeUndefined();
  });
});
