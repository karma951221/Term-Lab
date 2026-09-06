import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { EnumDef, EnumLookup, StructDiscriminator } from "@/domain/catalog/types";
import { entered, type ValueSlot } from "@/domain/types";

import { buildForm } from "./model";
import { ValueList } from "./ValueList";

const 고지유형: EnumDef = {
  code: "E0001",
  label: "고지유형",
  values: [
    { code: "V01", label: "일반심사", order: 0 },
    { code: "V02", label: "간편심사", order: 1 },
  ],
};
const enums: EnumLookup = (c) => (c === "E0001" ? 고지유형 : undefined);

const 보험금지급: StructDiscriminator = {
  kind: "struct",
  code: "D0002",
  label: "보험금지급",
  description: "",
  level: "benefit",
  alwaysExposed: true,
  fields: [
    { code: "F01", label: "면책여부", type: { kind: "boolean" }, order: 0 },
    { code: "F02", label: "지급률", type: { kind: "number" }, defaultValue: 100, order: 1 },
    { code: "F05", label: "고지유형", type: { kind: "enum", enumCode: "E0001" }, order: 2 },
  ],
};

function render(current: Map<string, ValueSlot> = new Map()) {
  return renderToStaticMarkup(<ValueList model={buildForm(보험금지급, enums, current)} />);
}

describe("ValueList — 읽기 전용 값 목록 (완결성 표시)", () => {
  it("입력된 값은 표시명으로, 미입력은 「미입력」 배지로 강조한다", () => {
    const html = render(
      new Map([
        ["D0002.F01", entered(false)],
        ["D0002.F05", entered("V02")],
      ]),
    );
    expect(html).toContain("아니오");
    expect(html).toContain("간편심사");
    expect(html).not.toContain("V02");
    expect((html.match(/미입력/g) ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it("기본값이 있어도 저장 전엔 미입력이다 — 기본값을 값처럼 보여주지 않는다", () => {
    const html = render();
    expect(html).not.toContain("100");
    expect((html.match(/미입력/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("요약은 해낸 것을 센다 — 「N개 중 M개 입력」 (§9.2 · 리뷰 #13)", () => {
    expect(render(new Map([["D0002.F01", entered(true)]]))).toContain("3개 중 <b>1개 입력</b>");
    expect(render()).toContain("3개 중 <b>0개 입력</b>");
  });

  it("요약에 진행 괘선이 붙는다 — 분모 없는 숫자를 두지 않는다", () => {
    const html = render(new Map([["D0002.F01", entered(true)]]));
    expect(html).toContain('class="ts-count"');
    expect(html).toContain("--value:33");
  });

  it("모두 입력되면 3개 중 3개", () => {
    const html = render(
      new Map([
        ["D0002.F01", entered(true)],
        ["D0002.F02", entered(80)],
        ["D0002.F05", entered("V01")],
      ]),
    );
    expect(html).toContain("3개 중 <b>3개 입력</b>");
    expect(html).toContain("--value:100");
    expect(html).not.toContain("미입력");
  });

  it("라벨은 필드 표시명", () => {
    const html = render();
    expect(html).toContain("면책여부");
    expect(html).toContain("지급률");
    expect(html).toContain("고지유형");
  });
});
