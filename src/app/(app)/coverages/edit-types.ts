/**
 * 담보 상세의 편집 초안 — EditShell 하나가 네 탭의 변경을 다 담는다 (담보_화면기획 §1 「조작과 상태 전이」).
 * 키는 `<level>:<id>` (lib.ts 의 encodeNodeKey) 로 통일한다.
 */
import type { Submission } from "@/forms";

export interface CoverageEditData extends Record<string, unknown> {
  /** 담보명. EditShell 이 `label` 을 헤더 제목으로 쓴다. */
  label: string;
  description: string;
  /** 세부보장 · 급부의 이름. 담보 자신은 `label` 이 정본이라 여기 없다. */
  names: Record<string, string>;
  /** 노드별 값 초안. 손댄 노드만 들어온다. */
  values: Record<string, Submission>;
}
