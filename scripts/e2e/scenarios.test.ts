import { describe, expect, test } from "vitest";

import { findScenario, loadScenarios, parseScenarioDoc, slugOf } from "./scenarios";

const FILE = "docs/05_QA/시나리오/그룹핑별표_시나리오.md";

const ONE = `# 그룹핑별표 시나리오

> 상태: 초안 · 최종수정: 2026-09-01

머리말 문단.

## 시나리오 1 — 별표 목록 순서가 곧 번호다

**전제**: 상품에 별표 목록 21건이 등록돼 있다.
두 번째 줄도 전제에 붙는다.
**흐름**:
1. 별표 목록 편집칸을 연다.
2. 장해분류표를 맨 앞으로 옮기고 저장한다.
   이어지는 들여쓴 줄은 2번에 붙는다.
3. 조립 미리보기를 연다.
**기대 결과**: 장해분류표의 번호가 1이 된다.
원래 1번이던 별표는 2로 밀린다.
**경계·오류**:
- 목록에 없는 코드를 참조하면 조립 오류.
- 번호를 직접 타이핑하는 경로는 없어야 한다.
`;

describe("slugOf", () => {
  test("두 접미사를 뗀다", () => {
    expect(slugOf("그룹핑별표_시나리오.md")).toBe("그룹핑별표");
    expect(slugOf("체증체감납_인수시나리오.md")).toBe("체증체감납");
  });

  test("README 와 절차 문서는 제외한다", () => {
    expect(slugOf("README.md")).toBeNull();
    expect(slugOf("실물재현_E2E_시나리오.md")).toBeNull();
  });
});

describe("parseScenarioDoc", () => {
  test("네 절을 좌표와 함께 읽는다", () => {
    const { scenarios, malformed } = parseScenarioDoc(ONE, FILE, "그룹핑별표");

    expect(malformed).toEqual([]);
    expect(scenarios).toHaveLength(1);
    const [s] = scenarios;
    expect(s.coordinate).toBe("그룹핑별표#1");
    expect(s.number).toBe(1);
    expect(s.title).toBe("별표 목록 순서가 곧 번호다");
    expect(s.file).toBe(FILE);
    expect(s.line).toBe(7); // "## 시나리오 1 — …" 은 7번째 줄
    expect(s.premise).toBe("상품에 별표 목록 21건이 등록돼 있다. 두 번째 줄도 전제에 붙는다.");
    expect(s.expected).toBe("장해분류표의 번호가 1이 된다. 원래 1번이던 별표는 2로 밀린다.");
    expect(s.edges).toEqual([
      "목록에 없는 코드를 참조하면 조립 오류.",
      "번호를 직접 타이핑하는 경로는 없어야 한다.",
    ]);
  });

  test("흐름 항목은 번호마다 하나이고, 들여쓴 줄은 앞 항목에 붙는다", () => {
    const [s] = parseScenarioDoc(ONE, FILE, "그룹핑별표").scenarios;

    expect(s.steps).toEqual([
      "별표 목록 편집칸을 연다.",
      "장해분류표를 맨 앞으로 옮기고 저장한다. 이어지는 들여쓴 줄은 2번에 붙는다.",
      "조립 미리보기를 연다.",
    ]);
  });

  test("한 파일의 여러 시나리오를 각각 읽는다", () => {
    const two = `${ONE}\n## 시나리오 4 — 두 번째\n\n**전제**: ㄱ\n**흐름**:\n1. ㄴ\n**기대 결과**: ㄷ\n**경계·오류**:\n- ㄹ\n`;
    const { scenarios } = parseScenarioDoc(two, FILE, "그룹핑별표");

    expect(scenarios.map((s) => s.coordinate)).toEqual(["그룹핑별표#1", "그룹핑별표#4"]);
    expect(scenarios[1].steps).toEqual(["ㄴ"]);
  });

  test("라벨이 빠지면 시나리오로 만들지 않고 빠진 라벨을 보고한다", () => {
    const broken = "## 시나리오 2 — 라벨 없음\n\n**전제**: ㄱ\n**흐름**:\n1. ㄴ\n";
    const { scenarios, malformed } = parseScenarioDoc(broken, FILE, "그룹핑별표");

    expect(scenarios).toEqual([]);
    expect(malformed).toEqual([{ file: FILE, number: 2, missing: ["기대 결과", "경계·오류"] }]);
  });
});

describe("loadScenarios — 실제 문서", () => {
  test("모든 시나리오 문서가 형식에 맞고 좌표가 유일하다", () => {
    const index = loadScenarios();

    expect(index.malformed).toEqual([]);
    expect(index.scenarios.length).toBeGreaterThanOrEqual(60);
    expect(new Set(index.scenarios.map((s) => s.coordinate)).size).toBe(index.scenarios.length);
    for (const s of index.scenarios) {
      expect(s.steps.length, s.coordinate).toBeGreaterThan(0);
      expect(s.premise, s.coordinate).not.toBe("");
    }
  });

  test("좌표로 찾는다", () => {
    const index = loadScenarios();
    const first = index.scenarios[0];

    expect(findScenario(index, first.coordinate)).toEqual(first);
    expect(findScenario(index, "없는문서#99")).toBeNull();
  });
});
