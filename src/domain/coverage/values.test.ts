import { describe, expect, it } from "vitest";

import type { Discriminator, EnumDef, SlotPath } from "../catalog";
import { entered, type ValueSlot } from "../types";
import { addSubCoverage, createCoverageTree } from "./tree";
import type { Coverage, CoverageNodeRef } from "./types";
import { checkValueWrite, completeness, formPrefill, type MasterValues } from "./values";

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
  alwaysExposed: true,
  fields: [
    { code: "F01", label: "면책여부", type: { kind: "boolean" }, order: 0 },
    { code: "F02", label: "지급률", type: { kind: "number" }, order: 1, defaultValue: 100 },
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
const noticeEnum: EnumDef = {
  code: "E0001",
  label: "고지유형",
  values: [
    { code: "V01", label: "일반심사", order: 0 },
    { code: "V02", label: "간편심사", order: 1 },
  ],
};
const notice: Discriminator = {
  kind: "scalar",
  code: "D0006",
  label: "고지유형",
  description: "",
  level: "coverage",
  alwaysExposed: false,
  type: { kind: "enum", enumCode: "E0001" },
};
const defs = [renew, surgeryBasis, pay, exemptAny, notice];
const enums = (c: string) => (c === "E0001" ? noticeEnum : undefined);

let seq = 0;
const newId = () => `id-${++seq}`;

function unwrap<T>(r: { ok: true; value: T } | { ok: false; rejection: unknown }): T {
  if (!r.ok) throw new Error(`기대: ok, 실제: ${JSON.stringify(r.rejection)}`);
  return r.value;
}
function rejection(r: { ok: boolean; rejection?: unknown }) {
  if (r.ok) throw new Error("기대: 거부, 실제: ok");
  return r.rejection as { reason: string; what?: string; issues?: { kind: string; at: { refPath?: string } }[] };
}

function values(
  slots: Record<string, Record<SlotPath, ValueSlot>> = {},
  attached: Record<string, string[]> = {},
): MasterValues {
  return {
    slots: new Map(Object.entries(slots).map(([id, s]) => [id, new Map(Object.entries(s))])),
    attached: new Map(Object.entries(attached).map(([id, codes]) => [id, new Set(codes)])),
  };
}

describe("담보 레벨 값 입력 — 값 쓰기 검사", () => {
  const cov: CoverageNodeRef = { level: "coverage", id: "c1" };

  it("부착된 구분자의 값 자리에 타입 맞는 값은 통과한다", () => {
    expect(checkValueWrite(renew, "D0001", true, cov, new Set(), enums).ok).toBe(true);
    expect(checkValueWrite(surgeryBasis, "D0002", "x", cov, new Set(["D0002"]), enums).ok).toBe(true);
    expect(checkValueWrite(pay, "D0003.F02", 50, { level: "benefit", id: "b1" }, new Set(), enums).ok).toBe(true);
  });

  it("타입·유효값 위반은 invalid + 좌표(refPath)", () => {
    const r = rejection(checkValueWrite(renew, "D0001", "yes", cov, new Set(), enums));
    expect(r.reason).toBe("invalid");
    expect(r.issues?.[0]).toMatchObject({ kind: "typeMismatch", at: { refPath: "D0001" } });
    const e = rejection(checkValueWrite(notice, "D0006", "V09", cov, new Set(["D0006"]), enums));
    expect(e.issues?.[0].kind).toBe("brokenRef");
    expect(checkValueWrite(notice, "D0006", "V02", cov, new Set(["D0006"]), enums).ok).toBe(true);
  });

  it("파생·const 구분자에는 직접 입력할 수 없다", () => {
    expect(rejection(checkValueWrite(exemptAny, "D0004", true, cov, new Set(), enums)).reason).toBe("invalid");
  });

  it("미부착 구분자(선택적 노출인데 부착 안 함)의 값 자리는 없다 — notAttached", () => {
    const r = rejection(checkValueWrite(surgeryBasis, "D0002", "x", cov, new Set(), enums));
    expect(r.issues?.[0].kind).toBe("notAttached");
  });

  it("부착 레벨과 실체 레벨이 다르면 값 자리가 없다", () => {
    const r = rejection(checkValueWrite(pay, "D0003.F01", true, cov, new Set(), enums));
    expect(r.issues?.[0].kind).toBe("notAttached");
  });

  it("그 정의의 자리가 아닌 경로는 notFound (없는 필드)", () => {
    expect(rejection(checkValueWrite(pay, "D0003.F09", 1, { level: "benefit", id: "b1" }, new Set(), enums)).reason).toBe("notFound");
    expect(rejection(checkValueWrite(pay, "D0003", 1, { level: "benefit", id: "b1" }, new Set(), enums)).reason).toBe("notFound");
  });
});

describe("담보값입력 S4 — 기본값은 프리필로만", () => {
  it("폼 프리필은 기본값이 있는 자리만 돌려주고, 명시 값이 있으면 그 값을 쓴다", () => {
    expect(formPrefill(surgeryBasis, new Map())).toEqual({ D0002: "약관 별표 기준" });
    expect(formPrefill(surgeryBasis, new Map([["D0002", entered("직접 입력")]]))).toEqual({ D0002: "직접 입력" });
    expect(formPrefill(pay, new Map([["D0003.F01", entered(true)]]))).toEqual({ "D0003.F01": true, "D0003.F02": 100 });
    expect(formPrefill(renew, new Map())).toEqual({});
  });
});

describe("담보값입력 S3 — 완결성 조회는 부착된 것만 대상", () => {
  function fixture() {
    seq = 0;
    const accident = unwrap(createCoverageTree({ name: "일반상해사망", benefitName: "일반상해사망보험금" }, newId, []));
    let surgery = unwrap(createCoverageTree({ name: "수술비", subCoverageName: "1종수술", benefitName: "수술보험금" }, newId, ["일반상해사망"]));
    surgery = unwrap(addSubCoverage(surgery, { name: "2종수술", benefitName: "수술보험금" }, newId));
    return { accident, surgery };
  }

  it("일반상해사망: 갱신유형 미입력만 보고된다 — 수술급여기준은 나타나지 않는다 (급부 구조체는 무조건 노출이라 급부마다)", () => {
    const { accident } = fixture();
    const missing = completeness(accident, defs, values());
    expect(missing.map((m) => [m.owner.level, m.ownerName, m.path])).toEqual([
      ["coverage", "일반상해사망", "D0001"],
      ["benefit", "일반상해사망 > 일반상해사망 > 일반상해사망보험금", "D0003.F01"],
      ["benefit", "일반상해사망 > 일반상해사망 > 일반상해사망보험금", "D0003.F02"],
    ]);
    expect(missing[0]).toMatchObject({ discriminatorCode: "D0001", label: "갱신유형", owner: { id: accident.id } });
  });

  it("수술비: 갱신유형·수술급여기준 미입력 2건(담보 레벨) + 급부별 자리가 보고된다. 입력한 자리는 빠진다", () => {
    const { surgery } = fixture();
    const b1 = surgery.subCoverages[0].benefits[0].id;
    const missing = completeness(
      surgery,
      defs,
      values(
        { [b1]: { "D0003.F01": entered(false), "D0003.F02": entered(100) } },
        { [surgery.id]: ["D0002"] },
      ),
    );
    expect(missing.map((m) => [m.owner.level, m.path])).toEqual([
      ["coverage", "D0001"],
      ["coverage", "D0002"],
      ["benefit", "D0003.F01"],
      ["benefit", "D0003.F02"],
    ]);
    expect(missing[3].owner.id).toBe(surgery.subCoverages[1].benefits[0].id);
  });

  it("기본값이 있어도 미입력은 미입력이다 (프리필은 저장이 아니다)", () => {
    const { surgery } = fixture();
    const missing = completeness(surgery, [surgeryBasis], values({}, { [surgery.id]: ["D0002"] }));
    expect(missing.map((m) => m.path)).toEqual(["D0002"]);
  });

  it("실행 기반 필터(CompletenessFilter)를 얹으면 그 결과가 조회 결과다 — C2 가 실제 타는 분기로 좁힌다", () => {
    const { surgery } = fixture();
    const all = completeness(surgery, defs, values());
    const filtered = completeness(surgery, defs, values(), (items) => items.filter((m) => m.owner.level === "coverage"));
    expect(all.length).toBeGreaterThan(filtered.length);
    expect(filtered.every((m) => m.owner.level === "coverage")).toBe(true);
  });
});

describe("완결성 결과의 좌표", () => {
  it("각 항목은 담보 마스터 문서 좌표(document · ownerId · ownerName · refPath)를 갖는다", () => {
    seq = 0;
    const tree: Coverage = unwrap(createCoverageTree({ name: "일반상해사망" }, newId, []));
    const [m] = completeness(tree, [renew], values());
    expect(m.at).toEqual({ document: "coverageMaster", ownerId: tree.id, ownerName: "일반상해사망", refPath: "D0001" });
  });
});
