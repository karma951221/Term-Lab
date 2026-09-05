/**
 * 담보 영역 파괴적 액션의 영향(Impact) 계산 — 노드 삭제(`coverage.deleteNode`) · 부착 해제(`coverage.detach`).
 *
 * 값 행 수·cascade 는 여기서 센다. **사용처**(문면 조건식·슬롯, 요구 공용조항 참조, 파생식)는 참조
 * 역인덱스(C1 refs)가 담당하므로 `UsageSource` 인터페이스만 정의하고 주입받는다. 기본 `NO_USAGE` 는 빈 목록.
 */
import type { ValuedDiscriminator } from "../catalog";
import { valueSlotsOf } from "../catalog";
import type { Code, Coordinate, Id, Impact } from "../types";
import { cascadeNames, descendants } from "./tree";
import type { Coverage, CoverageNodeRef } from "./types";
import { slotsOfNode, type MasterValues } from "./values";

/** 사용처 질의 — 「그 담보 문맥에서 이 자리를 읽는 곳」. */
export type UsageQuery =
  /** 부착 해제 — 실체(owner)에서 구분자(discriminatorCode)를 읽는 사용처 */
  | { kind: "detach"; coverageId: Id; owner: CoverageNodeRef; discriminatorCode: Code }
  /** 노드 삭제 — 그 노드(와 하위)를 순회·참조하는 사용처 (반복문·집계·조건식) */
  | { kind: "deleteNode"; coverageId: Id; node: CoverageNodeRef };

/** 참조 역인덱스(C1 refs)가 구현한다. 결과는 깨질 참조의 좌표 목록. */
export interface UsageSource {
  findUsages(query: UsageQuery): Promise<Coordinate[]>;
}

/** 역인덱스가 아직 없을 때의 기본 구현 — 사용처 없음. */
export const NO_USAGE: UsageSource = {
  findUsages: async () => [],
};

/** 노드 삭제의 영향 — 자기와 후손 노드의 값 행 전부 + 하위 실체 이름 + 사용처. 담보 자체 삭제도 같은 결. */
export async function nodeDeleteImpact(
  tree: Coverage,
  node: CoverageNodeRef,
  values: MasterValues,
  usage: UsageSource,
): Promise<Impact> {
  const affected = [
    ...descendants(tree, node, node.level),
    ...(node.level === "coverage" ? descendants(tree, node, "subCoverage") : []),
    ...(node.level !== "benefit" ? descendants(tree, node, "benefit") : []),
  ];
  let valueRowsLost = 0;
  for (const n of affected) {
    for (const slot of slotsOfNode(values, n.id).values()) if (slot.entered) valueRowsLost++;
  }
  return {
    valueRowsLost,
    brokenRefs: await usage.findUsages({ kind: "deleteNode", coverageId: tree.id, node }),
    cascade: cascadeNames(tree, node),
  };
}

/** 부착 해제의 영향 — 그 실체의 그 정의 값 자리(구조체면 필드 전부) + 사용처. cascade 없음. */
export async function detachImpact(
  tree: Coverage,
  owner: CoverageNodeRef,
  def: ValuedDiscriminator,
  values: MasterValues,
  usage: UsageSource,
): Promise<Impact> {
  const slots = slotsOfNode(values, owner.id);
  const valueRowsLost = valueSlotsOf(def).filter((p) => slots.get(p)?.entered).length;
  return {
    valueRowsLost,
    brokenRefs: await usage.findUsages({ kind: "detach", coverageId: tree.id, owner, discriminatorCode: def.code }),
    cascade: [],
  };
}
