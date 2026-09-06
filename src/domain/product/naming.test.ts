import { describe, expect, it } from "vitest";

import { defaultCoverageName, missingTemplateKinds } from "./naming";
import type { AttributeKind } from "./types";

const renewal: AttributeKind = {
  code: "A0001",
  label: "갱신유형",
  order: 9,
  values: [
    { code: "V01", label: "비갱신형", order: 0, fragment: "" },
    { code: "V02", label: "갱신형", order: 1, fragment: "갱신형" },
  ],
};
const addon: AttributeKind = {
  code: "A0002",
  label: "부가유형",
  order: 0,
  values: [
    { code: "V01", label: "기본", order: 0, fragment: "" },
    { code: "V02", label: "추가", order: 1, fragment: "추가" },
  ],
};
const kinds = [renewal, addon];

const template = "[A0001] [담보명] [A0002]";

describe("3차 S2 — 전역 명명 템플릿", () => {
  it("속성 조각과 담보명을 템플릿 칩 위치에 치환한다", () => {
    const name = defaultCoverageName(
      "일반상해사망",
      [
        { kindCode: "A0002", valueCode: "V02" },
        { kindCode: "A0001", valueCode: "V02" },
      ],
      kinds,
      template,
    );
    expect(name).toBe("갱신형 일반상해사망 추가");
  });

  it("빈 조각은 빈 문자열로 치환하고 결과 공백을 한 칸으로 정리한다", () => {
    expect(defaultCoverageName("일반상해사망", [], kinds, template)).toBe("일반상해사망");
    expect(
      defaultCoverageName(
        "일반상해사망",
        [
          { kindCode: "A0001", valueCode: "V01" },
          { kindCode: "A0002", valueCode: "V01" },
        ],
        kinds,
        template,
      ),
    ).toBe("일반상해사망");
  });

  it("종류 order와 무관하게 템플릿 순서와 리터럴 문자를 보존한다", () => {
    const name = defaultCoverageName(
      "골절수술비Ⅱ보장",
      [
        { kindCode: "A0001", valueCode: "V02" },
        { kindCode: "A0002", valueCode: "V02" },
      ],
      kinds,
      "[담보명][A0002] / [A0001]",
    );
    expect(name).toBe("골절수술비Ⅱ보장추가 / 갱신형");
  });

  it("미사용 종류·카탈로그에 없는 종류와 값은 빈 문자열로 치환한다", () => {
    expect(defaultCoverageName(" 일반상해사망 ", [{ kindCode: "A0009", valueCode: "V01" }], kinds, template)).toBe("일반상해사망");
    expect(defaultCoverageName("일반상해사망", [{ kindCode: "A0001", valueCode: "V09" }], kinds, template)).toBe("일반상해사망");
  });

  it("템플릿에 칩이 없는 속성 종류를 찾는다", () => {
    expect(missingTemplateKinds(kinds, "[담보명] [A0002]").map((kind) => kind.code)).toEqual(["A0001"]);
  });
});
