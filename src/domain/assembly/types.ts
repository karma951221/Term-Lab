/**
 * 조립 파이프라인의 타입 — 입력(AssemblyInput) · 단계별 중간 표현 · 출력(Booklet).
 *
 * 근거: 2차구현_계획 §3.4 · 조립_기획 · ADR-0016(부분 조립 + 오류 좌표) · ADR-0014(생략 자동 판정) ·
 * ADR-0011(보통약관 문맥 = 기본계약) · ADR-0017(옵션 해소) · ADR-0012(번호는 계산값).
 *
 * 파이프라인과 중간 표현 (아키텍처 문서에 옮길 것):
 *
 *   AssemblyInput
 *     │ 1. 문맥 구성            buildContexts        → AssemblyContexts  (상품담보별 EvalContext + 보통약관 문맥)
 *     │ 2. 조건 해소 (밟은 자리만)
 *     │ 3. 공용조항 인라인화     resolveDocument      → ResolvedDoc      (가지 선택·인라인화 끝, 슬롯·참조는 그대로)
 *     │ 4. 슬롯 치환            substituteSlots      → SubstitutedDoc   (슬롯이 텍스트/오류 마커로)
 *     │ 5. 생략 판정            judgeOmission        → SubstitutedDoc + OmissionRecord[]
 *     │ 6. 번호 계산            numberDocument       → NumberedDoc      (조·항·호·목 번호)
 *     │ 9. 특약 배치            placeSpecials        → 그룹별 정렬된 문서 목록 (+ unplaced 오류)
 *     │ 8. 별표 수집            collectAppendices    → BookletAppendix[] (책자 등장 순 번호)
 *     │ 7. 참조 슬롯 해소       renderDocument       → RenderedDoc      (조·별표 참조가 표기 문자열로)
 *     ▼
 *   Booklet
 *
 * 순서 메모: 별표 번호는 책자 전역 등장 순이라 배치(9)가 끝나야 수집(8)할 수 있고, 참조 해소(7)는 그 뒤에 온다.
 * 모든 중간 표현은 순수 데이터다 — 오류는 그 자리에 `ErrorNode` 로 심고 계속 간다.
 */

import type { Discriminator, EnumDef, SlotPath } from "../catalog/types";
import type { Clause } from "../clause/types";
import type { Appendix } from "../document/appendix";
import type { DocumentNode } from "../document/nodes";
import type { AttributeKind, ClauseOptionOverride, ProductCoverageSnapshot, ProductPlan, SpecialGroup } from "../product/types";
import type { Code, Coordinate, Id, Issue, ValueSlot } from "../types";

// ───────────────────────────── 입력 ─────────────────────────────

/** 상품 — 이름 · 상품 레벨 값·부착 · 기본계약 · 보통약관 문서 · 상품 스코프 옵션 오버라이드. */
export interface AssemblyProduct {
  id: Id;
  name: string;
  /** 상품 레벨 값 자리 (owner product). */
  values: ReadonlyMap<SlotPath, ValueSlot>;
  /** 상품 레벨 선택 부착 코드. */
  attached: ReadonlySet<Code>;
  /** 기본계약 상품담보 id. 없으면 보통약관의 담보 레벨 참조가 `noBaseContract` 오류 (ADR-0011). */
  baseContractId?: Id;
  /** 보통약관 템플릿 문서. 없으면 오류 + 특약만 조립. */
  general?: DocumentNode;
  generalDocumentId?: Id;
  /** 보통약관 공용조항의 상품별 옵션 오버라이드 (scope product). */
  overrides: readonly ClauseOptionOverride[];
}

/** 상품담보(탑재분) — 스냅샷 구조·값·부착 · 세목 부착 · 오버라이드 · 그룹 소속. */
export interface AssemblyCoverage {
  /** 상품담보 + 스냅샷 노드 트리 (담보명·상품담보명·속성 조합 포함). */
  snapshot: ProductCoverageSnapshot;
  /** owner id(상품담보 id · 스냅샷 노드 id) → 값 자리. */
  values: ReadonlyMap<Id, ReadonlyMap<SlotPath, ValueSlot>>;
  /** owner id → 선택 부착 코드. */
  attached: ReadonlyMap<Id, ReadonlySet<Code>>;
  /** 부착된 세목 (MVP 조립은 읽지 않는다 — 세목 레벨 참조는 P7). */
  plans: readonly ProductPlan[];
  /** 담보약관 공용조항의 상품담보별 옵션 오버라이드 (scope productCoverage). */
  overrides: readonly ClauseOptionOverride[];
  /** 소속 그룹 id. 없으면 미배치 → `unplaced` 오류. */
  groupId?: Id;
}

