import { describe, expect, test } from "vitest";

import type { EvidenceDump } from "./evidence-types";
import { renderFailure, renderIndex, type FailureInput } from "./failure";
import type { Scenario } from "./scenarios";

const scenario: Scenario = {
  coordinate: "그룹핑별표#5",
  slug: "그룹핑별표",
  number: 5,
  title: "별표 목록 순서를 바꾸면 본문 번호가 따라 바뀐다",
  file: "docs/05_QA/시나리오/그룹핑별표_시나리오.md",
  line: 41,
  premise: "상품에 별표 목록 21건이 등록돼 있다.",
  steps: ["편집칸을 연다.", "맨 앞으로 옮기고 저장한다.", "미리보기를 연다."],
  expected: "장해분류표의 번호가 1이 된다.",
  edges: ["목록에 없는 코드를 참조하면 조립 오류."],
};

const dump: EvidenceDump = {
  coordinate: "그룹핑별표#5",
  lastLocator: 'getByRole("heading", { name: /별표 목록 21건/ })',
  failedAction: {
    coordinate: "그룹핑별표#5.2",
    name: "맨 앞으로 옮기고 저장한다",
    startedAt: "2026-09-08T00:00:10.000Z",
    endedAt: "2026-09-08T00:00:40.000Z",
  },
  entries: [
    { at: "2026-09-08T00:00:09.000Z", kind: "action-start", text: "편집칸을 연다", coordinate: "그룹핑별표#5.1" },
    { at: "2026-09-08T00:00:09.900Z", kind: "action-end", text: "편집칸을 연다", coordinate: "그룹핑별표#5.1", ok: true, durationMs: 900 },
    { at: "2026-09-08T00:00:10.000Z", kind: "action-start", text: "맨 앞으로 옮기고 저장한다", coordinate: "그룹핑별표#5.2" },
    { at: "2026-09-08T00:00:10.400Z", kind: "response", text: "POST /products/8f2a → 500 (240ms)" },
    { at: "2026-09-08T00:00:40.000Z", kind: "action-end", text: "맨 앞으로 옮기고 저장한다", coordinate: "그룹핑별표#5.2", ok: false, durationMs: 30000 },
  ],
};

const base: FailureInput = {
  coordinate: "그룹핑별표#5",
  testTitle: "별표 목록 순서를 바꾸면 본문 번호가 따라 바뀐다",
  scenario,
  dump,
  serverLines: ["2026-09-08T00:00:10.300Z\tError: 별표 코드가 중복됩니다"],
  errorText: "Timed out 30000ms waiting for expect(locator).toBeVisible()",
  goldenKey: "a1b2c3d4",
  fastMode: false,
  artifacts: ["before.png", "at-failure.png", "trace.zip"],
};

describe("renderFailure", () => {
  test("정본을 인용하고 실패한 흐름 단계를 짚는다", () => {
    const md = renderFailure(base);

    expect(md).toContain("# 실패: 그룹핑별표#5 — 별표 목록 순서를 바꾸면 본문 번호가 따라 바뀐다");
    expect(md).toContain("docs/05_QA/시나리오/그룹핑별표_시나리오.md:41");
    expect(md).toContain("상품에 별표 목록 21건이 등록돼 있다.");
    expect(md).toContain("장해분류표의 번호가 1이 된다.");
    // 실패한 단계에만 표시가 붙는다.
    expect(md).toMatch(/2\. 맨 앞으로 옮기고 저장한다\. +← 여기서 실패/);
    expect(md).not.toMatch(/1\. 편집칸을 연다\. +← 여기서 실패/);
  });

  test("액션 타임라인은 성공을 ✔, 실패를 ▶ 로 찍고 대기 대상을 붙인다", () => {
    const md = renderFailure(base);

    expect(md).toContain("✔ 그룹핑별표#5.1  편집칸을 연다");
    expect(md).toContain("▶ 그룹핑별표#5.2  맨 앞으로 옮기고 저장한다");
    expect(md).toContain('getByRole("heading", { name: /별표 목록 21건/ })');
  });

  test("같은 구간의 서버·네트워크 증거를 붙인다", () => {
    const md = renderFailure(base);

    expect(md).toContain("Error: 별표 코드가 중복됩니다");
    expect(md).toContain("POST /products/8f2a → 500 (240ms)");
  });

  test("재현 좌표와 판정 체크박스·금지 목록을 항상 담는다", () => {
    const md = renderFailure(base);

    expect(md).toContain("golden=a1b2c3d4");
    expect(md).toContain('npm run test:e2e -- --grep "그룹핑별표#5"');
    expect(md).toContain("[ ] ① 테스트가 문서를 잘못 옮겼다");
    expect(md).toContain("[ ] ② 코드가 문서를 어겼다");
    expect(md).toContain("[ ] ③ 문서가 낡았다");
    expect(md).toContain("src/domain/**/__snapshots__/**");
    expect(md).toContain("tests/fixtures/terms/*.md");
    expect(md).toContain("docs/05_QA/시나리오/*.md");
  });

  test("좌표가 없는 테스트는 정본 절이 없고 ③ 판정도 없다 — 문서가 없으면 문서 낡음을 물을 수 없다", () => {
    const md = renderFailure({ ...base, coordinate: null, scenario: null, dump: { ...dump, coordinate: null } });

    expect(md).toContain("이 테스트에는 시나리오 좌표가 없다");
    expect(md).toContain("[ ] ① 테스트가 문서를 잘못 옮겼다");
    expect(md).toContain("[ ] ② 코드가 문서를 어겼다");
    expect(md).not.toContain("③ 문서가 낡았다");
  });

  test("FAST 모드였으면 재현 절 맨 위에 경고를 박는다", () => {
    const md = renderFailure({ ...base, fastMode: true });

    expect(md).toContain("E2E_FAST=1 로 실행됐다");
  });
});

describe("renderIndex", () => {
  test("실패 목록을 디렉토리와 함께 낸다", () => {
    const md = renderIndex([
      { coordinate: "그룹핑별표#5", title: "별표 목록 순서", dir: "그룹핑별표-5" },
      { coordinate: null, title: "스모크 헬스체크", dir: "스모크-헬스체크" },
    ]);

    expect(md).toContain("그룹핑별표#5");
    expect(md).toContain("그룹핑별표-5/FAILURE.md");
    expect(md).toContain("스모크 헬스체크");
  });
});
