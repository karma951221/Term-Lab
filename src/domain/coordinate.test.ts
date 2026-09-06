import { describe, expect, it } from "vitest";

import { formatCoordinate } from "./coordinate";

describe("오류 좌표 표시", () => {
  it("결과 자리는 계산된 조·항 번호와 노드 종류·상세를 표시한다", () => {
    expect(formatCoordinate({ document: "special", ownerName: "일반상해사망 추가", articleTitle: "보험금을 지급하지 않는 사유", articleNumber: 3, paragraphNumber: 2, nodeKind: "slot", refPath: "보험금지급.지급률" })).toBe(
      "특약 › 일반상해사망 추가 › 제3조(보험금을 지급하지 않는 사유) › ② › 슬롯:보험금지급.지급률",
    );
  });

  it("원천은 조립 번호 없이 조 명과 n번째 항을 표시한다", () => {
    expect(formatCoordinate({ document: "coverageMaster", ownerName: "일반상해사망", articleTitle: "보험금을 지급하지 않는 사유", paragraphNumber: 2, nodeKind: "condition" }, { source: true })).toBe(
      "담보 마스터 › 일반상해사망 › 「보험금을 지급하지 않는 사유」 › 2번째 항 › 조건식",
    );
  });

  it("omitOwner 는 이미 이름으로 부른 소유 실체를 빼고 조 아래만 남긴다", () => {
    expect(
      formatCoordinate(
        { document: "special", ownerName: "일반상해사망 특별약관", articleTitle: "보험금의 감액지급", paragraphNumber: 1, nodeKind: "slot", refPath: "보험금지급.지급률" },
        { source: true, omitOwner: true },
      ),
    ).toBe("「보험금의 감액지급」 › 1번째 항 › 슬롯:보험금지급.지급률");
  });

  it("omitArticle 은 조까지 이름으로 부른 줄에서 조를 빼고 그 아래만 남긴다", () => {
    expect(
      formatCoordinate(
        { document: "special", ownerName: "일반상해사망 특별약관", articleTitle: "특별약관의 소멸", nodeKind: "clauseRef" },
        { source: true, omitOwner: true, omitArticle: true },
      ),
    ).toBe("공용조항 참조");
  });

  it("값 원천은 상품과 상품담보 이름 뒤에 참조 경로를 표시한다", () => {
    expect(formatCoordinate({ document: "product", ownerName: "알파Plus", subjectName: "일반상해사망 추가", nodeKind: "value", refPath: "보험금지급.지급률" }, { source: true })).toBe(
      "상품모델링 › 알파Plus › 일반상해사망 추가 › 보험금지급.지급률",
    );
  });
});
