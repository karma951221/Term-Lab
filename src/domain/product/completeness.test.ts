import { describe, expect, it } from "vitest";

import type { Discriminator } from "../catalog";
import { entered } from "../types";
import { checkGeneralAttachment, exposedDiscriminators, missingSlotsOf } from "./completeness";

const renewalFlag: Discriminator = { kind: "scalar", code: "D0001", label: "갱신여부", description: "", level: "coverage", alwaysExposed: true, type: { kind: "boolean" } };
const pay: Discriminator = {
  kind: "struct",
  code: "D0003",
  label: "보험금지급",
  description: "",
  level: "benefit",
  alwaysExposed: true,
  fields: [
    { code: "F01", label: "면책여부", type: { kind: "boolean" }, order: 0 },
    { code: "F02", label: "지급률", type: { kind: "number" }, order: 1 },
  ],
};
const optionalCov: Discriminator = { kind: "scalar", code: "D0005", label: "감액기간", description: "", level: "coverage", alwaysExposed: false, type: { kind: "number" } };
const productEnum: Discriminator = { kind: "scalar", code: "D0002", label: "고지유형", description: "", level: "product", alwaysExposed: true, type: { kind: "enum", enumCode: "E0001" } };
const constant: Discriminator = { kind: "const", code: "D0004", label: "평균공시이율", description: "", value: "2.5%" };
const defs = [renewalFlag, pay, optionalCov, productEnum, constant];

describe("완결성 — 노출된 구분자 = 무조건 노출(레벨) ∪ 선택 부착", () => {
  it("담보 레벨: 무조건 노출 갱신여부 + 부착한 감액기간. const·다른 레벨은 제외", () => {
    expect(exposedDiscriminators("coverage", defs, ["D0005"]).map((d) => d.code)).toEqual(["D0001", "D0005"]);
    expect(exposedDiscriminators("coverage", defs, []).map((d) => d.code)).toEqual(["D0001"]);
    expect(exposedDiscriminators("benefit", defs, []).map((d) => d.code)).toEqual(["D0003"]);
  });
});

describe("폼입력 S3 · 담보값입력 S3 — 상품담보 완결성 (스냅샷 실체 부착분 기준)", () => {
  it("급부 스냅샷의 보험금지급 중 지급률만 입력됐으면 면책여부가 미입력으로 잡힌다", () => {
    const slots = new Map([["D0003.F02", entered(50)]]);
    const missing = missingSlotsOf({ kind: "productBenefit", id: "n2" }, "1종수술급부", "benefit", defs, [], (p) => slots.get(p));
    expect(missing).toEqual([{ owner: { kind: "productBenefit", id: "n2" }, ownerName: "1종수술급부", level: "benefit", path: "D0003.F01" }]);
  });
  it("전부 입력되면 빈 목록", () => {
    const slots = new Map([["D0001", entered(true)]]);
    expect(missingSlotsOf({ kind: "productCoverage", id: "pc1" }, "수술비", "coverage", defs, [], (p) => slots.get(p))).toEqual([]);
  });
});

describe("ADR-0011 — 기본계약 지정 순간 보통약관 부착 검사", () => {
  it("보통약관이 요구하는 담보·급부 레벨 구분자가 기본계약 스냅샷에 노출돼 있으면 통과, 아니면 notAttached 좌표", () => {
    const exposed = {
      coverage: ["D0001"],
      subCoverage: [] as string[],
      benefit: ["D0003"],
    };
    const ok = checkGeneralAttachment(
      [
        { level: "coverage", discriminatorCode: "D0001" },
        { level: "benefit", discriminatorCode: "D0003", at: { document: "general", articleTitle: "보험금의 지급사유" } },
      ],
      exposed,
      { id: "pc1", name: "일반상해사망" },
    );
    expect(ok).toEqual([]);
    const bad = checkGeneralAttachment([{ level: "coverage", discriminatorCode: "D0005", at: { document: "general", articleTitle: "감액" } }], exposed, {
      id: "pc1",
      name: "일반상해사망",
    });
    expect(bad).toHaveLength(1);
    expect(bad[0].kind).toBe("notAttached");
    expect(bad[0].at).toMatchObject({ document: "general", articleTitle: "감액", ownerId: "pc1", ownerName: "일반상해사망", refPath: "D0005" });
  });
});
