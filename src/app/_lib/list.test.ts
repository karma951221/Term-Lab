import { describe, expect, it } from "vitest";

import { changedQuery, includesQuery, paginate } from "./list";

describe("L1 목록 순수 함수", () => {
  it("검색은 공백을 없애고 대소문자와 한글을 부분 일치시킨다", () => {
    expect(includesQuery(" 갱신 ", ["D0001", "갱신여부"])).toBe(true);
    expect(includesQuery("d000", ["D0001", "갱신여부"])).toBe(true);
    expect(includesQuery("면책", ["D0001", "갱신여부"])).toBe(false);
  });

  it("페이지를 범위 안으로 고정하고 50개씩 자른다", () => {
    const items = Array.from({ length: 101 }, (_, i) => i);
    expect(paginate(items, "2", 50)).toMatchObject({ total: 101, page: 2, pageCount: 3, rows: items.slice(50, 100) });
    expect(paginate(items, "99", 50).page).toBe(3);
    expect(paginate([], "bad", 50)).toMatchObject({ total: 0, page: 1, pageCount: 1, rows: [] });
  });

  it("필터를 바꾸면 페이지를 지우고 빈 값은 쿼리에서 제거한다", () => {
    expect(changedQuery("q=갱신&kind=struct&page=3", { kind: "", level: "coverage" })).toBe(
      "q=%EA%B0%B1%EC%8B%A0&level=coverage",
    );
  });
});
