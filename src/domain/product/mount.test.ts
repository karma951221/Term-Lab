import { describe, expect, it } from "vitest";

import { combinationKey, diffStructure, normalizeSelections, validateSelections } from "./mount";
import type { AttributeKind, CoverageTree, SnapshotNode } from "./types";

const renewal: AttributeKind = {
  code: "A0001",
  label: "갱신유형",
  order: 1,
  values: [{ code: "V01", label: "갱신형", order: 0, naming: { prefix: "갱신형" } }],
};
const addon: AttributeKind = {
  code: "A0002",
  label: "부가유형",
  order: 0,
  values: [
    { code: "V01", label: "기본", order: 0, naming: {} },
    { code: "V02", label: "추가", order: 1, naming: { suffix: "추가" } },
  ],
};
const kinds = [renewal, addon];

describe("담보속성탑재 S2 — 상품담보 = 담보 × 담보속성 값 조합 (sparse · 유일)", () => {
  it("선택은 종류 order 순으로 정규화된다 — 조합 키는 순서와 무관하게 같다", () => {
    const a = normalizeSelections(
      [
        { kindCode: "A0001", valueCode: "V01" },
        { kindCode: "A0002", valueCode: "V02" },
      ],
      kinds,
    );
    expect(a.map((s) => s.kindCode)).toEqual(["A0002", "A0001"]);
    expect(combinationKey("cov1", a)).toBe(
      combinationKey("cov1", [
        { kindCode: "A0002", valueCode: "V02" },
        { kindCode: "A0001", valueCode: "V01" },
      ]),
    );
    expect(combinationKey("cov1", [])).toBe("cov1|");
    expect(combinationKey("cov1", [])).not.toBe(combinationKey("cov1", [{ kindCode: "A0002", valueCode: "V02" }]));
  });

  it("없는 종류 · 없는 값 · 같은 종류 두 번 → invalid", () => {
    expect(validateSelections([{ kindCode: "A0009", valueCode: "V01" }], kinds).map((i) => i.kind)).toEqual(["brokenRef"]);
    expect(validateSelections([{ kindCode: "A0001", valueCode: "V09" }], kinds).map((i) => i.kind)).toEqual(["brokenRef"]);
    expect(
      validateSelections(
        [
          { kindCode: "A0002", valueCode: "V01" },
          { kindCode: "A0002", valueCode: "V02" },
        ],
        kinds,
      ),
    ).toHaveLength(1);
    expect(validateSelections([], kinds)).toEqual([]);
  });
});

describe("ADR-0002 — 스냅샷 구조 대조 (마스터 트리 ↔ 스냅샷 노드)", () => {
  const tree: CoverageTree = {
    id: "cov1",
    name: "수술비",
    subCoverages: [
      { id: "s1", name: "1종수술", order: 0, benefits: [{ id: "b1", name: "1종수술급부", order: 0 }] },
      { id: "s2", name: "2종수술", order: 1, benefits: [{ id: "b2", name: "2종수술급부", order: 0 }] },
    ],
  };

  it("빈 스냅샷에 대조하면 트리 전부가 추가 대상이다 (세부보장 먼저, 급부는 부모 마스터 id 를 안다)", () => {
    const d = diffStructure(tree, []);
    expect(d.add.map((n) => [n.kind, n.masterNodeId, n.parentMasterId])).toEqual([
      ["sub", "s1", undefined],
      ["benefit", "b1", "s1"],
      ["sub", "s2", undefined],
      ["benefit", "b2", "s2"],
    ]);
    expect(d.remove).toEqual([]);
  });

  it("마스터에 노드가 추가되면 스냅샷에 빈 대응 노드가 생기고, 사라진 노드는 삭제 대상 · 이름/순서 변경은 갱신", () => {
    const nodes: SnapshotNode[] = [
      { id: "n1", productCoverageId: "pc1", kind: "sub", masterNodeId: "s1", name: "1종수술(구)", order: 0 },
      { id: "n2", productCoverageId: "pc1", kind: "benefit", masterNodeId: "b1", parentId: "n1", name: "1종수술급부", order: 0 },
      { id: "n3", productCoverageId: "pc1", kind: "sub", masterNodeId: "s9", name: "옛 세부보장", order: 1 },
      { id: "n4", productCoverageId: "pc1", kind: "benefit", masterNodeId: "b9", parentId: "n3", name: "옛 급부", order: 0 },
    ];
    const d = diffStructure(tree, nodes);
    expect(d.add.map((n) => n.masterNodeId)).toEqual(["s2", "b2"]);
    expect(d.remove.map((n) => n.id).sort()).toEqual(["n3", "n4"]);
    expect(d.update).toEqual([{ id: "n1", name: "1종수술", order: 0 }]);
  });

  it("완전히 일치하면 아무것도 바뀌지 않는다", () => {
    const nodes: SnapshotNode[] = [
      { id: "n1", productCoverageId: "pc1", kind: "sub", masterNodeId: "s1", name: "1종수술", order: 0 },
      { id: "n2", productCoverageId: "pc1", kind: "benefit", masterNodeId: "b1", parentId: "n1", name: "1종수술급부", order: 0 },
      { id: "n3", productCoverageId: "pc1", kind: "sub", masterNodeId: "s2", name: "2종수술", order: 1 },
      { id: "n4", productCoverageId: "pc1", kind: "benefit", masterNodeId: "b2", parentId: "n3", name: "2종수술급부", order: 0 },
    ];
    expect(diffStructure(tree, nodes)).toEqual({ add: [], remove: [], update: [] });
  });
});
