/**
 * 참조 그래프 타입 (순수) — 문면_기획 「참조 무결성 — 참조는 그래프다」.
 *
 * - 노드 = 실체. 구분자·필드·enum·enum 값·공용조항·옵션·선택지·문서·조·별표·담보 노드·담보속성·유효값·상품·상품담보.
 *   키는 `nodeKey()` 로 문자열화한다 (`discriminator:D0001` · `field:D0003.F01` · `article:<docId>/<articleId>` …).
 * - 간선 = 참조. 「무엇이(from) 무엇을(to) 어떤 형태로(via) 읽는가」 + 좌표(`Coordinate`).
 *   대상이 선언되지 않은 간선 = 깨진 참조 (삭제 후 남은 오류 상태).
 * - 포함 관계(필드 ⊂ 구분자 · enum 값 ⊂ enum · 옵션 ⊂ 공용조항 · 조 ⊂ 문서 · 유효값 ⊂ 종류 · 급부 ⊂ 세부보장 ⊂ 담보)는
 *   `RefNodeInfo.parent` 와 키 구조(`structuralParent`)로 안다 — 「구분자 사용처」에는 필드 사용처가 포함된다.
 *
 * DB·React import 금지 (순수층).
 */
import type { Discriminator, EnumDef } from "../catalog/types";
import type { Clause } from "../clause/types";
import type { CoverageNodeLevel, Coverage } from "../coverage/types";
import type { Appendix } from "../document/appendix";
import type { DocumentNode } from "../document/nodes";
import type { AggregateOp } from "../expression";
import type { AttributeKind, ClauseOptionOverride, ProductCoverage } from "../product/types";
import type { AttachLevel, Code, Coordinate, Id } from "../types";

// ───────────────────────────── 노드 ─────────────────────────────

export type RefNodeKey =
  | { kind: "discriminator"; code: Code }
  | { kind: "field"; code: Code; fieldCode: Code }
  | { kind: "enum"; enumCode: Code }
  | { kind: "enumValue"; enumCode: Code; valueCode: Code }
  | { kind: "clause"; code: Code }
  | { kind: "clauseOption"; clauseCode: Code; optionCode: Code }
  | { kind: "clauseOptionValue"; clauseCode: Code; optionCode: Code; valueCode: Code }
  | { kind: "document"; id: Id }
  | { kind: "article"; documentId: Id; articleId: Id }
  | { kind: "appendix"; code: Code }
  | { kind: "coverageNode"; level: CoverageNodeLevel; id: Id }
  | { kind: "attribute"; code: Code }
  | { kind: "attributeValue"; code: Code; valueCode: Code }
  | { kind: "product"; id: Id }
  | { kind: "productCoverage"; id: Id }
  /** 그래프가 따로 모델링하지 않는 값 소유 실체 (세목 선택지 · 스냅샷 노드 등). */
  | { kind: "entity"; entityKind: string; id: Id };

export type RefNodeKind = RefNodeKey["kind"];

/** 선언된 실체의 정보. */
export interface RefNodeInfo {
  key: RefNodeKey;
  label: string;
  /** 포함 관계의 상위 실체. */
  parent?: RefNodeKey;
  /** 구분자·필드의 부착 레벨 (const 는 없음). */
  level?: AttachLevel;
  /** 종류 세부 — 구분자 kind(scalar·struct·const·derived) · 문서 kind(special·general) 등. */
  detail?: string;
  /** 문서 노드의 소유 실체 id (담보약관 = 담보 id · 보통약관 = 문서 id). */
  ownerId?: Id;
}

// ───────────────────────────── 간선 ─────────────────────────────

/** 참조의 형태. */
export type EdgeVia =
  /** 조건식(`when`) 안의 참조 — 문서·공용조항 본문 */
  | "when"
  /** 슬롯(`slot.ref`) 참조 — 문서·공용조항 본문 */
  | "slot"
  /** 파생식 안의 참조 */
  | "expression"
  /** 문서 → 공용조항 참조 노드 */
  | "clauseRef"
  /** 문서의 공용조항 참조 노드가 고른 옵션 선택지 (마스터 기본 선택) */
  | "optionSelect"
  /** 상품·상품담보의 옵션 오버라이드 (ADR-0017) */
  | "override"
  /** 조 참조 슬롯 (self · general) */
  | "articleRef"
  /** 조연결 (담보약관 조 → 보통약관 조) */
  | "link"
  /** 별표 참조 슬롯 */
  | "appendixRef"
  /** 담보약관 → 대응 보통약관 · 상품 → 보통약관 템플릿 */
  | "generalDocument"
  /** 담보 마스터 → 담보약관 문서 */
  | "document"
  /** 구분자·필드 → enum (타입) */
  | "type"
  /** 실체 → 구분자 (선택적 노출 부착) */
  | "attach"
  /** 상품담보 → 담보 마스터 (탑재) */
  | "mount"
  /** 상품담보 → 담보속성 유효값 (조합) */
  | "combination";

export interface RefEdge {
  from: RefNodeKey;
  to: RefNodeKey;
  via: EdgeVia;
  /** 참조가 있는 자리의 좌표 (아는 만큼). */
  at: Coordinate;
  /** 집계 인자로 읽었으면 그 집계 (파생식·조건식). */
  aggregate?: AggregateOp;
  /** clauseRef — 참조 노드의 옵션 선택. */
  options?: Record<Code, Code>;
  /** override — 오버라이드가 매달린 문서 쪽 노드(조 또는 문서). */
  through?: RefNodeKey;
}

// ───────────────────────────── 그래프 ─────────────────────────────

export interface RefGraph {
  /** 선언된 실체. 키 = nodeKey. */
  nodes: Map<string, RefNodeInfo>;
  /** 등장 순. */
  edges: RefEdge[];
}

// ───────────────────────────── 입력 ─────────────────────────────

export interface DocumentInput {
  id: Id;
  kind: "special" | "general";
  /** special 의 담보 id. */
  ownerId?: Id;
  title: string;
  generalDocumentId?: Id;
  tree: DocumentNode;
}

/** 선택적 노출 부착 관계 (값 저장소 entity_attachments 한 행). */
export interface AttachmentInput {
  owner: { kind: string; id: Id };
  discriminatorCode: Code;
}

export interface ProductInput {
  id: Id;
  name: string;
  generalDocumentId?: Id;
  coverages: readonly ProductCoverage[];
  overrides: readonly ClauseOptionOverride[];
}

/** 주지 않은 종류는 「선언된 실체 없음」 — 그쪽으로 가는 간선은 깨진 것으로 본다. */
export interface GraphInputs {
  discriminators?: readonly Discriminator[];
  enums?: readonly EnumDef[];
  clauses?: readonly Clause[];
  documents?: readonly DocumentInput[];
  appendices?: readonly Appendix[];
  coverages?: readonly Coverage[];
  attachments?: readonly AttachmentInput[];
  attributeKinds?: readonly AttributeKind[];
  products?: readonly ProductInput[];
}
