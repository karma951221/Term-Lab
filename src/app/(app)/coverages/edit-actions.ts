"use server";

/**
 * 담보 상세의 편집 흐름 서버 액션 — 「저장 하나」가 담보명 · 설명 · 노드 이름 · 네 탭의 값을 다 담는다
 * (담보_화면기획 §1 「조작과 상태 전이」 · 디자인원칙 §2 L2).
 * 구조(세부보장 · 급부의 추가 · 삭제 · 순서)는 여기 없다 — 생성 화면에서만 정한다 (2026-09-06 확정).
 */
import { describeRejection } from "@/app/_lib/rejection";
import type { EditOutcome } from "@/app/_lib/edit";
import type { CoverageNodeRef } from "@/domain/coverage";
import type { Id, Result } from "@/domain/types";
import { currentActor, getServices } from "@/lib/services";

import type { CoverageEditData } from "./edit-types";
import { decodeNodeKey, encodeNodeKey } from "./lib";

function failed<T>(result: Result<T>, token: string): EditOutcome | undefined {
  if (result.ok) return undefined;
  if (result.rejection.reason === "needsConfirmation") return { ok: "confirm", impact: result.rejection.impact, token };
  return { ok: false, message: describeRejection(result.rejection).message };
}

export async function saveCoverageEditAction(id: Id, input: CoverageEditData): Promise<EditOutcome> {
  const actor = await currentActor();
  const services = getServices();
  const current = await services.coverage.get(id);
  if (!current) return { ok: false, message: "담보를 찾을 수 없습니다." };

  if (input.label !== current.name) {
    const error = failed(await services.coverage.rename(actor, id, input.label), "label");
    if (error) return error;
  }
  if (input.description !== current.description) {
    const error = failed(await services.coverage.setDescription(actor, id, input.description), "description");
    if (error) return error;
  }

  // 세부보장 · 급부 이름 — 바뀐 것만.
  for (const sub of current.subCoverages) {
    const next = input.names[encodeNodeKey("subCoverage", sub.id)];
    if (next !== undefined && next !== sub.name) {
      const error = failed(await services.coverage.renameSubCoverage(actor, sub.id, next), encodeNodeKey("subCoverage", sub.id));
      if (error) return error;
    }
    for (const benefit of sub.benefits) {
      const nextBenefit = input.names[encodeNodeKey("benefit", benefit.id)];
      if (nextBenefit !== undefined && nextBenefit !== benefit.name) {
        const error = failed(await services.coverage.renameBenefit(actor, benefit.id, nextBenefit), encodeNodeKey("benefit", benefit.id));
        if (error) return error;
      }
    }
  }

  // 값 — 손댄 노드만. 폼이 낸 issue 가 있으면 저장하지 않는다.
  for (const [key, submission] of Object.entries(input.values)) {
    const owner = decodeNodeKey(key) as CoverageNodeRef | undefined;
    if (!owner) continue;
    if (submission.issues.length > 0) return { ok: false, message: submission.issues[0]!.message };
    for (const entry of submission.values) {
      const result =
        entry.value === undefined
          ? await services.coverage.clearValue(actor, owner, entry.path)
          : await services.coverage.writeValue(actor, owner, entry.path, entry.value);
      const error = failed(result, key);
      if (error) return error;
    }
  }

  return { ok: true };
}

export async function removeCoverageEditAction(id: Id, confirm = false): Promise<EditOutcome> {
  return failed(await getServices().coverage.remove(await currentActor(), id, { confirm }), "delete") ?? { ok: true };
}

/** 부착 · 부착 해제는 파괴적일 수 있어 저장에 안 묶고 즉시 실행한다 (담보_화면기획 §1). */
export async function attachEditAction(owner: CoverageNodeRef, code: string): Promise<EditOutcome> {
  return failed(await getServices().coverage.attach(await currentActor(), owner, code), code) ?? { ok: true };
}

export async function detachEditAction(owner: CoverageNodeRef, code: string, confirm = false): Promise<EditOutcome> {
  return failed(await getServices().coverage.detach(await currentActor(), owner, code, { confirm }), code) ?? { ok: true };
}
