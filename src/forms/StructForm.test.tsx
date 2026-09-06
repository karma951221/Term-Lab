import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type {
  ConstDiscriminator,
  DerivedDiscriminator,
  EnumDef,
  EnumLookup,
  StructDiscriminator,
} from "@/domain/catalog/types";
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

const 평균공시이율: ConstDiscriminator = {
  kind: "const",
  code: "D0004",
  label: "평균공시이율",
  description: "",
  value: "2.75%",
};

const 면책여부합: DerivedDiscriminator = {
  kind: "derived",
  code: "D0005",
  label: "면책여부합",
  description: "",
  level: "coverage",
  expression: "sum(D0002.F01)",
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

describe("StructForm — 미입력 · 보이는 제안값 · 비우기 (ADR-0004 · 리뷰 #3)", () => {
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

  it("시나리오 1 — 기본값이 폼이 열리자마자 칸에 들어가 있다 (버튼 뒤에 숨지 않는다)", () => {
    const html = render();
    expect(tagsWith(html, 'name="D0002.F02"')[0]).toContain('value="100"');
    expect(html).not.toContain("기본값 채우기");
  });

  it("제안값 자리는 「미입력」과 「제안값 · 저장해야 확정」 두 배지를 함께 단다", () => {
    const html = render();
    expect(html).toContain("제안값 · 저장해야 확정");
    // 기본값이 있는 필드는 지급률 하나뿐 → 제안 배지도 하나
    expect((html.match(/제안값 · 저장해야 확정/g) ?? []).length).toBe(1);
  });

  it("저장 값이 있으면 제안 배지가 없다 — 그 값은 사람이 이미 저장한 것이다", () => {
    const html = render(new Map([["D0002.F02", entered(80)]]));
    expect(html).not.toContain("제안값 · 저장해야 확정");
    expect(tagsWith(html, 'name="D0002.F02"')[0]).toContain('value="80"');
  });

  it("「비우기」는 폼마다 하나다", () => {
    expect((render().match(/비우기/g) ?? []).length).toBe(1);
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

describe("StructForm — 진행 카운트 (디자인원칙 §9.2 · §9.6, 리뷰 #15)", () => {
  it("제목 옆에 「입력 M / N」 과 진행 괘선이 붙는다 — 분모 없는 숫자를 두지 않는다", () => {
    const html = render(new Map([["D0002.F03", entered("메모")]]));
    expect(html).toContain('class="ts-count"');
    expect(html).toContain("<b>입력 1</b> / 6");
    expect(html).toContain("--value:17");
  });

  it("0 에서 시작하는 카운트도 분모를 갖는다", () => {
    expect(render()).toContain("<b>입력 0</b> / 6");
  });
});

describe("StructForm — 값의 출처 문법 (디자인원칙 §1.2, 리뷰 #47)", () => {
  it("직접값은 실선 테두리 입력 — 모든 입력에 ts-field-direct", () => {
    const html = render();
    expect(tagsWith(html, 'name="D0002.F03"')[0]).toContain("ts-field-direct");
    expect(tagsWith(html, 'name="D0002.F05"')[0]).toContain("ts-field-direct");
  });

  it("const 는 자물쇠 + 마스터 라벨, 입력칸이 없다", () => {
    const html = renderToStaticMarkup(
      <StructForm model={buildForm(평균공시이율, enums, new Map())} onSubmit={() => {}} />,
    );
    expect(html).toContain("ts-field-const");
    expect(html).toContain("ts-src-lock");
    expect(html).toContain("평균공시이율 (D0004)");
    expect(html).not.toContain("<input");
    // 값 자리가 아니므로 카운트도 붙지 않는다
    expect(html).not.toContain('class="ts-count"');
  });

  it("파생은 ƒ 표식 + 식 노출, 입력칸이 없다", () => {
    const html = renderToStaticMarkup(
      <StructForm model={buildForm(면책여부합, enums, new Map())} onSubmit={() => {}} />,
    );
    expect(html).toContain("ts-field-derived");
    expect(html).toContain("ts-src-mark");
    expect(html).toContain("sum(D0002.F01)");
    expect(html).not.toContain("<input");
  });

  it("손댄 스냅샷은 입력칸 + 되돌리기 버튼, 마스터 값은 tooltip 으로만 준다", () => {
    const model = buildForm(
      보험금지급,
      enums,
      new Map<string, ValueSlot>([["D0002.F02", entered(80)]]),
      { masterLabel: "수술비(1~7종)[상해]", masterValues: new Map<string, ValueSlot>([["D0002.F02", entered(100)]]) },
    );
    const html = renderToStaticMarkup(<StructForm model={model} onSubmit={() => {}} />);
    expect(html).toContain("ts-field-snapshot");
    expect(html).toContain("ts-revert");
    expect(html).toContain("마스터 값으로 되돌리기 · 마스터: 수술비(1~7종)[상해] = 100");
  });

  it("글리프를 문자로 쓰지 않는다 — ƒ · 자물쇠 · 되돌리기는 전부 SVG (§1.6)", () => {
    const html = renderToStaticMarkup(
      <StructForm model={buildForm(면책여부합, enums, new Map())} onSubmit={() => {}} />,
    );
    expect(html).toContain("<svg");
    for (const glyph of ["\u21ba", "\u2327", "\u0192"]) expect(html).not.toContain(glyph);
  });
});

describe("StructForm — 2열 그리드 (디자인원칙 §2 L2, 리뷰 #51)", () => {
  it("모든 필드가 ts-form-row 다 — 라벨이 값 위에 쌓이는 자리가 없다", () => {
    const html = render();
    expect((html.match(/class="ts-form-row/g) ?? []).length).toBe(6);
    expect(html).not.toContain('class="ts-field"');
  });
});
