import { describe, expect, it } from "vitest";

import { numberDocument, renderDocument } from "./render";
import type { SubstitutedDoc } from "./types";

const text = (id: string, value: string) => ({ kind: "text" as const, id, text: value });
const at = { document: "special" as const, ownerId: "pc" };

function general(): SubstitutedDoc {
  return {
    kind: "document",
    id: "g",
    title: "보통약관",
    children: [
      {
        kind: "article",
        id: "g-a",
        title: "해약환급금",
        children: [
          { kind: "paragraph", id: "g-p1", children: [text("g-t1", "첫째")] },
          { kind: "paragraph", id: "g-p2", children: [text("g-t2", "둘째")] },
        ],
      },
    ],
  };
}

describe("참조 슬롯 렌더", () => {
  it("보통약관 항 다중 참조는 접두·조명을 한 번만 쓰고 마지막 앞 연결어를 쓴다", () => {
    const doc: SubstitutedDoc = {
      kind: "document",
      id: "s",
      title: "특약",
      children: [{ kind: "article", id: "s-a", title: "준용", children: [{ kind: "paragraph", id: "s-p", children: [{ kind: "articleRef", id: "ref", targets: [{ nodeId: "g-p1" }, { nodeId: "g-p2" }], connector: "및", scope: "general", at }] }] }],
    };
    const result = renderDocument(numberDocument(doc), { document: "special", ownerId: "pc", general: numberDocument(general()), appendices: [] });
    const article = result.doc.children[0];
    if (article.kind !== "article" || article.children[0].kind !== "paragraph") throw new Error("unexpected error");
    expect(article.children[0].children[0]).toMatchObject({ label: "보통약관 제1조(해약환급금) 제1항 및 제2항" });
  });

  it("같은 문서의 호·항·다른 조 항은 현재 위치와 직전 대상 기준으로 상위 번호를 생략한다", () => {
    const doc: SubstitutedDoc = {
      kind: "document",
      id: "s",
      title: "특약",
      children: [
        {
          kind: "article",
          id: "a1",
          title: "첫 조",
          children: [
            { kind: "paragraph", id: "p1", children: [{ kind: "articleRef", id: "ref", targets: [{ nodeId: "i2" }, { nodeId: "p2" }, { nodeId: "p3" }], connector: "또는", scope: "self", at }], items: [{ kind: "item", id: "i1", children: [] }, { kind: "item", id: "i2", children: [] }] },
            { kind: "paragraph", id: "p2", children: [] },
          ],
        },
        { kind: "article", id: "a2", title: "둘째 조", children: [{ kind: "paragraph", id: "p3", children: [] }] },
      ],
    };
    const result = renderDocument(numberDocument(doc), { document: "special", ownerId: "pc", appendices: [] });
    const article = result.doc.children[0];
    if (article.kind !== "article" || article.children[0].kind !== "paragraph") throw new Error("unexpected error");
    expect(article.children[0].children[0]).toMatchObject({ label: "제2호, 제2항 또는 제2조(둘째 조) 제1항" });
  });

  it("사라진 대상은 대상마다 issue를 내되 슬롯 자리에는 오류 마커 하나만 둔다", () => {
    const doc: SubstitutedDoc = {
      kind: "document",
      id: "s",
      title: "특약",
      children: [{ kind: "article", id: "a", title: "조", children: [{ kind: "paragraph", id: "p", children: [{ kind: "articleRef", id: "ref", targets: [{ nodeId: "gone-1" }, { nodeId: "gone-2" }], connector: "및", scope: "self", at }] }] }],
    };
    const result = renderDocument(numberDocument(doc), { document: "special", ownerId: "pc", appendices: [] });
    expect(result.issues.map((issue) => issue.at.refPath)).toEqual(["gone-1", "gone-2"]);
    const article = result.doc.children[0];
    if (article.kind !== "article" || article.children[0].kind !== "paragraph") throw new Error("unexpected structural error");
    expect(article.children[0].children).toHaveLength(1);
    expect(article.children[0].children[0].kind).toBe("error");
  });

  it("생략된 특약 조 참조는 연결된 보통약관 조로 해소한다", () => {
    const doc: SubstitutedDoc = {
      kind: "document",
      id: "s",
      title: "특약",
      children: [{ kind: "article", id: "a", title: "조", children: [{ kind: "paragraph", id: "p", children: [{ kind: "articleRef", id: "ref", targets: [{ nodeId: "omitted" }], connector: "및", scope: "self", at }] }] }],
    };
    const result = renderDocument(numberDocument(doc), { document: "special", ownerId: "pc", general: numberDocument(general()), aliases: new Map([["omitted", "g-a"]]), appendices: [] });
    const article = result.doc.children[0];
    if (article.kind !== "article" || article.children[0].kind !== "paragraph") throw new Error("unexpected error");
    expect(article.children[0].children[0]).toMatchObject({ label: "보통약관 제1조(해약환급금)" });
  });
});
