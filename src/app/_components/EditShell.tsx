"use client";

import { createContext, useContext, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import type { EditOutcome } from "@/app/_lib/edit";
import { isDirty } from "@/app/_lib/edit";
import { IconButton, IconClose, IconTrash } from "./icons";
import { InfoTip } from "./InfoTip";

type EditData = Record<string, unknown>;
interface EditContextValue<T extends EditData = EditData> {
  mode: "read" | "edit";
  pending: boolean;
  data: T;
  setValue: (name: string, value: unknown) => void;
}

const EditContext = createContext<EditContextValue | null>(null);

export function useEditField<T = unknown>(name: string): { mode: "read" | "edit"; pending: boolean; value: T; setValue: (value: T) => void } {
  const context = useContext(EditContext);
  if (!context) throw new Error("Field는 EditShell 안에서만 쓸 수 있습니다.");
  return { mode: context.mode, pending: context.pending, value: context.data[name] as T, setValue: (value) => context.setValue(name, value) };
}

function ImpactLines({ outcome }: { outcome: Extract<EditOutcome, { ok: "confirm" }> }) {
  const { impact } = outcome;
  return <ul className="ts-confirm-loss">
    <li>사람이 입력한 값 {impact.valueRowsLost}건이 사라진다</li>
    {impact.cascade.length ? <li>함께 삭제되는 항목 {impact.cascade.length}건</li> : null}
    {impact.brokenRefs.length ? <li>깨질 참조 {impact.brokenRefs.length}건</li> : null}
  </ul>;
}

export function EditShell<T extends EditData>({
  initial,
  title,
  code,
  headerMeta,
  backHref,
  backLabel,
  saveAction,
  deleteAction,
  deleteLabel,
  deleteTooltip,
  deleteSuccessHref,
  children,
}: {
  initial: T;
  title: string;
  /** 코드가 있는 실체만 — 담보처럼 도메인에 코드가 없으면 넘기지 않는다 (없는 값을 화면이 지어내지 않는다). */
  code?: string;
  headerMeta?: ReactNode;
  /** 목록으로 돌아가는 링크 — 헤더 위 좌상단에 둔다 (화면 하단에 조작을 두지 않는다). */
  backHref?: string;
  backLabel?: string;
  saveAction: (input: T, confirm?: boolean) => Promise<EditOutcome>;
  deleteAction?: (confirm?: boolean) => Promise<EditOutcome>;
  deleteLabel?: string;
  deleteTooltip?: string;
  deleteSuccessHref?: string;
  children: ReactNode;
}) {
  const [mode, setMode] = useState<"read" | "edit">("read");
  const [baseline, setBaseline] = useState<T>(initial);
  const [data, setData] = useState<T>(initial);
  const [error, setError] = useState("");
  const [discardOpen, setDiscardOpen] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: "save" | "delete"; outcome: Extract<EditOutcome, { ok: "confirm" }> }>();
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const dirty = isDirty(baseline, data);
  const shownTitle = typeof data.label === "string" ? data.label : title;

  const handle = (kind: "save" | "delete", confirmed = false) => {
    startTransition(async () => {
      const outcome = kind === "save" ? await saveAction(data, confirmed) : await deleteAction!(confirmed);
      if (outcome.ok === "confirm") {
        setConfirm({ kind, outcome });
        return;
      }
      if (!outcome.ok) {
        setError(outcome.message);
        setConfirm(undefined);
        return;
      }
      setError("");
      setConfirm(undefined);
      if (kind === "delete") {
        router.replace(deleteSuccessHref ?? "/");
        return;
      }
      setBaseline(data);
      setMode("read");
      router.refresh();
    });
  };

  return <EditContext.Provider value={{ mode, pending, data, setValue: (name, value) => setData((current) => ({ ...current, [name]: value })) }}>
    {backHref ? <p className="ts-back"><Link href={backHref}>← {backLabel ?? "목록"}</Link></p> : null}
    <div className="ts-edit-head">
      <h2 className="ts-h1">{shownTitle}</h2>{code ? <code className="ts-mono ts-muted">{code}</code> : null}{headerMeta}
      <span className="ts-edit-actions">
        {mode === "read" ? <button type="button" onClick={() => setMode("edit")} disabled={pending}>편집</button> : <><IconButton icon={<IconClose />} label="편집 취소" disabled={pending} onClick={() => dirty ? setDiscardOpen(true) : setMode("read")} /><button type="button" className="primary" disabled={!dirty || pending} onClick={() => handle("save")}>{pending ? "저장 중…" : "저장"}</button></>}
        {deleteAction ? <IconButton icon={<IconTrash />} label={deleteTooltip ?? deleteLabel ?? `${shownTitle} 삭제`} danger disabled={pending} onClick={() => handle("delete")} /> : null}
      </span>
    </div>
    {error ? <p className="ts-error-banner">{error}</p> : null}
    <fieldset className="ts-edit-fields" disabled={pending}>{children}</fieldset>
    {discardOpen ? <dialog open className="ts-dialog"><p className="ts-confirm-title">고친 내용을 버립니까?</p><div className="ts-confirm-actions"><button type="button" onClick={() => setDiscardOpen(false)}>계속 편집</button><button type="button" className="danger" onClick={() => { setData(baseline); setMode("read"); setDiscardOpen(false); setError(""); }}>버리기</button></div></dialog> : null}
    {confirm ? <dialog open className="ts-dialog"><p className="ts-confirm-title">{confirm.kind === "save" ? "변경하면 저장된 값이 사라질 수 있다" : `${deleteLabel ?? shownTitle} 삭제`}</p><ImpactLines outcome={confirm.outcome} /><div className="ts-confirm-actions"><button type="button" onClick={() => setConfirm(undefined)} disabled={pending}>취소</button><button type="button" className="danger" onClick={() => handle(confirm.kind, true)} disabled={pending}>{confirm.kind === "save" ? `타입 바꾸고 값 ${confirm.outcome.impact.valueRowsLost}건 삭제` : deleteLabel ?? "삭제"}</button></div></dialog> : null}
  </EditContext.Provider>;
}

export function Field({ name, label, info, type = "text", options = [], readValue, className }: { name: string; label: string; info?: string; type?: "text" | "textarea" | "select" | "checkbox" | "number" | "date"; options?: readonly { value: string; label: string }[]; readValue?: (value: unknown) => ReactNode; className?: string }) {
  const field = useEditField(name);
  const display = readValue ? readValue(field.value) : field.value === undefined || field.value === "" ? "없음" : typeof field.value === "boolean" ? field.value ? "무조건" : "선택" : String(field.value);
  return <div className="ts-form-row"><label>{label}{info ? <InfoTip text={info} /> : null}</label><div className="ts-form-control">{field.mode === "read" ? <span className={`ts-field-locked ${className ?? ""}`}>{display}</span> : type === "textarea" ? <textarea value={String(field.value ?? "")} onChange={(event) => field.setValue(event.target.value)} rows={2} className="ts-field-direct" /> : type === "select" ? <select value={String(field.value ?? "")} onChange={(event) => field.setValue(event.target.value)} className="ts-field-direct">{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : type === "checkbox" ? <label className="ts-form-check"><input type="checkbox" checked={Boolean(field.value)} onChange={(event) => field.setValue(event.target.checked)} /> 무조건 — 이 레벨의 모든 모델링에 값 자리를 만든다</label> : <input type={type} value={String(field.value ?? "")} onChange={(event) => field.setValue(type === "number" && event.target.value !== "" ? Number(event.target.value) : event.target.value)} className={`ts-field-direct ${className ?? ""}`} />}</div></div>;
}