export interface AssemblyInput {
  product: AssemblyProduct;
  coverages: readonly AssemblyCoverage[];
  /** 담보 id → 담보약관 마스터 문서. 없는 담보의 탑재분은 문서를 내지 않는다 (오류 아님). */
  specialDocuments: ReadonlyMap<Id, DocumentNode>;
  clauses: readonly Clause[];
  appendices: readonly Appendix[];
  catalog: readonly Discriminator[];
  enums: readonly EnumDef[];
  attributeKinds: readonly AttributeKind[];
  groups: readonly SpecialGroup[];
}

// ───────────────────────────── 중간 표현 — 노드 ─────────────────────────────

/** 오류 마커 — 오류가 난 자리에 대신 선다 (ADR-0016 부분 조립). `id` 는 원인 노드(또는 가지) id. */
export interface ErrorNode {
  kind: "error";
  id: Id;
  issue: Issue;
}

export interface RText {
  kind: "text";
  id: Id;
  text: string;
}

/** 해소 단계까지 남아 있는 슬롯 — 치환 단계가 텍스트/오류로 바꾼다. `at` 는 오류 좌표 (조·노드 경로). */
export interface RSlot {
  kind: "slot";
  id: Id;
  ref: string;
  at: Coordinate;
}

export interface RArticleRef {
  kind: "articleRef";
  id: Id;
  articleId: Id;
  scope: "self" | "general";
  at: Coordinate;
}

export interface RAppendixRef {
  kind: "appendixRef";
  id: Id;
  appendixCode: Code;
  at: Coordinate;
}

/** 해소 단계(ResolvedDoc)의 인라인 노드. */
export type RInline = RText | RSlot | RArticleRef | RAppendixRef | ErrorNode;
/** 치환 단계(SubstitutedDoc)의 인라인 노드 — 슬롯이 사라졌다. */
export type SInline = Exclude<RInline, RSlot>;

export interface RSubitem<I> {
  kind: "subitem";
  id: Id;
  children: I[];
}
export interface RItem<I> {
  kind: "item";
  id: Id;
  children: I[];
  subitems?: (RSubitem<I> | ErrorNode)[];
}
export interface RParagraph<I> {
  kind: "paragraph";
  id: Id;
  children: I[];
  items?: (RItem<I> | ErrorNode)[];
}
export interface RArticle<I> {
  kind: "article";
  id: Id;
  title: string;
  linkedArticleId?: Id;
  children: (RParagraph<I> | ErrorNode)[];
}
export interface RDoc<I> {
  kind: "document";
  id: Id;
  title: string;
  children: (RArticle<I> | ErrorNode)[];
}

export type ResolvedDoc = RDoc<RInline>;
export type SubstitutedDoc = RDoc<SInline>;

// ───────────────────────────── 중간 표현 — 번호 ─────────────────────────────

export interface NumberedNode {
  n: number;
  label: string;
}

/** 번호 계산 결과 — 노드 id → 번호 (조·항·호·목만). */
export interface NumberedDoc {
  doc: SubstitutedDoc;
  numbers: ReadonlyMap<Id, NumberedNode>;
}

// ───────────────────────────── 출력 ─────────────────────────────

export interface RenderedText {
  kind: "text";
  id: Id;
  text: string;
}
/** 조 참조 — 대상 조 id 와 계산된 표기 「제N조(조 명)」. */
export interface RenderedArticleRef {
  kind: "articleRef";
  id: Id;
  articleId: Id;
  label: string;
}
/** 별표 참조 — 책자 전역 번호와 표기 「【별표N(이름)】」. */
export interface RenderedAppendixRef {
  kind: "appendixRef";
  id: Id;
  appendixCode: Code;
  number: number;
  label: string;
}
export type RenderedInline = RenderedText | RenderedArticleRef | RenderedAppendixRef | ErrorNode;

