import { describe, expect, it } from "vitest";

import {
  addBenefit,
  addSubCoverage,
  cascadeNames,
  createCoverageTree,
  descendants,
  findBenefit,
  findSubCoverage,
  nodeName,
  nodesOf,
  removeBenefit,
  removeSubCoverage,
  renameBenefit,
  renameCoverage,
  renameSubCoverage,
  reorderBenefits,
  reorderSubCoverages,
} from "./tree";
import type { Coverage } from "./types";

/** 테스트용 id 발급 — 순번 문자열. */
function ids() {
  let n = 0;
  return () => `id-${++n}`;
}

function unwrap<T>(r: { ok: true; value: T } | { ok: false; rejection: unknown }): T {
  if (!r.ok) throw new Error(`기대: ok, 실제: ${JSON.stringify(r.rejection)}`);
  return r.value;
}

function rejection(r: { ok: boolean; rejection?: unknown }) {
  if (r.ok) throw new Error("기대: 거부, 실제: ok");
  return r.rejection as { reason: string; what?: string };
}

describe("담보트리 S1 — 단순 담보 생성 (일반상해사망)", () => {
  it("담보 생성은 세부보장 1·급부 1 을 함께 만들어 3층 최소 사례로 저장된다 (D-P2-1)", () => {
    const tree = unwrap(
      createCoverageTree(
        { name: "일반상해사망", subCoverageName: "일반상해사망", benefitName: "일반상해사망보험금" },
        ids(),
        [],
      ),
    );
    expect(tree.name).toBe("일반상해사망");
    expect(tree.subCoverages).toHaveLength(1);
    expect(tree.subCoverages[0].name).toBe("일반상해사망");
    expect(tree.subCoverages[0].order).toBe(0);
    expect(tree.subCoverages[0].benefits).toHaveLength(1);
    expect(tree.subCoverages[0].benefits[0].name).toBe("일반상해사망보험금");
    expect(tree.description).toBe("");
    expect(tree.documentId).toBeUndefined();
  });

  it("세부보장명·급부명을 주지 않으면 담보명을 기본 이름으로 쓴다 (D-P2-1)", () => {
    const tree = unwrap(createCoverageTree({ name: "수술비" }, ids(), []));
    expect(tree.subCoverages[0].name).toBe("수술비");
    expect(tree.subCoverages[0].benefits[0].name).toBe("수술비");
  });

  it("담보명은 비울 수 없고, 담보 마스터 전역에서 중복 금지다 (D-P2-2)", () => {
    expect(rejection(createCoverageTree({ name: "  " }, ids(), [])).reason).toBe("invalid");
    expect(rejection(createCoverageTree({ name: "수술비" }, ids(), ["수술비"]))).toEqual({
      reason: "duplicate",
      what: "담보명 「수술비」",
    });
  });
});

