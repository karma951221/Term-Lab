import { describe, expect, it } from "vitest";

import { parseTerms } from "./parse";

const sample = `# 문서 제목

> 출처: x

# 제1관 목적

## 제1조(목적)

= 단독 본문

## 제27조의1(보험료의 납입면제)

@ 첫 항

  - 첫 호

    - 첫 목

\`\`\`표
제목: (없음)
|용어|정의|
|---|---|
|계약자|사람|
\`\`\`

@ 둘째 항 <!-- 원문번호: 3 -->

\`\`\`용어풀이
【심신상실】
정신병 등
- 둘째 줄
\`\`\`

\`\`\`그림
설명: 흐름도
\`\`\`
> 통계: 조 2
`;

describe("parseTerms — 파싱양식 → 구조", () => {
  it("관·조·항·호·목·표·박스·그림을 줄 단위로 읽는다", () => {
    const doc = parseTerms(sample);
    expect(doc.title).toBe("문서 제목");
    expect(doc.sections.map((s) => s.title)).toEqual(["목적"]);
    const [a1, a27] = doc.sections[0].articles;
    expect(a1).toEqual({ number: "1", title: "목적", body: [{ kind: "paragraph", text: "단독 본문", single: true }] });
    expect(a27.number).toBe("27의1");
    expect(a27.body.map((l) => l.kind)).toEqual(["paragraph", "item", "subitem", "table", "paragraph", "box", "box"]);
    expect(a27.body[3]).toEqual({ kind: "table", rows: [{ header: true, cells: ["용어", "정의"] }, { cells: ["계약자", "사람"] }] });
    expect(a27.body[4]).toEqual({ kind: "paragraph", text: "둘째 항" });
    expect(a27.body[5]).toEqual({ kind: "box", title: "심신상실", lines: ["정신병 등", "- 둘째 줄"] });
    expect(a27.body[6]).toEqual({ kind: "box", title: "그림", lines: ["흐름도"] });
  });

  it("관이 없는 문서는 제목 없는 관 하나", () => {
    expect(parseTerms("# T\n\n## 제1조(a)\n\n= b\n").sections).toEqual([{ title: "", articles: [{ number: "1", title: "a", body: [{ kind: "paragraph", text: "b", single: true }] }] }]);
  });

  it("조 제목의 괄호는 첫 여는 괄호부터 마지막 닫는 괄호까지", () => {
    expect(parseTerms("# T\n\n## 제27조의3(암(유사암제외), 뇌졸중의 정의)\n\n= x\n").sections[0].articles[0].title).toBe("암(유사암제외), 뇌졸중의 정의");
  });

  it("표 제목이 있으면 title 로, 제목줄 없는 표는 header 없이", () => {
    const doc = parseTerms("# T\n\n## 제1조(a)\n\n= b\n\n```표\n제목: 지급표\n|구분|금액|\n|---|---|\n|A|1|\n```\n");
    expect(doc.sections[0].articles[0].body[1]).toEqual({ kind: "table", title: "지급표", rows: [{ header: true, cells: ["구분", "금액"] }, { cells: ["A", "1"] }] });
  });

  it("마커 밖의 줄은 오류다", () => {
    expect(() => parseTerms("# T\n\n## 제1조(a)\n\n본문만\n")).toThrow(/알 수 없는 줄/);
  });
});
