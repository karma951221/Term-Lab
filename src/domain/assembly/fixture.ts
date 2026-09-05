/**
 * 관통 1 축약 픽스처 (2차구현_계획 §5) — 조립 입력(`AssemblyInput`)을 도메인 객체로.
 *
 * 실물(알파Plus)을 본뜬 축약: 상품 「알파Plus(축약)」 = 일반상해사망 × {기본} · × {추가}, 기본계약 = 기본,
 * 그룹 「상해 관련 특별약관」, 보통약관 1벌(4개 조 · 별표 참조 1), 공용조항 2건(소멸 block + 옵션 · 준용 inline),
 * 별표 마스터 2건(참조되는 것은 1건). B3 `surgeryFixture` 와 코드 체계를 맞췄다:
 *   D0001 갱신여부(담보 boolean) · D0002 고지유형(상품 enum E0001) · D0003 보험금지급(급부 구조체 F01 면책여부 · F02 지급률) ·
 *   D0004 평균공시이율(const) · D0005 면책여부합(담보 파생) · D0006 감액기간(담보 number · 선택 노출)
 *   담보속성 A0001 갱신유형 {V01 비갱신형 · V02 갱신형} · A0002 부가유형 {V01 기본 · V02 추가}
 * id 는 읽기 쉬운 고정 문자열 — 스냅샷 안정성. 시드(D3)·서비스 통합 테스트가 같은 모양을 DB 로 만든다.
 *
 * 기대 (계획 §5): 특약 2벌 본문 동일(제목만 다름) · 준용규정 조 생략 · 별표 번호 1 · issues 0 · complete.
 */

import type { Discriminator, EnumDef, SlotPath } from "../catalog/types";
import type { Clause } from "../clause/types";
import type { Appendix } from "../document/appendix";
import type { DocumentNode } from "../document/nodes";
import type { AttributeKind, ProductCoverageSnapshot, SpecialGroup } from "../product/types";
import { type Code, entered, type Id, type Value, type ValueSlot } from "../types";
import type { AssemblyCoverage, AssemblyInput } from "./types";

// ───────────────────────────── 카탈로그 ─────────────────────────────

export const alphaEnums: EnumDef[] = [
  {
    code: "E0001",
    label: "고지유형",
    values: [
      { code: "V01", label: "일반심사", order: 0 },
      { code: "V02", label: "간편심사", order: 1 },
    ],
  },
];

export const alphaCatalog: Discriminator[] = [
  { kind: "scalar", code: "D0001", label: "갱신여부", description: "", level: "coverage", alwaysExposed: true, type: { kind: "boolean" } },
  { kind: "scalar", code: "D0002", label: "고지유형", description: "", level: "product", alwaysExposed: true, type: { kind: "enum", enumCode: "E0001" } },
  {
    kind: "struct",
    code: "D0003",
    label: "보험금지급",
    description: "",
    level: "benefit",
    alwaysExposed: true,
    fields: [
      { code: "F01", label: "면책여부", type: { kind: "boolean" }, order: 0 },
      { code: "F02", label: "지급률", type: { kind: "number" }, order: 1 },
    ],
  },
  { kind: "const", code: "D0004", label: "평균공시이율", description: "", value: "2.5%" },
  { kind: "derived", code: "D0005", label: "면책여부합", description: "", level: "coverage", expression: "any(D0003.F01)" },
  { kind: "scalar", code: "D0006", label: "감액기간", description: "", level: "coverage", alwaysExposed: false, type: { kind: "number" } },
];

export const alphaAttributeKinds: AttributeKind[] = [
  {
    code: "A0001",
    label: "갱신유형",
    order: 0,
    values: [
      { code: "V01", label: "비갱신형", order: 0, naming: {} },
      { code: "V02", label: "갱신형", order: 1, naming: { prefix: "갱신형" } },
    ],
  },
  {
    code: "A0002",
    label: "부가유형",
    order: 1,
    values: [
      { code: "V01", label: "기본", order: 0, naming: {} },
      { code: "V02", label: "추가", order: 1, naming: { suffix: "추가" } },
    ],
  },
];

