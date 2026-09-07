import { describe, expect, test } from "vitest";

import { sliceServerLog, stripAnsi } from "./serverlog";

const ESC = String.fromCharCode(27);

const LINES = [
  "2026-09-08T00:00:00.000Z\t서버 기동",
  "2026-09-08T00:00:09.000Z\t직전 요청",
  "2026-09-08T00:00:10.500Z\tPOST /products 처리 시작",
  "2026-09-08T00:00:10.700Z\tError: 별표 코드가 중복됩니다",
  "    at saveAppendices (src/services/product.ts:212)",
  "    at async handler (src/app/actions.ts:9)",
  "2026-09-08T00:00:30.000Z\t한참 뒤 요청",
];

describe("sliceServerLog", () => {
  test("액션 구간의 줄만 고른다", () => {
    const got = sliceServerLog(LINES, "2026-09-08T00:00:10.000Z", "2026-09-08T00:00:11.000Z", 0);

    expect(got).toEqual([
      "2026-09-08T00:00:10.500Z\tPOST /products 처리 시작",
      "2026-09-08T00:00:10.700Z\tError: 별표 코드가 중복됩니다",
      "    at saveAppendices (src/services/product.ts:212)",
      "    at async handler (src/app/actions.ts:9)",
    ]);
  });

  test("타임스탬프 없는 줄은 앞 줄에 딸려 산다 — 스택트레이스가 잘리면 못 읽는다", () => {
    const got = sliceServerLog(LINES, "2026-09-08T00:00:10.600Z", "2026-09-08T00:00:11.000Z", 0);

    expect(got).toContain("    at saveAppendices (src/services/product.ts:212)");
  });

  test("pre-roll 이 액션 시작 직전 줄을 끌어온다", () => {
    const got = sliceServerLog(LINES, "2026-09-08T00:00:10.000Z", "2026-09-08T00:00:11.000Z", 2000);

    expect(got[0]).toBe("2026-09-08T00:00:09.000Z\t직전 요청");
  });

  test("구간 밖은 버린다", () => {
    const got = sliceServerLog(LINES, "2026-09-08T00:00:10.000Z", "2026-09-08T00:00:11.000Z", 0).join("\n");

    expect(got).not.toContain("한참 뒤 요청");
    expect(got).not.toContain("서버 기동");
  });

  test("빈 입력은 빈 결과", () => {
    expect(sliceServerLog([], "2026-09-08T00:00:00.000Z", "2026-09-08T00:00:01.000Z")).toEqual([]);
  });

  test("ANSI 이스케이프를 벗긴다 — Next dev 로그는 색을 입고 나온다", () => {
    const colored = [`2026-09-08T00:00:10.500Z\t${ESC}[32m${ESC}[1m✓${ESC}[22m${ESC}[39m Ready in 206ms`];

    expect(sliceServerLog(colored, "2026-09-08T00:00:10.000Z", "2026-09-08T00:00:11.000Z", 0)).toEqual([
      "2026-09-08T00:00:10.500Z\t✓ Ready in 206ms",
    ]);
    expect(stripAnsi(`${ESC}[31m빨강${ESC}[39m`)).toBe("빨강");
  });
});
