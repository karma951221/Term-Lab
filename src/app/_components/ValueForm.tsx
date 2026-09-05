"use client";

/**
 * StructForm 을 서버 액션에 연결하는 얇은 클라이언트 래퍼.
 * StructForm 은 `onSubmit(submission)` 을 직접(폼 action 이 아니라 이벤트로) 부르므로,
 * 서버 액션을 이벤트 핸들러로 호출하는 패턴(Next.js 「Event Handlers」)을 쓴다.
 */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { Issue } from "@/domain/types";
import { StructForm, type FormModel, type Submission } from "@/forms";

export interface ActionOutcome {
  ok: boolean;
  issues?: Issue[];
}

export function ValueForm({
  model,
  action,
  submitLabel,
}: {
  model: FormModel;
  /** 저장 서버 액션 — 실패하면 issues 를 실어 돌려준다. */
  action: (submission: Submission) => Promise<ActionOutcome>;
  submitLabel?: string;
}) {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <StructForm
      model={model}
      pending={pending}
      issues={issues}
      submitLabel={submitLabel}
      onSubmit={(submission) => {
        startTransition(async () => {
          const r = await action(submission);
          if (!r.ok) {
            setIssues(r.issues ?? []);
          } else {
            setIssues([]);
            router.refresh();
          }
        });
      }}
    />
  );
}