// ───────────────────────────── 공용조항 · 별표 ─────────────────────────────

export const alphaClauses: Clause[] = [
  {
    code: "C0001",
    label: "특별약관의 소멸",
    description: "",
    mode: "block",
    body: [
      {
        id: "c1-par",
        kind: "paragraph",
        children: [
          { id: "c1-t1", kind: "text", text: "이 특별약관은 " },
          { id: "c1-opt", kind: "optionSlot", optionCode: "O01" },
          { id: "c1-t2", kind: "text", text: " 소멸합니다." },
        ],
      },
    ],
    options: [
      {
        code: "O01",
        label: "소멸 사유",
        order: 0,
        values: [
          { code: "V01", label: "일반", order: 0, body: [{ id: "c1-o-gen", kind: "text", text: "보험기간이 끝난 때" }] },
          { code: "V02", label: "사망", order: 1, body: [{ id: "c1-o-death", kind: "text", text: "피보험자가 사망한 때" }] },
        ],
      },
    ],
    required: { discriminators: [], attributes: [] },
  },
  {
    code: "C0002",
    label: "준용 문구",
    description: "",
    mode: "inline",
    body: [
      { id: "c2-t1", kind: "text", text: "이 약관에서 정하지 않은 사항은 보통약관 " },
      { id: "c2-ref", kind: "articleRef", articleId: "g-art-def" },
      { id: "c2-t2", kind: "text", text: " 및 관계 법령을 따릅니다." },
    ],
    options: [],
    required: { discriminators: [], attributes: [] },
  },
];

export const alphaAppendices: Appendix[] = [
  { code: "APX_DISABILITY", name: "장해분류표", description: "" },
  { code: "APX_BURN", name: "화상 분류표", description: "" },
];

// ───────────────────────────── 문서 ─────────────────────────────

