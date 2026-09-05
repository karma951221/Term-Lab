/**
 * 상품·탑재 도메인 타입 (순수).
 *
 * 근거: docs/01_기획/상품탑재_기획.md · 조립_기획 「특약 배치 = 그룹핑」 · 도메인모델 §1·§2 ·
 * ADR-0002(탑재 = 값 스냅샷) · ADR-0006(세목 축) · ADR-0011(기본계약) · ADR-0015(담보속성) ·
 * ADR-0017(옵션 오버라이드) · ADR-0019(역할).
 *
 * 다른 영역(담보 마스터 B1 · 공용조항 B2 · 문서 B3)의 코드는 import 하지 않는다 —
 * 필요한 것은 이 파일 끝의 **주입 인터페이스**로 받는다.
 */
import type { SlotPath } from "../catalog/types";
import type { AttachLevel, Code, Coordinate, Id, Issue, ValueSlot } from "../types";

// ───────────────────────────── 담보속성 카탈로그 (ADR-0015) ─────────────────────────────

/**
 * 담보명 규칙 — 유효값마다 prefix / suffix (둘 다 선택, 둘 다 가능).
 * 2차기획_목록 「작명 규칙 문법」이 미확정이라 최소형으로 확정한 것 (naming.ts 주석 참조).
 */
export interface NamingRule {
  prefix?: string;
  suffix?: string;
}

/** 담보속성 유효값. 코드 `V01` 은 종류 안에서 유일 · 불변. 표시명은 자유 변경. */
export interface AttributeValue {
  code: Code;
  label: string;
  /** 종류 안 순서 (0부터) — 그룹 안 자동 정렬의 3차 키 (조립_기획). */
  order: number;
  naming: NamingRule;
}

/** 담보속성 종류. 코드 `A0001` (전역 채번). */
export interface AttributeKind {
  code: Code;
  label: string;
  /** 카탈로그 전역 적용 순서 (0부터) — 작명 적용 순서이자 그룹 안 정렬의 2차 키 (D-P5-4). */
  order: number;
  values: AttributeValue[];
}

export interface NewAttributeKind {
  label: string;
}

export interface NewAttributeValue {
  label: string;
  naming?: NamingRule;
}

/** 상품담보의 담보속성 값 선택 — sparse (사용한 종류만). */
export interface AttributeSelection {
  kindCode: Code;
  valueCode: Code;
}

// ───────────────────────────── 상품 ─────────────────────────────

export interface Product {
  id: Id;
  name: string;
  /** 보통약관 템플릿(B3 문서) id. MVP 는 1개 — 없으면 미선택. */
  generalDocumentId?: Id;
}

export interface NewProduct {
  name: string;
  generalDocumentId?: Id;
}

// ───────────────────────────── 세목 (ADR-0006) ─────────────────────────────

/** 세목 축 — MVP 는 번호 있는 두 축(종·형)만. 번호 없는 축은 MVP 밖. */
export type PlanAxis = "type" | "form";

export const PLAN_AXES: readonly PlanAxis[] = ["type", "form"];

/** 축의 문면 접미 (제2종 · 제1형). */
export const PLAN_AXIS_LABEL: Record<PlanAxis, string> = { type: "종", form: "형" };

/**
 * 세목 선택지 — 뼈대 `(축, 번호, 이름, 세목유형 참조, 유형 구조체 값)`.
 * 유형 구조체 값은 공용 값 저장소에 owner `plan`(id = 선택지 id) 로 산다.
 * 세목유형 = **plan 레벨 구조체 구분자** (카탈로그) — 유형 하나 = 구조체 하나.
 */
export interface PlanOption {
  id: Id;
  productId: Id;
  axis: PlanAxis;
  /** 종·형 축은 번호 필수 (D-P5-10). 1 이상 정수. 축 안에서 유일. */
  number: number;
  name: string;
  /** 세목유형 = plan 레벨 구조체 구분자 코드. */
  planTypeCode: Code;
}

export interface NewPlanOption {
  axis: PlanAxis;
  number: number;
  name: string;
  planTypeCode: Code;
}

/** 상품세목 = 명시 등록된 유효 조합 (축마다 선택지 하나씩). 카테시안 아님. */
export interface ProductPlan {
  id: Id;
  productId: Id;
  /** 축 순(type → form) 으로 정렬된 선택지. */
  options: PlanOption[];
}

// ───────────────────────────── 상품담보 = 탑재 (ADR-0002 · ADR-0015) ─────────────────────────────

/** 상품담보 = 담보 × 담보속성 값 조합. 특별약관 한 벌이 나오는 단위. */
export interface ProductCoverage {
  id: Id;
  productId: Id;
  /** 담보 마스터 id (B1). */
  coverageId: Id;
  /** 상품담보명 — 탑재 시 작명 규칙으로 생성, 이후 수동 변경 가능. */
  name: string;
  /** 정규화(종류 order 순) 된 선택. */
  attributes: AttributeSelection[];
}

/** 스냅샷 노드 — 마스터 세부보장·급부 ↔ 스냅샷 실체 대응. 값 owner 는 kind 별 `productSubCoverage` / `productBenefit`, id = 이 노드 id. */
export interface SnapshotNode {
  id: Id;
  productCoverageId: Id;
  kind: "sub" | "benefit";
  /** 마스터 노드(세부보장·급부) id. */
  masterNodeId: Id;
  /** 급부면 소속 세부보장 스냅샷 노드 id. 세부보장이면 undefined. */
  parentId?: Id;
  name: string;
  order: number;
}

