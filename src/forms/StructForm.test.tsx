import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { EnumDef, EnumLookup, StructDiscriminator } from "@/domain/catalog/types";
import { entered, type ValueSlot } from "@/domain/types";

import { buildForm } from "./model";
import { StructForm } from "./StructForm";

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
    { code: "F03", label: "비고", type: { kind: "string" }, order: 2 },
    { code: "F04", label: "개시일", type: { kind: "date" }, order: 3 },
    { code: "F05", label: "고지유형", type: { kind: "enum", enumCode: "E0001" }, order: 4 },
    { code: "F06", label: "적용유형", type: { kind: "list<enum>", enumCode: "E0001" }, order: 5 },
  ],
};

function render(current: Map<string, ValueSlot> = new Map()) {
  const model = buildForm(보험금지급, enums, current);
  return renderToStaticMarkup(<StructForm model={model} onSubmit={() => {}} />);
}

/** 태그 하나의 속성 문자열을 뽑는다 — 마크업 검증 보조. */
function tagsWith(html: string, attr: string): string[] {
  return html.match(new RegExp(`<[^>]*${attr}[^>]*>`, "g")) ?? [];
}

describe("StructForm — 구조체 필드 메타만으로 6 타입이 알맞은 입력으로 그려진다 (인수기준 P1)", () => {
  it("string → text · number → number · date → date 입력", () => {
    const html = render();
    expect(tagsWith(html, 'name="D0002.F03"')[0]).toContain('type="text"');
    expect(tagsWith(html, 'name="D0002.F02"')[0]).toContain('type="number"');
    expect(tagsWith(html, 'name="D0002.F04"')[0]).toContain('type="date"');
  });

  it("boolean → 예/아니오 라디오 (값은 true/false)", () => {
    const radios = tagsWith(render(), 'name="D0002.F01"').filter((t) => t.includes('type="radio"'));
    expect(radios).toHaveLength(2);
    expect(radios.some((t) => t.includes('value="true"'))).toBe(true);
    expect(radios.some((t) => t.includes('value="false"'))).toBe(true);
    expect(render()).toContain("예");
    expect(render()).toContain("아니오");
  });

  it("enum → select — 표시명을 보여주고 값은 코드 (ADR-0005)", () => {
    const html = render();
    const select = html.match(/<select[^>]*name="D0002.F05"[^>]*>[\s\S]*?<\/select>/)?.[0] ?? "";
    expect(select).toContain('<option value="V01">일반심사</option>');
    expect(select).toContain('<option value="V02">간편심사</option>');
    // 표시명이 값으로 쓰이지 않는다
    expect(select).not.toContain('value="일반심사"');
  });

  it("list<enum> → 체크박스 목록 — 표시명 노출, 값은 코드", () => {
    const html = render();
    const boxes = tagsWith(html, 'name="D0002.F06"').filter((t) => t.includes('type="checkbox"'));
    expect(boxes).toHaveLength(2);
    expect(boxes.some((t) => t.includes('value="V01"'))).toBe(true);
    expect(boxes.some((t) => t.includes('value="V02"'))).toBe(true);
  });

  it("필드 라벨은 표시명으로 그려진다", () => {
    const html = render();
    for (const label of ["면책여부", "지급률", "비고", "개시일", "고지유형", "적용유형"]) {
      expect(html).toContain(label);
    }
  });

  it("폼 제목은 구분자 표시명", () => {
    expect(render()).toContain("보험금지급");
  });
});

describe("StructForm — 미입력 · 프리필 · 지우기", () => {
  it("미입력 필드마다 「미입력」 배지가 붙는다 — 기본값이 있어도", () => {
    const html = render();
    const badges = html.match(/미입력/g) ?? [];
    expect(badges.length).toBe(6);
  });

  it("저장 값이 있는 필드에는 배지가 없고 값이 채워져 있다", () => {
    const html = render(new Map([["D0002.F03", entered("메모")]]));
    expect((html.match(/미입력/g) ?? []).length).toBe(5);
    expect(tagsWith(html, 'name="D0002.F03"')[0]).toContain('value="메모"');
  });

  it("시나리오 1 — 기본값은 프리필로 보이되(미입력 배지 유지) 「기본값 채우기」 버튼이 있다", () => {
    const html = render();
    expect(html).toContain("기본값 채우기");
    expect(html).toContain("100");
    // 기본값이 있는 필드는 지급률 하나뿐 → 버튼도 하나
    expect((html.match(/기본값 채우기/g) ?? []).length).toBe(1);
  });

  it("값이 있는 필드에는 「지우기」 버튼이 있고 기본값 채우기 버튼은 없다", () => {
    const html = render(new Map([["D0002.F02", entered(80)]]));
    expect(html).toContain("지우기");
    expect(html).not.toContain("기본값 채우기");
  });

  it("미입력 필드에는 「지우기」 버튼이 없다", () => {
    expect(render()).not.toContain("지우기");
  });

  it("enum 저장 값은 select 에서 선택돼 있다", () => {
    const html = render(new Map([["D0002.F05", entered("V02")]]));
    expect(html).toContain('<option value="V02" selected="">간편심사</option>');
  });

  it("list<enum> 저장 값은 체크돼 있다", () => {
    const html = render(new Map([["D0002.F06", entered(["V02"])]]));
    const boxes = tagsWith(html, 'name="D0002.F06"');
    expect(boxes.find((t) => t.includes('value="V02"'))).toContain("checked");
    expect(boxes.find((t) => t.includes('value="V01"'))).not.toContain("checked");
  });

  it("제출 버튼이 있다", () => {
    expect(render()).toMatch(/<button[^>]*type="submit"/);
  });
});