export interface RenderedSubitem {
  kind: "subitem";
  id: Id;
  number: number;
  label: string;
  children: RenderedInline[];
}
export interface RenderedItem {
  kind: "item";
  id: Id;
  number: number;
  label: string;
  children: RenderedInline[];
  subitems?: (RenderedSubitem | ErrorNode)[];
}
export interface RenderedParagraph {
  kind: "paragraph";
  id: Id;
  number: number;
  label: string;
  children: RenderedInline[];
  items?: (RenderedItem | ErrorNode)[];
}
export interface RenderedArticle {
  kind: "article";
  id: Id;
  number: number;
  /** 「제N조」 */
  label: string;
  title: string;
  linkedArticleId?: Id;
  children: (RenderedParagraph | ErrorNode)[];
}

/** 조립 결과 문서 — 순수 데이터 문서트리 (스냅샷 테스트 대상). */
export interface RenderedDoc {
  kind: "document";
  id: Id;
  /** general 은 보통약관 템플릿 id, special 은 상품담보 id. */
  document: "general" | "special";
  ownerId: Id;
  title: string;
  children: (RenderedArticle | ErrorNode)[];
}

export interface RenderedGroup {
  id: Id;
  title: string;
  docs: RenderedDoc[];
}

export interface BookletAppendix {
  code: Code;
  name: string;
  /** 책자 등장 순 번호 (1부터). */
  number: number;
  /** 번호를 정한 최초 등장 좌표 (D-P6-14). */
  firstAt: Coordinate;
}

/** 생략 판정 기록 — 조연결된 조가 (조 명 제외) 보통약관 조와 리터럴 동일해 생략됐다 (ADR-0014 · D-P6-8). */
export interface OmissionRecord {
  productCoverageId: Id;
  productCoverageName: string;
  articleId: Id;
  articleTitle: string;
  linkedArticleId: Id;
}

/** 문면 없는 담보의 탑재분 — 문서를 내지 않았다 (오류 아님 · D-P6-9). */
export interface UndocumentedCoverage {
  productCoverageId: Id;
  name: string;
  coverageId: Id;
}

/** 실행이 실제로 읽은 값 자리 하나 (D-P6-7 조립 문맥 조회 · 실행 기반 완결성 필터 재료). */
export interface ReadRecord {
  /** 값 소유자 — 상품 · 상품담보 · 스냅샷 노드. */
  owner: { kind: "product" | "productCoverage" | "productSubCoverage" | "productBenefit"; id: Id };
  /** 대응 마스터 실체 id (상품담보 → 담보 id · 노드 → 마스터 노드 id). 상품이면 상품 id. */
  masterId: Id;
  path: SlotPath;
  /** 읽은 결과 — 값 자리 또는 자리 없음. */
  slot: ValueSlot | "missing";
}

export interface ContextTrace {
  productCoverageId: Id;
  productCoverageName: string;
  coverageId: Id;
  reads: ReadRecord[];
}

export interface Booklet {
  /** 보통약관 템플릿이 없으면 undefined (+ issues 에 brokenRef). */
  general: RenderedDoc | undefined;
  /** 그룹 순 → 그룹 안 자동 정렬 순. */
  specials: RenderedGroup[];
  appendices: BookletAppendix[];
  /** 책자 등장 순 (D-P6-12). */
  issues: Issue[];
  /** issues 가 하나라도 있으면 false — 「완성본 아님」. */
  complete: boolean;
  omitted: OmissionRecord[];
  undocumented: UndocumentedCoverage[];
  /** 상품담보별 실행이 읽은 값 (보통약관이 기본계약 값을 읽은 것은 기본계약 상품담보에 실린다). */
  trace: ContextTrace[];
}

/** 상품담보 미리보기 — 담보약관 하나를 특정 상품담보 문맥으로 조립한 결과 (문면_기획 「상품담보 미리보기」). */
export interface SpecialPreview {
  doc: RenderedDoc;
  /** 보통약관 (조 참조 해소·생략 판정의 상대). */
  general: RenderedDoc | undefined;
  appendices: BookletAppendix[];
  issues: Issue[];
  complete: boolean;
  omitted: OmissionRecord[];
  trace: ContextTrace[];
}
