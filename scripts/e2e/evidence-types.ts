/**
 * 증거 타임라인의 모양 — 순수 타입만. Playwright 를 import 하지 않는다.
 *
 * 수집은 `tests/e2e/_lib/evidence.ts`(Playwright 결합), 렌더는 `scripts/e2e/failure.ts`(순수)가
 * 각각 이 타입을 쓴다. 양쪽이 같은 모양을 보게 하려고 가운데로 뺐다.
 */

export type EvidenceKind = "action-start" | "action-end" | "console" | "pageerror" | "response" | "requestfailed";

export interface EvidenceEntry {
  /** ISO 8601. */
  at: string;
  kind: EvidenceKind;
  text: string;
  /** action-* 만. */
  coordinate?: string;
  /** action-end 만. */
  ok?: boolean;
  durationMs?: number;
}

export interface FailedAction {
  coordinate: string;
  name: string;
  startedAt: string;
  endedAt: string;
}

export interface EvidenceDump {
  /** 테스트의 시나리오 좌표. `좌표없음` 테스트는 null. */
  coordinate: string | null;
  entries: EvidenceEntry[];
  failedAction: FailedAction | null;
  /** 실패한 액션이 마지막으로 기다리던 것 (에러 메시지에서 뽑는다). */
  lastLocator: string | null;
}
