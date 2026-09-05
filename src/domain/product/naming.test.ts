import { describe, expect, it } from "vitest";

import { defaultCoverageName } from "./naming";
import type { AttributeKind } from "./types";

const renewal: AttributeKind = {
  code: "A0001",
  label: "갱신유형",
  order: 0,
  values: [
    { code: "V01", label: "비갱신형", order: 0, naming: {} },
    { code: "V02", label: "갱신형", order: 1, naming: { prefix: "갱신형" } },
  ],
};
const addon: AttributeKind = {
  code: "A0002",
  label: "부가유형",
  order: 1,
  values: [
    { code: "V01", label: "기본", order: 0, naming: {} },
    { code: "V02", label: "추가", order: 1, naming: { suffix: "추가" } },
  ],
};
const kinds = [renewal, addon];

describe("담보속성탑재 S3 — default 상품담보명 (작명 규칙)", () => {
  it("「일반상해사망」 + 갱신형(prefix) + 추가(suffix) → 「갱신형 일반상해사망 추가」 (공백 1칸)", () => {
    const name = defaultCoverageName(
      "일반상해사망",
      [
        { kindCode: "A0002", valueCode: "V02" },
        { kindCode: "A0001", valueCode: "V02" },
      ],
      kinds,
    );
    expect(name).toBe("갱신형 일반상해사망 추가");
  });

  it("속성 없이 탑재하면 담보명 그대로 · 규칙 없는 값(기본 · 비갱신형)은 이름에 흔적을 남기지 않는다", () => {
    expect(defaultCoverageName("일반상해사망", [], kinds)).toBe("일반상해사망");
    expect(
      defaultCoverageName(
        "일반상해사망",
        [
          { kindCode: "A0001", valueCode: "V01" },
          { kindCode: "A0002", valueCode: "V01" },
        ],
        kinds,
      ),
    ).toBe("일반상해사망");
  });

  it("미사용 속성은 건너뛴다 — 「수술비」 + 갱신형 → 「갱신형 수술비」", () => {
    expect(defaultCoverageName("수술비", [{ kindCode: "A0001", valueCode: "V02" }], kinds)).toBe("갱신형 수술비");
  });

  it("prefix 가 여럿이면 종류 order 오름차순으로 왼쪽부터, suffix 도 order 오름차순으로 왼쪽부터", () => {
    const extra: AttributeKind = {
      code: "A0003",
      label: "배당유형",
      order: 2,
      values: [{ code: "V01", label: "무배당", order: 0, naming: { prefix: "무배당", suffix: "Ⅱ" } }],
    };
    const name = defaultCoverageName(
      "일반상해사망",
      [
        { kindCode: "A0003", valueCode: "V01" },
        { kindCode: "A0001", valueCode: "V02" },
        { kindCode: "A0002", valueCode: "V02" },
      ],
      [...kinds, extra],
    );
    expect(name).toBe("갱신형 무배당 일반상해사망 추가 Ⅱ");
  });

  it("카탈로그에 없는 종류·값 선택은 무시한다 (깨진 참조는 조립 오류가 잡는다) · 담보명 공백 정리", () => {
    expect(defaultCoverageName(" 일반상해사망 ", [{ kindCode: "A0009", valueCode: "V01" }], kinds)).toBe("일반상해사망");
    expect(defaultCoverageName("일반상해사망", [{ kindCode: "A0001", valueCode: "V09" }], kinds)).toBe("일반상해사망");
  });
});