/** 스냅샷 트리 조회 결과 — 상품담보 + 대응 노드. */
export interface ProductCoverageSnapshot extends ProductCoverage {
  coverageName: string;
  subCoverages: (SnapshotNode & { benefits: SnapshotNode[] })[];
}

// ───────────────────────────── 기본계약 (ADR-0011) ─────────────────────────────

/**
 * 보통약관 문서가 요구하는 담보 레벨(및 하위) 구분자 참조 — B2/B3 가 문서에서 추출해 준다.
 * 기본계약 지정 순간 그 상품담보 스냅샷에 부착돼 있는지 검사한다 (부착 실패는 거부가 아니라 오류 목록 — D-P5-13).
 */
export interface RequiredCoverageRef {
  level: "coverage" | "subCoverage" | "benefit";
  discriminatorCode: Code;
  /** 문서 안 좌표 (아는 만큼). */
  at?: Coordinate;
}

export interface BaseContractCheck {
  productCoverageId: Id;
  /** 미부착 참조 목록 (kind `notAttached`). 비어 있으면 통과. */
  issues: Issue[];
}

// ───────────────────────────── 특약 그룹 (조립_기획) ─────────────────────────────

export interface SpecialGroup {
  id: Id;
  productId: Id;
  title: string;
  /** 책자 안 그룹 순서 (0부터). */
  order: number;
  /** 한 그룹 = 한 보통약관 템플릿. MVP 는 상품 것과 같아야 한다 (검증). 없으면 상품 것을 따른다. */
  generalDocumentId?: Id;
}

export interface NewSpecialGroup {
  title: string;
  generalDocumentId?: Id;
}

// ───────────────────────────── 옵션 오버라이드 (ADR-0017) ─────────────────────────────

/** 공용조항 옵션 선택 — 옵션 자리 → 선택한 옵션 코드. 유효 집합 검증은 B2 `OptionValidator`. */
export type ClauseOptionSelection = Record<string, string>;

export interface ClauseOptionOverride {
  id: Id;
  /** 보통약관 공용조항은 상품별(`product`), 담보약관은 상품담보별(`productCoverage`). */
  scope: { kind: "product" | "productCoverage"; id: Id };
  /** 문서 안 공용조항 참조 노드(clauseBlockRef · clauseInlineRef) id. */
  nodeId: Id;
  clauseCode: Code;
  options: ClauseOptionSelection;
}

// ───────────────────────────── 완결성 ─────────────────────────────

/** 스냅샷 실체(또는 상품)의 미입력 자리 하나. */
export interface MissingSlot {
  owner: { kind: "product" | "productCoverage" | "productSubCoverage" | "productBenefit"; id: Id };
  /** 실체 이름 (상품명 · 상품담보명 · 세부보장명 · 급부명). */
  ownerName: string;
  level: AttachLevel;
  path: SlotPath;
}

// ───────────────────────────── 주입 인터페이스 (다른 영역이 구현) ─────────────────────────────

/** 담보 마스터 트리 (B1 `src/domain/coverage` 가 만든다 — 여기서는 모양만 안다). */
export interface CoverageTree {
  id: Id;
  name: string;
  subCoverages: {
    id: Id;
    name: string;
    order: number;
    benefits: { id: Id; name: string; order: number }[];
  }[];
}

/**
 * 담보 마스터 조회 — B1 서비스의 어댑터를 오케스트레이터가 주입한다.
 * 마스터 **값**은 여기서 받지 않는다 — 공용 값 저장소(`db/repo/values`)의 owner
 * `coverage / subCoverage / benefit` 에서 `copySlots` 로 직접 스냅샷한다 (ADR-0002).
 */
export interface CoverageMasterSource {
  tree(coverageId: Id): Promise<CoverageTree | undefined>;
  /**
   * (선택) 마스터 값 자리 조회. 주면 스냅샷 시 공용 저장소 대신 이것을 읽는다 —
   * B1 이 값을 공용 저장소 밖에 두는 경우의 탈출구. 기본은 공용 저장소.
   */
  masterSlots?(owner: { kind: "coverage" | "subCoverage" | "benefit"; id: Id }): Promise<Map<SlotPath, ValueSlot>>;
}

/**
 * 보통약관 부착 검사 재료 — 문서(B3)·공용조항(B2)이 「이 보통약관 템플릿이 요구하는 담보 레벨 참조」를 준다.
 * 기본계약 지정 순간 호출한다 (ADR-0011).
 */
export interface GeneralAttachmentCheck {
  requiredRefs(generalDocumentId: Id): Promise<RequiredCoverageRef[]>;
}

/** 보통약관 템플릿 존재 검증 게이트 (B3). 기본 구현은 모두 통과. */
export interface GeneralDocumentGate {
  exists(generalDocumentId: Id): Promise<boolean>;
}

/** 공용조항 옵션 유효 집합 검증 (B2). 빈 배열 = 유효. */
export interface OptionValidator {
  validate(clauseCode: Code, options: ClauseOptionSelection): Promise<Issue[]>;
}

/** 담보속성의 식 참조 사용처 (C1 refs). 삭제 영향의 brokenRefs 재료. 기본은 없음. */
export interface AttributeRefSource {
  findExpressionRefs(kindCode: Code, valueCode?: Code): Promise<Coordinate[]>;
}
