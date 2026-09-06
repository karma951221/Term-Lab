"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type { EditOutcome } from "@/app/_lib/edit";
import { IconButton, IconTrash } from "./icons";

export function ConfirmActionButton({ label, action }: { label: string; action: (confirm?: boolean) => Promise<EditOutcome> }) {
  const [outcome, setOutcome] = useState<Extract<EditOutcome, { ok: "confirm" }>>();
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const run = (confirm = false) => startTransition(async () => {
    const result = await action(confirm);
    if (result.ok === "confirm") { setOutcome(result); return; }
    if (!result.ok) { setError(result.message); setOutcome(undefined); return; }
    setOutcome(undefined); setError(""); router.refresh();
  });
  return <>
    <IconButton icon={<IconTrash />} label={label} danger disabled={pending} onClick={() => run()} />
    {error ? <span className="ts-error">{error}</span> : null}
    {outcome ? <dialog open className="ts-dialog"><p className="ts-confirm-title">{label}</p><ul className="ts-confirm-loss"><li>사람이 입력한 값 {outcome.impact.valueRowsLost}건이 사라진다</li>{outcome.impact.brokenRefs.length ? <li>깨질 참조 {outcome.impact.brokenRefs.length}건</li> : null}</ul><div className="ts-confirm-actions"><button type="button" onClick={() => setOutcome(undefined)} disabled={pending}>취소</button><button type="button" className="danger" onClick={() => run(true)} disabled={pending}>삭제</button></div></dialog> : null}
  </>;
}