export function alphaGeneralDocument(): DocumentNode {
  return {
    id: "g-doc",
    kind: "document",
    title: "알파Plus 보통약관",
    children: [
      { id: "g-art-def", kind: "article", title: "용어의 정의", children: [{ id: "g-par-def", kind: "paragraph", children: [{ id: "g-txt-def", kind: "text", text: "이 계약에서 사용하는 용어의 정의는 다음과 같습니다." }] }] },
      {
        id: "g-art-pay",
        kind: "article",
        title: "보험금의 지급사유",
        children: [
          {
            id: "g-par-pay-1",
            kind: "paragraph",
            children: [
              { id: "g-txt-pay-1", kind: "text", text: "회사는 피보험자가 " },
              {
                id: "g-inl-renew",
                kind: "inlineCond",
                branches: [
                  { id: "g-inl-renew-if", when: "D0001 = true", children: [{ id: "g-txt-pay-2", kind: "text", text: "최초계약일" }] },
                  { id: "g-inl-renew-else", children: [{ id: "g-txt-pay-3", kind: "text", text: "계약일" }] },
                ],
              },
              { id: "g-txt-pay-4", kind: "text", text: " 이후 기본계약의 보험금 지급사유가 발생한 때 보험금을 지급합니다." },
            ],
          },
          {
            id: "g-cond-notice",
            kind: "condBlock",
            branches: [
              {
                id: "g-cond-notice-if",
                when: "D0002 = 'V02'",
                children: [
                  {
                    id: "g-par-pay-2",
                    kind: "paragraph",
                    children: [
                      { id: "g-txt-pay-5", kind: "text", text: "이 계약은 " },
                      { id: "g-slot-notice", kind: "slot", ref: "D0002" },
                      { id: "g-txt-pay-6", kind: "text", text: " 계약입니다." },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        id: "g-art-disability",
        kind: "article",
        title: "장해의 분류",
        children: [
          {
            id: "g-par-dis",
            kind: "paragraph",
            children: [
              { id: "g-txt-dis-1", kind: "text", text: "장해의 분류는 " },
              { id: "g-apx-disability", kind: "appendixRef", appendixCode: "APX_DISABILITY" },
              { id: "g-txt-dis-2", kind: "text", text: " 에 따릅니다." },
            ],
          },
        ],
      },
      { id: "g-art-apply", kind: "article", title: "준용규정", children: [{ id: "g-par-apply", kind: "paragraph", children: [{ id: "g-clause-apply", kind: "clauseInlineRef", clauseCode: "C0002", options: {} }] }] },
    ],
  };
}

export function alphaDeathDocument(): DocumentNode {
  return {
    id: "s-doc-death",
    kind: "document",
    title: "일반상해사망 특별약관",
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
              { id: "s-txt-pay-1", kind: "text", text: "회사는 피보험자가 " },
              {
                id: "s-inl-renew",
                kind: "inlineCond",
                branches: [
                  { id: "s-inl-renew-if", when: "exist(attr.A0001) and attr.A0001 = 'V02'", children: [{ id: "s-txt-pay-2", kind: "text", text: "최초계약일" }] },
                  { id: "s-inl-renew-else", children: [{ id: "s-txt-pay-3", kind: "text", text: "계약일" }] },
                ],
              },
              { id: "s-txt-pay-4", kind: "text", text: " 이후 상해로 사망한 경우 사망보험금을 지급합니다." },
            ],
          },
          {
            id: "s-par-pay-2",
            kind: "paragraph",
            children: [
              { id: "s-txt-pay-5", kind: "text", text: "사망보험금은 보험가입금액에 평균공시이율 " },
              { id: "s-slot-rate", kind: "slot", ref: "D0004" },
              { id: "s-txt-pay-6", kind: "text", text: " 을 적용하여 계산합니다." },
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
                    id: "s-par-exempt",
                    kind: "paragraph",
                    children: [{ id: "s-txt-exempt-1", kind: "text", text: "회사는 다음 중 어느 한 가지로 보험금 지급사유가 발생한 때에는 보험금을 지급하지 않습니다." }],
                    items: [
                      { id: "s-item-exempt-1", kind: "item", children: [{ id: "s-txt-exempt-2", kind: "text", text: "피보험자가 고의로 자신을 해친 경우" }] },
                      {
                        id: "s-item-exempt-2",
                        kind: "item",
                        children: [{ id: "s-txt-exempt-3", kind: "text", text: "보험수익자가 고의로 피보험자를 해친 경우" }],
                        subitems: [{ id: "s-sub-exempt", kind: "subitem", children: [{ id: "s-txt-exempt-4", kind: "text", text: "다만, 그 보험수익자가 보험금의 일부 보험수익자인 경우에는 다른 보험수익자에 대한 보험금은 지급합니다." }] }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        id: "s-art-reduce",
        kind: "article",
        title: "보험금의 감액지급",
        children: [
          {
            id: "s-par-reduce",
            kind: "paragraph",
            children: [
              { id: "s-txt-reduce-1", kind: "text", text: "계약일부터 " },
              { id: "s-slot-reduce", kind: "slot", ref: "D0006" },
              { id: "s-txt-reduce-2", kind: "text", text: "개월 이내에 발생한 사망에 대해서는 사망보험금의 50%를 지급합니다." },
            ],
          },
        ],
      },
      {
        id: "s-art-lapse",
        kind: "article",
        title: "특별약관의 소멸",
        children: [
          { id: "s-par-lapse", kind: "paragraph", children: [{ id: "s-txt-lapse", kind: "text", text: "이 특별약관은 다음의 경우 소멸합니다." }] },
          { id: "s-clause-lapse", kind: "clauseBlockRef", clauseCode: "C0001", options: { O01: "V02" } },
        ],
      },
      {
        id: "s-art-apply",
        kind: "article",
        title: "준용규정",
        linkedArticleId: "g-art-apply",
        children: [{ id: "s-par-apply", kind: "paragraph", children: [{ id: "s-clause-apply", kind: "clauseInlineRef", clauseCode: "C0002", options: {} }] }],
      },
    ],
  };
}

// ───────────────────────────── 상품담보 조립 헬퍼 ─────────────────────────────

export interface CoverageSpec {
  id: Id;
  name: string;
  coverageId: Id;
  coverageName: string;
  attributes: { kindCode: Code; valueCode: Code }[];
  /** 세부보장 → 급부 (마스터 노드 id 는 `${id}` 그대로 쓴다 — 픽스처 단순화). */
  subCoverages: { id: Id; masterNodeId: Id; name: string; benefits: { id: Id; masterNodeId: Id; name: string }[] }[];
  /** owner id → 경로 → 값. */
  values: Record<Id, Record<SlotPath, Value>>;
  /** owner id → 선택 부착 코드. */
  attached?: Record<Id, Code[]>;
  groupId?: Id;
  overrides?: AssemblyCoverage["overrides"];
}

export function coverageEntry(spec: CoverageSpec): AssemblyCoverage {
  const snapshot: ProductCoverageSnapshot = {
    id: spec.id,
    productId: "prod-alpha",
    coverageId: spec.coverageId,
    coverageName: spec.coverageName,
    name: spec.name,
    attributes: spec.attributes,
    subCoverages: spec.subCoverages.map((s, i) => ({
      id: s.id,
      productCoverageId: spec.id,
      kind: "sub",
      masterNodeId: s.masterNodeId,
      name: s.name,
      order: i,
      benefits: s.benefits.map((b, j) => ({ id: b.id, productCoverageId: spec.id, kind: "benefit", masterNodeId: b.masterNodeId, parentId: s.id, name: b.name, order: j })),
    })),
  };
  const values = new Map<Id, Map<SlotPath, ValueSlot>>();
  for (const [owner, slots] of Object.entries(spec.values)) {
    values.set(owner, new Map(Object.entries(slots).map(([p, v]) => [p, entered(v)])));
  }
  const attached = new Map<Id, ReadonlySet<Code>>();
  for (const [owner, codes] of Object.entries(spec.attached ?? {})) attached.set(owner, new Set(codes));
  return {
    snapshot,
    values,
    attached,
    plans: [],
    overrides: spec.overrides ?? [],
    ...(spec.groupId !== undefined ? { groupId: spec.groupId } : {}),
  };
}

/** 일반상해사망 탑재분 하나 — 스냅샷 값은 마스터와 같다 (D0001 false · 면책 true · 지급률 100 · 감액기간 24). */
export function deathCoverage(id: Id, name: string, attributes: CoverageSpec["attributes"], groupId?: Id): AssemblyCoverage {
  return coverageEntry({
    id,
    name,
    coverageId: "cov-death",
    coverageName: "일반상해사망",
    attributes,
    subCoverages: [{ id: `${id}-sub`, masterNodeId: "sub-death", name: "일반상해사망", benefits: [{ id: `${id}-ben`, masterNodeId: "ben-death", name: "사망보험금" }] }],
    values: {
      [id]: { D0001: false, D0006: 24 },
      [`${id}-ben`]: { "D0003.F01": true, "D0003.F02": 100 },
    },
    attached: { [id]: ["D0006"] },
    groupId,
  });
}

export const alphaGroups: SpecialGroup[] = [{ id: "grp-injury", productId: "prod-alpha", title: "상해 관련 특별약관", order: 0 }];

// ───────────────────────────── 진입점 ─────────────────────────────

export function alphaPlusFixture(): AssemblyInput {
  return {
    product: {
      id: "prod-alpha",
      name: "알파Plus(축약)",
      values: new Map([["D0002", entered("V02")]]),
      attached: new Set(),
      baseContractId: "pc-basic",
      general: alphaGeneralDocument(),
      generalDocumentId: "g-doc",
      overrides: [],
    },
    coverages: [
      deathCoverage("pc-basic", "일반상해사망보장", [{ kindCode: "A0002", valueCode: "V01" }], "grp-injury"),
      deathCoverage("pc-addon", "일반상해사망보장 추가", [{ kindCode: "A0002", valueCode: "V02" }], "grp-injury"),
    ],
    specialDocuments: new Map([["cov-death", alphaDeathDocument()]]),
    clauses: alphaClauses,
    appendices: alphaAppendices,
    catalog: alphaCatalog,
    enums: alphaEnums,
    attributeKinds: alphaAttributeKinds,
    groups: alphaGroups,
  };
}
