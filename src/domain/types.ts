/**
 * 도메인 공용 타입 — 2차 구현의 공유 계약.
 *
 * 규칙: 이 파일을 포함한 `src/domain/**` 은 순수 도메인 로직만 담는다.
 * DB(drizzle, pglite, pg)·React·Next 를 import 하지 않는다. (eslint.config.mjs 에서 강제)
 *
 * 여기 있는 것은 여러 모듈이 함께 쓰는 **최소 계약**뿐이다. 모듈 전용 타입은 각 모듈에 둔다.
 * 근거: docs/00_시작/도메인모델.md · docs/01_기획/구분자_기획.md · ADR-0004 · ADR-0005 · ADR-0019.
 */

// ───────────────────────────── 식별 ─────────────────────────────

/** 시스템이 자동 채번하는 불변 코드 (ADR-0005). 유저 입력 불가. 저장·참조의 정본. */
export type Code = string;

/** 저장소 행 식별자 (uuid). 코드와 별개 — 코드는 참조용, id 는 저장소용. */
export type Id = string;

// ───────────────────────────── 값의 체계 ─────────────────────────────

/** 구조체 필드 타입 (list<T> 는 2026-09-01 MVP 제외). */
export type FieldType =
  | { kind: "string" }
  | { kind: "number" }
  | { kind: "boolean" }
  | { kind: "date" }
  | { kind: "enum"; enumCode: Code }
  | { kind: "list<enum>"; enumCode: Code };

export type FieldTypeKind = FieldType["kind"];

/** 스칼라 값. date 는 `YYYY-MM-DD` 문자열. enum 은 enum 값의 코드. */
export type ScalarValue = string | number | boolean;

/** 저장·평가되는 값. list<enum> 은 enum 값 코드 배열. */
export type Value = ScalarValue | string[];

/**
 * 값 자리 — null 은 없다. 자리는 「명시 입력된 값」 또는 「미입력」 둘뿐이다 (ADR-0004).
 * 기본값은 여기로 자동 유입되지 않는다 (폼 프리필 전용).
 */
export type ValueSlot =
  | { entered: true; value: Value }
  | { entered: false };

export const NOT_ENTERED: ValueSlot = { entered: false };

export function entered(value: Value): ValueSlot {
  return { entered: true, value };
}

/** 구분자 부착 레벨 5개. 조합 실체(상품담보)에는 정의를 부착하지 않는다. */
export type AttachLevel = "product" | "plan" | "coverage" | "subCoverage" | "benefit";

export const ATTACH_LEVELS: readonly AttachLevel[] = [
  "product",
  "plan",
  "coverage",
  "subCoverage",
  "benefit",
];

/** 부착 레벨의 한글 표시명 (용어사전). */
export const ATTACH_LEVEL_LABEL: Record<AttachLevel, string> = {
  product: "상품",
  plan: "세목",
  coverage: "담보",
  subCoverage: "세부보장",
  benefit: "급부",
};

// ───────────────────────────── 역할·권한 (ADR-0019) ─────────────────────────────

export type Role = "admin" | "editor";

/** 액션을 일으키는 사람. 서비스 계층의 모든 쓰기 액션은 actor 를 첫 인자로 받는다. */
export interface Actor {
  userId: Id;
  role: Role;
}

// ───────────────────────────── 오류 좌표 ─────────────────────────────

/**
 * 오류 좌표 — 조립 오류 패널·완결성 조회·부착 재검사·관계정보 뷰가 공유하는 표기.
 * 문서 종류 → 실체 → 조 → 노드 경로. 모든 항목은 「아는 만큼만」 채운다.
 */
export interface Coordinate {
  /** 문서 종류: 보통약관 / 특별약관(상품담보) / 공용조항 정의 / 담보 마스터 / 상품 */
  document?: "general" | "special" | "clause" | "coverageMaster" | "product";
  /** 문서를 소유한 실체 — 보통약관 템플릿 id · 상품담보 id · 공용조항 id · 담보 id · 상품 id */
  ownerId?: Id;
  /** 사람이 읽을 소유 실체 이름 (상품담보명 등) */
  ownerName?: string;
  /** 조 노드 id */
  articleId?: Id;
  /** 조 명 (계산된 번호는 조립 결과에서만 채운다) */
  articleTitle?: string;
  /** 문서 루트에서 해당 노드까지의 노드 id 경로 */
  nodePath?: Id[];
  /** 식 안의 참조 경로 (예: `cov_pay.exempt`) */
  refPath?: string;
}

/** 오류 원인의 종류. 조립·평가·검증이 공통으로 쓴다. */
export type IssueKind =
  | "notEntered" // 미입력 값 참조
  | "unusedAttribute" // 미사용 담보속성 참조
  | "brokenRef" // 깨진 참조 (삭제된 구분자·필드·enum 값·공용조항·조·별표)
  | "articleGone" // 대상 조가 분기로 사라짐
  | "optionUnselected" // 공용조항 옵션 미선택
  | "optionInvalid" // 유효 옵션 집합 밖 선택/오버라이드
  | "noBaseContract" // 기본계약 미지정
  | "notAttached" // 요구 구분자 미부착 (값 자리 없음)
  | "typeMismatch" // 조건 자리에 boolean 아님 등
  | "unplaced" // 그룹에 배치되지 않은 상품담보
  | "syntax" // 식 문법 오류
  | "structure"; // 문면 트리 규칙 위반 (허용 자식 · 인라인 조건 중첩 · 노드 id 중복 · else 위치 등, ADR-0012)

export interface Issue {
  kind: IssueKind;
  message: string;
  at: Coordinate;
}

// ───────────────────────────── 결과 ─────────────────────────────

/** 서비스 계층이 돌려주는 거부. 화면 숨김이 아니라 서버 거부의 표현. */
export type Rejection =
  | { reason: "forbidden"; role: Role; action: string } // 역할 거부 (ADR-0019)
  | { reason: "duplicate"; what: string } // 중복 (코드·이름·조합)
  | { reason: "minimumStructure"; what: string } // 최소 구조 위반
  | { reason: "needsConfirmation"; impact: Impact } // 파괴적 액션 — 영향 확인 필요
  | { reason: "invalid"; issues: Issue[] } // 검증 실패
  | { reason: "notFound"; what: string };

/** 파괴적 액션의 영향 범위 — 확인 다이얼로그가 보여주는 것. */
export interface Impact {
  /** 소실될 값 행 수 */
  valueRowsLost: number;
  /** 깨질 참조 목록 */
  brokenRefs: Coordinate[];
  /** 함께 삭제될 하위 실체 (이름) */
  cascade: string[];
}

export type Result<T> = { ok: true; value: T } | { ok: false; rejection: Rejection };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function reject<T = never>(rejection: Rejection): Result<T> {
  return { ok: false, rejection };
}
