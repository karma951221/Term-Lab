/**
 * 역할·권한 규칙 (ADR-0019) — 순수 도메인.
 *
 * - 파괴적 액션 = 「이미 저장된 값이나 참조를 없애는 것」. admin 만 실행한다.
 * - editor 는 생성·조회·수정·부착·탑재·값 입력을 한다. 파괴적 호출은 서버가 역할로 거부한다
 *   (화면 숨김 ≠ 잠금).
 * - 파괴적 액션은 2단: 1차 호출 → `needsConfirmation(Impact)` 거부 → `confirm:true` 재호출 → 실행.
 *   편집자의 호출은 Impact 계산 전에 `forbidden`. 최소 구조 위반(precheck)은 admin 도 거부.
 *
 * 다른 영역(coverage · clause · document · product …)의 서비스가 `destructive()` 를 재사용한다.
 */
import { type Actor, type Impact, ok, reject, type Result } from "../types";

// ───────────────────────────── 파괴적 액션 목록 ─────────────────────────────

/**
 * 파괴적 액션 카탈로그. 영역 접두 + 동사. 다른 영역이 쓸 것까지 미리 정의한다 —
 * 새 파괴적 액션이 생기면 여기에 **추가만** 한다 (기존 값 변경 금지).
 */
export const DESTRUCTIVE_ACTIONS = [
  // catalog (A2)
  "catalog.delete", // 구분자 정의 삭제 — 값 행 연쇄 삭제 · 참조 오류화
  "catalog.changeType", // 구분자(scalar)·필드 타입 변경 — 저장 값 행 전부 삭제
  "catalog.deleteField", // 구조체 필드 삭제 — 그 필드의 값 행 삭제
  "enum.deleteValue", // enum 값 삭제 — 그 값을 고른 값 행 삭제
  "enum.delete", // enum 정의 삭제 — 값 전부 · 참조 필드 오류화
  // coverage (B1)
  "coverage.deleteNode", // 담보·세부보장·급부 노드 삭제 — 하위 값 행 연쇄 삭제
  "coverage.detach", // 부착 해제 — 그 실체의 값 행 삭제
  // clause (B2)
  "clause.delete", // 공용조항 삭제 — 참조 문면 오류화
  // document (B3)
  "document.delete", // 문면 마스터 삭제
  "appendix.delete", // 별표 마스터 삭제 — 참조 슬롯 오류화
  // product (B4)
  "product.delete", // 상품 삭제 — 상품담보·스냅샷 값 연쇄 삭제
  "product.unmount", // 상품담보 탑재 해제 — 스냅샷 값 삭제
  "product.detachPlan", // 세목 조합 제거
  "attribute.delete", // 담보속성 종류 삭제 — 상품담보 조합 오류화
  "attribute.deleteValue", // 담보속성 유효값 삭제
] as const;

export type DestructiveAction = (typeof DESTRUCTIVE_ACTIONS)[number];

export function isDestructiveAction(action: string): action is DestructiveAction {
  return (DESTRUCTIVE_ACTIONS as readonly string[]).includes(action);
}

// ───────────────────────────── 역할 검사 ─────────────────────────────

/**
 * actor 가 이 파괴적 액션을 할 수 있는가. 지금 규칙은 「파괴적 액션 전부 = admin 만」이라
 * action 은 판정에 쓰이지 않지만, 경계가 액션별로 갈릴 때(ADR-0019 잠정 기준 리뷰) 여기만 바꾼다.
 */
export function can(actor: Actor, action: DestructiveAction): boolean {
  void action;
  return actor.role === "admin";
}

/** `can` 의 Result 판. editor 의 파괴적 액션 → `forbidden { role, action }`. */
export function assertCan(actor: Actor, action: DestructiveAction): Result<void> {
  if (can(actor, action)) return ok(undefined);
  return reject({ reason: "forbidden", role: actor.role, action });
}

// ───────────────────────────── 2단 프로토콜 ─────────────────────────────

export interface DestructiveCall<T> {
  actor: Actor;
  action: DestructiveAction;
  /** 1차 호출은 생략(또는 false). 영향 목록을 본 뒤 true 로 재호출한다. */
  confirm?: boolean;
  /**
   * 역할 검사 뒤 · 영향 계산 전에 도는 검사 — 최소 구조 위반(`minimumStructure`) ·
   * 대상 없음(`notFound`) 등. 거부면 admin 이어도 여기서 끝난다.
   */
  precheck?: () => Promise<Result<void>> | Result<void>;
  /** 영향 범위 계산. confirm 이 없을 때만 호출된다. */
  computeImpact: () => Promise<Impact> | Impact;
  /** 실제 실행. confirm:true 이고 앞 검사를 모두 통과했을 때만 호출된다. */
  execute: () => Promise<Result<T>> | Result<T>;
}

/**
 * 파괴적 액션 공통 흐름.
 *
 * ```
 * assertCan(actor, action)     → editor 면 forbidden (Impact 계산 전)
 * precheck()                   → 최소 구조 위반 등은 admin 도 거부
 * !confirm → computeImpact()   → needsConfirmation(impact)
 * confirm  → execute()         → Result<T>
 * ```
 */
export async function destructive<T>(call: DestructiveCall<T>): Promise<Result<T>> {
  const allowed = assertCan(call.actor, call.action);
  if (!allowed.ok) return allowed as Result<T>;

  if (call.precheck) {
    const pre = await call.precheck();
    if (!pre.ok) return pre as Result<T>;
  }

  if (!call.confirm) {
    const impact = await call.computeImpact();
    return reject({ reason: "needsConfirmation", impact });
  }

  return call.execute();
}
