/**
 * 관통 1 축약 픽스처 (2차구현_계획 §5) — 도메인 객체로. 테스트·시드(D3)·조립 스냅샷(C2)이 공유한다.
 *
 * 실물(알파Plus 수술비 · 갱신형 파생)을 본뜬 담보약관 1벌 + 보통약관 1벌 + 별표 2건.
 * 구분자 코드는 카탈로그 서비스 테스트의 채번 순서를 따른다:
 *   D0001 갱신여부(담보 boolean) · D0002 고지유형(상품 enum) · D0003 보험금지급(급부 구조체 F01 면책여부 · F02 지급률)
 *   D0004 평균공시이율(const) · D0005 면책여부합(담보 파생 boolean). 담보속성 `renew_type`.
 * id 는 읽기 쉬운 고정 문자열 — 스냅샷 안정성을 위해서다 (실제 저장은 uuid).
 */

import type { Appendix } from "./appendix";
import type { DocumentNode } from "./nodes";

export interface SurgeryFixture {
  coverageId: string;
  special: DocumentNode;
  general: DocumentNode;
  appendices: Appendix[];
}

export function surgeryFixture(): SurgeryFixture {
  const special: DocumentNode = {
    id: "s-doc",
    kind: "document",
    title: "수술비 특별약관",
    children: [
      {
        id: "s-art-pay",
        kind: "article",
        title: "보험금의 지급사유",
        children: [
          {
            id: "s-par-pay-1",
            kind: "paragraph",
            children: [
              { id: "s-txt-1", kind: "text", text: "회사는 피보험자가 " },
              {
                id: "s-inl-renew",
                kind: "inlineCond",
                branches: [
                  { id: "s-inl-renew-if", when: "D0001 = true", children: [{ id: "s-txt-2", kind: "text", text: "최초계약일" }] },
                  { id: "s-inl-renew-else", children: [{ id: "s-txt-3", kind: "text", text: "계약일" }] },
                ],
              },
              { id: "s-txt-4", kind: "text", text: " 이후 수술을 받은 경우 평균공시이율 " },
              { id: "s-slot-rate", kind: "slot", ref: "D0004" },
              { id: "s-txt-5", kind: "text", text: " 를 적용하여 보험금을 지급합니다." },
            ],
            items: [
              {
                id: "s-item-1",
                kind: "item",
                children: [{ id: "s-txt-6", kind: "text", text: "1종수술" }],
                subitems: [{ id: "s-sub-1", kind: "subitem", children: [{ id: "s-txt-7", kind: "text", text: "개두수술" }] }],
              },
              { id: "s-item-2", kind: "item", children: [{ id: "s-txt-8", kind: "text", text: "2종수술" }] },
            ],
          },
        ],
      },
      {
        id: "s-cond-term",
        kind: "condBlock",
        branches: [
          {
            id: "s-cond-term-if",
            when: "D0001 = true",
            children: [
              {
                id: "s-art-term",
                kind: "article",
                title: "보험기간",
                children: [{ id: "s-par-term-1", kind: "paragraph", children: [{ id: "s-txt-9", kind: "text", text: "이 특별약관의 보험기간은 갱신형입니다." }] }],
              },
            ],
          },
        ],
      },
      {
        id: "s-cond-exempt",
        kind: "condBlock",
        branches: [
          {
            id: "s-cond-exempt-if",
            when: "D0005 = true",
            children: [
              {
                id: "s-art-exempt",
                kind: "article",
                title: "보험금을 지급하지 않는 사유",
                children: [
                  {
                    id: "s-par-exempt-1",
                    kind: "paragraph",
                    children: [
                      { id: "s-txt-10", kind: "text", text: "지급률 " },
                      { id: "s-slot-ratio", kind: "slot", ref: "D0003.F02" },
                      { id: "s-txt-11", kind: "text", text: "% 에 해당하는 사유는 지급하지 않습니다." },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        id: "s-art-lapse",
        kind: "article",
        title: "특별약관의 소멸",
        children: [
          { id: "s-par-lapse-1", kind: "paragraph", children: [{ id: "s-txt-12", kind: "text", text: "이 특별약관은 다음의 경우 소멸합니다." }] },
          { id: "s-clause-lapse", kind: "clauseBlockRef", clauseCode: "C001", options: { tone: "death" } },
        ],
      },
      {
        id: "s-art-apply",
        kind: "article",
        title: "준용규정",
        linkedArticleId: "g-art-apply",
        children: [
          {
            id: "s-par-apply-1",
            kind: "paragraph",
            children: [
              { id: "s-txt-13", kind: "text", text: "이 특별약관에서 정하지 않은 사항은 보통약관 " },
              { id: "s-aref-general", kind: "articleRef", articleId: "g-art-pay", scope: "general" },
              { id: "s-txt-14", kind: "text", text: " 및 이 특별약관 " },
              { id: "s-aref-self", kind: "articleRef", articleId: "s-art-pay", scope: "self" },
              { id: "s-txt-15", kind: "text", text: " · " },
              { id: "s-apx-burn", kind: "appendixRef", appendixCode: "APX_BURN" },
              { id: "s-txt-16", kind: "text", text: " 을 따릅니다. " },
              { id: "s-clause-apply", kind: "clauseInlineRef", clauseCode: "C002", options: {} },
            ],
          },
        ],
      },
    ],
  };

  const general: DocumentNode = {
    id: "g-doc",
    kind: "document",
    title: "알파Plus 보통약관",
    children: [
      { id: "g-art-def", kind: "article", title: "용어의 정의", children: [{ id: "g-par-def-1", kind: "paragraph", children: [{ id: "g-txt-1", kind: "text", text: "이 계약에서 사용하는 용어의 정의는 다음과 같습니다." }] }] },
      { id: "g-art-pay", kind: "article", title: "보험금의 지급사유", children: [{ id: "g-par-pay-1", kind: "paragraph", children: [{ id: "g-txt-2", kind: "text", text: "회사는 기본계약의 지급사유에 따라 보험금을 지급합니다." }] }] },
      {
        id: "g-art-disability",
        kind: "article",
        title: "장해의 분류",
        children: [
          {
            id: "g-par-dis-1",
            kind: "paragraph",
            children: [
              { id: "g-txt-3", kind: "text", text: "장해의 분류는 " },
              { id: "g-apx-disability", kind: "appendixRef", appendixCode: "APX_DISABILITY" },
              { id: "g-txt-4", kind: "text", text: " 에 따릅니다." },
            ],
          },
        ],
      },
      { id: "g-art-apply", kind: "article", title: "준용규정", children: [{ id: "g-par-apply-1", kind: "paragraph", children: [{ id: "g-txt-5", kind: "text", text: "이 약관에서 정하지 않은 사항은 관계 법령을 따릅니다." }] }] },
    ],
  };

  return {
    coverageId: "cov-surgery",
    special,
    general,
    appendices: [
      { code: "APX_DISABILITY", name: "장해분류표", description: "" },
      { code: "APX_BURN", name: "화상 분류표", description: "" },
    ],
  };
}
