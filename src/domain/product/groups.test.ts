import { describe, expect, it } from "vitest";

import { sortInGroup, validateGroupTemplate } from "./groups";
import type { AttributeKind, ProductCoverage } from "./types";

const renewal: AttributeKind = {
  code: "A0001",
  label: "갱신유형",
  order: 1,
  values: [
    { code: "V01", label: "비갱신형", order: 0, naming: {} },
    { code: "V02", label: "갱신형", order: 1, naming: { prefix: "갱신형" } },
  ],
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

function pc(id: string, coverageId: string, name: string, attributes: ProductCoverage["attributes"]): ProductCoverage {
  return { id, productId: "p1", coverageId, name, attributes };
}

describe("조립_기획 「특약 배치 = 그룹핑」 — 그룹 안 자동 정렬", () => {
  it("담보 → 담보속성 종류(order) → 유효값(order) 오름차순. 같은 담보의 탑재분은 뭉친다", () => {
    const members = [
      pc("c", "cov-surgery", "갱신형 수술비", [{ kindCode: "A0001", valueCode: "V02" }]),
      pc("b", "cov-death", "일반상해사망 추가", [{ kindCode: "A0002", valueCode: "V02" }]),
      pc("d", "cov-death", "갱신형 일반상해사망", [{ kindCode: "A0001", valueCode: "V02" }]),
      pc("a", "cov-death", "일반상해사망", []),
      pc("e", "cov-surgery", "수술비", []),
    ];
    const coverageOrder = new Map([
      ["cov-death", 0],
      ["cov-surgery", 1],
    ]);
    const sorted = sortInGroup(members, kinds, (id) => coverageOrder.get(id) ?? Number.MAX_SAFE_INTEGER);
    // 담보 death 먼저. 종류 order 0 = 부가유형: 미사용 < 기본 < 추가. 그 다음 갱신유형.
    expect(sorted.map((m) => m.name)).toEqual(["일반상해사망", "갱신형 일반상해사망", "일반상해사망 추가", "수술비", "갱신형 수술비"]);
  });

  it("담보 순서 함수가 없으면 담보 id 문자열 순 — 입력 배열은 바꾸지 않는다", () => {
    const members = [pc("x", "cov-b", "B", []), pc("y", "cov-a", "A", [])];
    const sorted = sortInGroup(members, kinds);
    expect(sorted.map((m) => m.name)).toEqual(["A", "B"]);
    expect(members[0].name).toBe("B");
  });

  it("미사용 속성은 사용한 것보다 앞 — 「일반상해사망」이 「일반상해사망 추가」보다 먼저", () => {
    const members = [pc("b", "cov", "일반상해사망 추가", [{ kindCode: "A0002", valueCode: "V02" }]), pc("a", "cov", "일반상해사망", [])];
    expect(sortInGroup(members, kinds).map((m) => m.id)).toEqual(["a", "b"]);
  });
});

describe("조립_기획 — 한 그룹 = 한 보통약관 템플릿 (MVP 는 상품의 템플릿과 같아야 한다)", () => {
  it("그룹 템플릿을 비우면 상품 것을 따른다 · 같으면 통과 · 다르면 invalid", () => {
    expect(validateGroupTemplate(undefined, "g1")).toEqual([]);
    expect(validateGroupTemplate("g1", "g1")).toEqual([]);
    expect(validateGroupTemplate("g2", "g1")).toHaveLength(1);
    expect(validateGroupTemplate("g2", undefined)).toHaveLength(1);
  });
});
