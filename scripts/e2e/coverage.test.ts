import { describe, expect, test } from "vitest";

import { collectTests, renderCoverage, type TaggedTest } from "./coverage";
import type { Scenario, ScenarioIndex } from "./scenarios";

function scenario(slug: string, number: number, steps: number): Scenario {
  return {
    coordinate: `${slug}#${number}`,
    slug,
    number,
    title: `${slug} ${number}`,
    file: `docs/05_QA/시나리오/${slug}_시나리오.md`,
    line: 1,
    premise: "ㄱ",
    steps: Array.from({ length: steps }, (_, i) => `${i + 1}단계`),
    expected: "ㄴ",
    edges: [],
  };
}

const index: ScenarioIndex = {
  scenarios: [scenario("문면작성", 1, 4), scenario("문면작성", 2, 3), scenario("조립오류", 1, 5)],
  malformed: [],
};

describe("collectTests", () => {
  test("중첩된 suite 를 훑어 좌표와 사유를 뽑는다", () => {
    const listed = {
      suites: [
        {
          suites: [
            {
              specs: [
                { title: "가", tests: [{ annotations: [{ type: "시나리오", description: "문면작성#1" }] }] },
                { title: "나", tests: [{ annotations: [{ type: "좌표없음", description: "스모크" }] }] },
                { title: "다", tests: [{ annotations: [] }] },
              ],
            },
          ],
        },
      ],
    };

    expect(collectTests(listed)).toEqual([
      { title: "가", coordinate: "문면작성#1", excuse: null },
      { title: "나", coordinate: null, excuse: "스모크" },
      { title: "다", coordinate: null, excuse: null },
    ]);
  });
});

describe("renderCoverage", () => {
  const tests: TaggedTest[] = [
    { title: "가", coordinate: "문면작성#1", excuse: null },
    { title: "나", coordinate: null, excuse: "스모크 — ADR-0009" },
  ];

  test("문서마다 덮인 좌표와 미커버를 낸다", () => {
    const out = renderCoverage(index, tests);

    expect(out).toMatch(/문면작성\s+2\s+7\s+#1\s+#2/);
    // 하나도 안 덮인 문서는 「전부」로 표시한다.
    expect(out).toMatch(/조립오류\s+1\s+5\s+—\s+전부/);
  });

  test("합계는 시나리오 단위다 — 흐름 단계는 규모를 보여주는 정보 열", () => {
    expect(renderCoverage(index, tests)).toMatch(/합계\s+3\s+12\s+1 \(33%\)/);
  });

  test("좌표없음 테스트를 사유와 함께 보여준다 — 면제가 조용히 쌓이면 안 된다", () => {
    expect(renderCoverage(index, tests)).toContain("좌표없음 테스트 1건");
    expect(renderCoverage(index, tests)).toContain("스모크 — ADR-0009");
  });

  test("태그 없는 테스트와 문서에 없는 좌표를 경고한다", () => {
    const out = renderCoverage(index, [
      { title: "무태그", coordinate: null, excuse: null },
      { title: "오타", coordinate: "문면작성#99", excuse: null },
    ]);

    expect(out).toContain("태그 없는 테스트 1건");
    expect(out).toContain("무태그");
    expect(out).toContain("문서에 없는 좌표 1건");
    expect(out).toContain("문면작성#99");
  });

  test("형식 불일치를 빠진 라벨과 함께 낸다", () => {
    const out = renderCoverage({ ...index, malformed: [{ file: "docs/x.md", number: 3, missing: ["기대 결과"] }] }, tests);

    expect(out).toContain("형식 불일치 1건");
    expect(out).toContain("빠진 라벨: 기대 결과");
  });
});