describe("담보트리 S2 — 수술비 담보 구성 (세부보장 7개)", () => {
  it("세부보장을 순서대로 추가하면 각 급부 1개를 갖고 형제 맨 뒤에 붙는다", () => {
    const newId = ids();
    let tree = unwrap(createCoverageTree({ name: "수술비", subCoverageName: "1종수술", benefitName: "수술보험금" }, newId, []));
    for (const n of ["2종수술", "3종수술", "4종수술", "5종수술", "6종수술", "7종수술"]) {
      tree = unwrap(addSubCoverage(tree, { name: n, benefitName: "수술보험금" }, newId));
    }
    expect(tree.subCoverages.map((s) => s.name)).toEqual([
      "1종수술",
      "2종수술",
      "3종수술",
      "4종수술",
      "5종수술",
      "6종수술",
      "7종수술",
    ]);
    expect(tree.subCoverages.map((s) => s.order)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(tree.subCoverages.every((s) => s.benefits.length === 1 && s.benefits[0].name === "수술보험금")).toBe(true);
  });

  it("급부 추가는 세부보장의 형제 맨 뒤에 붙는다", () => {
    const newId = ids();
    let tree = unwrap(createCoverageTree({ name: "수술비", subCoverageName: "1종수술", benefitName: "수술보험금" }, newId, []));
    const sub = tree.subCoverages[0];
    tree = unwrap(addBenefit(tree, sub.id, "입원보험금", newId));
    expect(tree.subCoverages[0].benefits.map((b) => [b.name, b.order])).toEqual([
      ["수술보험금", 0],
      ["입원보험금", 1],
    ]);
  });

  it("없는 세부보장에 급부를 추가하면 notFound", () => {
    const tree = unwrap(createCoverageTree({ name: "수술비" }, ids(), []));
    expect(rejection(addBenefit(tree, "no-such", "x", ids())).reason).toBe("notFound");
  });
});

describe("담보트리 S3 — 형제 간 이름 중복 금지", () => {
  function surgery(): Coverage {
    const newId = ids();
    let tree = unwrap(createCoverageTree({ name: "수술비", subCoverageName: "1종수술" }, newId, []));
    tree = unwrap(addSubCoverage(tree, { name: "2종수술" }, newId));
    return tree;
  }

  it("같은 담보에 동명 세부보장 추가 시도 → 거부, 형제 이름 중복 사유", () => {
    expect(rejection(addSubCoverage(surgery(), { name: "1종수술" }, ids()))).toEqual({
      reason: "duplicate",
      what: "세부보장명 「1종수술」",
    });
  });

  it("기존 세부보장 「2종수술」의 이름을 「1종수술」로 변경 시도 → 같은 이유로 거부", () => {
    const tree = surgery();
    const two = tree.subCoverages[1];
    expect(rejection(renameSubCoverage(tree, two.id, "1종수술")).reason).toBe("duplicate");
    // 자기 이름 그대로는 허용
    expect(unwrap(renameSubCoverage(tree, two.id, "2종수술")).subCoverages[1].name).toBe("2종수술");
    expect(unwrap(renameSubCoverage(tree, two.id, "이종수술")).subCoverages[1].name).toBe("이종수술");
  });

  it("다른 담보(일반상해사망)에 세부보장 「1종수술」 추가 → 허용 (중복 금지는 형제 간에만)", () => {
    const other = unwrap(createCoverageTree({ name: "일반상해사망" }, ids(), ["수술비"]));
    expect(unwrap(addSubCoverage(other, { name: "1종수술" }, ids())).subCoverages).toHaveLength(2);
  });

  it("급부 레벨도 동일 — 한 세부보장 안 급부끼리만 이름 중복 금지", () => {
    const newId = ids();
    let tree = surgery();
    const [one, two] = tree.subCoverages;
    expect(rejection(addBenefit(tree, one.id, "수술비", newId)).reason).toBe("duplicate"); // 기본 급부명 = 담보명
    tree = unwrap(addBenefit(tree, one.id, "입원보험금", newId));
    tree = unwrap(addBenefit(tree, two.id, "입원보험금", newId)); // 다른 세부보장 아래 동명 허용
    expect(rejection(renameBenefit(tree, one.id, tree.subCoverages[0].benefits[1].id, "수술비")).reason).toBe("duplicate");
    expect(unwrap(renameBenefit(tree, one.id, tree.subCoverages[0].benefits[1].id, "통원보험금")).subCoverages[0].benefits[1].name).toBe("통원보험금");
  });

  it("담보명 변경도 전역 중복 금지 — 자기 이름은 제외", () => {
    const tree = surgery();
    expect(rejection(renameCoverage(tree, "일반상해사망", ["수술비", "일반상해사망"])).reason).toBe("duplicate");
    expect(unwrap(renameCoverage(tree, "수술비", ["수술비"])).name).toBe("수술비");
    expect(unwrap(renameCoverage(tree, "수술비특약", ["수술비"])).name).toBe("수술비특약");
  });
});

describe("담보트리 S4 — 순서는 데이터다", () => {
  it("세부보장 순서를 재배열하면 형제 order 가 새 순서를 그대로 따른다 (7종수술을 맨 앞으로)", () => {
    const newId = ids();
    let tree = unwrap(createCoverageTree({ name: "수술비", subCoverageName: "1종수술" }, newId, []));
    for (const n of ["2종수술", "3종수술", "4종수술", "5종수술", "6종수술", "7종수술"]) {
      tree = unwrap(addSubCoverage(tree, { name: n }, newId));
    }
    const idsInOrder = tree.subCoverages.map((s) => s.id);
    const seventh = idsInOrder[6];
    const reordered = unwrap(reorderSubCoverages(tree, [seventh, ...idsInOrder.slice(0, 6)]));
    expect(reordered.subCoverages.map((s) => s.name)).toEqual([
      "7종수술",
      "1종수술",
      "2종수술",
      "3종수술",
      "4종수술",
      "5종수술",
      "6종수술",
    ]);
    expect(reordered.subCoverages.map((s) => s.order)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("순서 목록에는 모든 형제 id 가 한 번씩 있어야 한다", () => {
    const newId = ids();
    let tree = unwrap(createCoverageTree({ name: "수술비" }, newId, []));
    tree = unwrap(addSubCoverage(tree, { name: "2종수술" }, newId));
    expect(rejection(reorderSubCoverages(tree, [tree.subCoverages[0].id])).reason).toBe("invalid");
    expect(rejection(reorderSubCoverages(tree, [tree.subCoverages[0].id, tree.subCoverages[0].id])).reason).toBe("invalid");
  });

  it("급부 순서 변경도 같은 규칙", () => {
    const newId = ids();
    let tree = unwrap(createCoverageTree({ name: "수술비", benefitName: "A" }, newId, []));
    const sub = tree.subCoverages[0];
    tree = unwrap(addBenefit(tree, sub.id, "B", newId));
    const [a, b] = tree.subCoverages[0].benefits;
    const r = unwrap(reorderBenefits(tree, sub.id, [b.id, a.id]));
    expect(r.subCoverages[0].benefits.map((x) => [x.name, x.order])).toEqual([
      ["B", 0],
      ["A", 1],
    ]);
  });
});

describe("담보트리 S5 — 트리 하한 삭제 거부", () => {
  it("유일한 급부 삭제 시도 → 거부 (세부보장은 급부 1개 이상)", () => {
    const tree = unwrap(createCoverageTree({ name: "일반상해사망" }, ids(), []));
    const sub = tree.subCoverages[0];
    expect(rejection(removeBenefit(tree, sub.id, sub.benefits[0].id))).toEqual({
      reason: "minimumStructure",
      what: "세부보장 「일반상해사망」의 마지막 급부",
    });
  });

  it("유일한 세부보장 삭제 시도 → 거부 (담보는 세부보장 1개 이상)", () => {
    const tree = unwrap(createCoverageTree({ name: "일반상해사망" }, ids(), []));
    expect(rejection(removeSubCoverage(tree, tree.subCoverages[0].id))).toEqual({
      reason: "minimumStructure",
      what: "담보 「일반상해사망」의 마지막 세부보장",
    });
  });

  it("세부보장이 7개면 6개까지 삭제 가능 — 하한은 1. 남은 형제의 order 는 다시 매긴다", () => {
    const newId = ids();
    let tree = unwrap(createCoverageTree({ name: "수술비", subCoverageName: "1종수술" }, newId, []));
    for (const n of ["2종수술", "3종수술", "4종수술", "5종수술", "6종수술", "7종수술"]) {
      tree = unwrap(addSubCoverage(tree, { name: n }, newId));
    }
    for (let i = 0; i < 6; i++) {
      tree = unwrap(removeSubCoverage(tree, tree.subCoverages[0].id));
    }
    expect(tree.subCoverages.map((s) => [s.name, s.order])).toEqual([["7종수술", 0]]);
    expect(rejection(removeSubCoverage(tree, tree.subCoverages[0].id)).reason).toBe("minimumStructure");
  });
});

describe("하위 트리 열거 헬퍼 — 식 언어 집계 · 삭제 영향에 쓴다", () => {
  function surgery() {
    const newId = ids();
    let tree = unwrap(createCoverageTree({ name: "수술비", subCoverageName: "1종수술", benefitName: "수술보험금" }, newId, []));
    tree = unwrap(addSubCoverage(tree, { name: "2종수술", benefitName: "수술보험금" }, newId));
    tree = unwrap(addBenefit(tree, tree.subCoverages[1].id, "입원보험금", newId));
    return tree;
  }

  it("descendants: 담보에서 급부 레벨 후손 = 아래 모든 급부 (형제 순서 · 세부보장 순서대로)", () => {
    const tree = surgery();
    const benefits = descendants(tree, { level: "coverage", id: tree.id }, "benefit");
    expect(benefits.map((n) => n.name)).toEqual(["수술보험금", "수술보험금", "입원보험금"]);
    const subs = descendants(tree, { level: "coverage", id: tree.id }, "subCoverage");
    expect(subs.map((n) => n.name)).toEqual(["1종수술", "2종수술"]);
  });

  it("descendants: 세부보장에서 급부 레벨 후손 = 자기 급부들뿐. 자기 레벨이면 자기 자신", () => {
    const tree = surgery();
    const two = tree.subCoverages[1];
    expect(descendants(tree, { level: "subCoverage", id: two.id }, "benefit").map((n) => n.name)).toEqual([
      "수술보험금",
      "입원보험금",
    ]);
    expect(descendants(tree, { level: "subCoverage", id: two.id }, "subCoverage").map((n) => n.id)).toEqual([two.id]);
  });

  it("descendants: 위 레벨을 물으면 빈 목록 (후손이 아니다)", () => {
    const tree = surgery();
    expect(descendants(tree, { level: "benefit", id: tree.subCoverages[0].benefits[0].id }, "coverage")).toEqual([]);
  });

  it("nodesOf 는 담보·세부보장·급부 전 노드를 깊이 우선 순서로 돌려준다", () => {
    const tree = surgery();
    expect(nodesOf(tree).map((n) => `${n.level}:${n.name}`)).toEqual([
      "coverage:수술비",
      "subCoverage:1종수술",
      "benefit:수술보험금",
      "subCoverage:2종수술",
      "benefit:수술보험금",
      "benefit:입원보험금",
    ]);
  });

  it("cascadeNames: 노드를 지우면 함께 사라지는 하위 실체의 이름 목록", () => {
    const tree = surgery();
    expect(cascadeNames(tree, { level: "subCoverage", id: tree.subCoverages[1].id })).toEqual([
      "급부 수술보험금",
      "급부 입원보험금",
    ]);
    expect(cascadeNames(tree, { level: "coverage", id: tree.id })).toEqual([
      "세부보장 1종수술",
      "급부 수술보험금",
      "세부보장 2종수술",
      "급부 수술보험금",
      "급부 입원보험금",
    ]);
    expect(cascadeNames(tree, { level: "benefit", id: tree.subCoverages[0].benefits[0].id })).toEqual([]);
  });

  it("findSubCoverage · findBenefit · nodeName", () => {
    const tree = surgery();
    const two = tree.subCoverages[1];
    expect(findSubCoverage(tree, two.id)?.name).toBe("2종수술");
    expect(findBenefit(tree, two.benefits[1].id)?.benefit.name).toBe("입원보험금");
    expect(findBenefit(tree, two.benefits[1].id)?.subCoverage.id).toBe(two.id);
    expect(nodeName(tree, { level: "benefit", id: two.benefits[1].id })).toBe("수술비 > 2종수술 > 입원보험금");
    expect(nodeName(tree, { level: "coverage", id: tree.id })).toBe("수술비");
    expect(findBenefit(tree, "nope")).toBeUndefined();
  });
});
