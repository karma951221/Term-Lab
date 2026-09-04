import { describe, expect, it } from "vitest";

import type { Coordinate } from "../types";
import { cascadeOf, computeImpact, enumReferences, NO_VALUE_STORE, type ImpactSource } from "./impact";
import type { Discriminator, EnumDef } from "./types";

const 보험금지급: Discriminator = {
  kind: "struct",
  code: "D0002",
  label: "보험금지급",
  description: "",
  level: "benefit",
  alwaysExposed: true,
  fields: [
    { code: "F01", label: "면책여부", type: { kind: "boolean" }, order: 0 },
    { code: "F02", label: "고지유형", type: { kind: "enum", enumCode: "E0001" }, order: 1 },
  ],
};
const 고지유형구분자: Discriminator = {
  kind: "scalar",
  code: "D0003",
  label: "고지유형",
  description: "",
  level: "product",
  alwaysExposed: true,
  type: { kind: "list<enum>", enumCode: "E0001" },
};
const 고지유형: EnumDef = {
  code: "E0001",
  label: "고지유형",
  values: [
    { code: "V01", label: "일반심사", order: 0 },
    { code: "V02", label: "간편심사", order: 1 },
  ],
};

describe("구분자정의 S6 · 역할권한 S3 — 영향(Impact) 계산", () => {
  it("기본 ImpactSource(NO_VALUE_STORE) 는 값 행 0 · 참조 없음", async () => {
    const impact = await computeImpact({ kind: "discriminator", code: "D0002" }, NO_VALUE_STORE);
    expect(impact).toEqual({ valueRowsLost: 0, brokenRefs: [], cascade: [] });
  });

  it("주입된 ImpactSource 가 준 값 행 수·참조 목록이 Impact 에 실린다", async () => {
    const ref: Coordinate = { document: "coverageMaster", ownerName: "수술비", refPath: "D0002.F01" };
    const source: ImpactSource = {
      countValueRows: async () => 7,
      findBrokenRefs: async () => [ref],
      purgeValueRows: async () => {},
    };
    const impact = await computeImpact({ kind: "field", code: "D0002", fieldCode: "F01" }, source);
    expect(impact).toEqual({ valueRowsLost: 7, brokenRefs: [ref], cascade: [] });
  });

  it("구조체 삭제의 cascade 는 필드들, enum 삭제의 cascade 는 값들이다", () => {
    expect(cascadeOf(보험금지급)).toEqual(["필드 면책여부(F01)", "필드 고지유형(F02)"]);
    expect(cascadeOf(고지유형)).toEqual(["값 일반심사(V01)", "값 간편심사(V02)"]);
    expect(cascadeOf(고지유형구분자)).toEqual([]);
  });

  it("enum 을 참조하는 구분자·필드는 카탈로그 안에서 찾는다 — enum 삭제 시 깨질 참조", () => {
    const refs = enumReferences("E0001", [보험금지급, 고지유형구분자]);
    expect(refs).toEqual([
      { refPath: "D0002.F02", ownerName: "보험금지급.고지유형" },
      { refPath: "D0003", ownerName: "고지유형" },
    ]);
    expect(enumReferences("E0002", [보험금지급, 고지유형구분자])).toEqual([]);
  });

  it("추가 cascade·참조를 합쳐 Impact 를 만든다 (enum 삭제 = 값 행 + 참조 필드 + 값 cascade)", async () => {
    const source: ImpactSource = {
      countValueRows: async () => 2,
      findBrokenRefs: async () => [{ refPath: "D0009", document: "clause" }],
      purgeValueRows: async () => {},
    };
    const impact = await computeImpact({ kind: "enum", enumCode: "E0001" }, source, {
      cascade: cascadeOf(고지유형),
      brokenRefs: enumReferences("E0001", [보험금지급]),
    });
    expect(impact.valueRowsLost).toBe(2);
    expect(impact.brokenRefs).toHaveLength(2);
    expect(impact.cascade).toEqual(["값 일반심사(V01)", "값 간편심사(V02)"]);
  });
});
