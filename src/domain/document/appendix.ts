/**
 * 별표 마스터 (도메인모델 §3 · 문면_기획 「참조 슬롯」 · D-P4-23).
 *
 * - 전상품 superset. 문면에는 코드 참조만 들어가고 번호는 책자별 계산값 (조립).
 * - 코드는 **유저 입력 · 등록 후 불변 · 중복 거부** — 시스템 채번 원칙(ADR-0005)의 유일한 예외 (기획 발언 근거).
 * - 내용(표 본문) 출력은 MVP 밖 — 코드 · 이름 · 설명만.
 */

import { ok, reject } from "../types";
import type { Code, Result } from "../types";

export interface Appendix {
  code: Code;
  name: string;
  description: string;
}

export interface NewAppendix {
  code: Code;
  name: string;
  description?: string;
}

function invalid<T>(message: string): Result<T> {
  return reject({ reason: "invalid", issues: [{ kind: "typeMismatch", message, at: {} }] });
}

/** 코드 형식 — 공백 없는 비어 있지 않은 문자열. */
const CODE_RE = /^\S+$/;

export function createAppendix(input: NewAppendix, existingCodes: readonly Code[]): Result<Appendix> {
  const code = input.code.trim();
  if (!CODE_RE.test(code) || code !== input.code) return invalid("별표 코드는 공백 없는 문자열이어야 합니다");
  const name = input.name.trim();
  if (name === "") return invalid("별표 이름은 비울 수 없습니다");
  if (existingCodes.includes(code)) return reject({ reason: "duplicate", what: `별표 코드 ${code}` });
  return ok({ code, name, description: input.description ?? "" });
}

export function renameAppendix(a: Appendix, name: string): Result<Appendix> {
  if (name.trim() === "") return invalid("별표 이름은 비울 수 없습니다");
  return ok({ ...a, name: name.trim() });
}

export function setAppendixDescription(a: Appendix, description: string): Result<Appendix> {
  return ok({ ...a, description });
}
