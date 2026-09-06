"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { TYPE_LABEL } from "@/app/_lib/labels";

import { addTypeFieldAction, createInlineEnumAction } from "../../actions";

interface EnumOption { code: string; label: string }

export function FieldAddRow({ code, initialEnums }: { code: string; initialEnums: EnumOption[] }) {
  const [typeKind, setTypeKind] = useState("string");
  const [enums, setEnums] = useState(initialEnums);
  const [enumCode, setEnumCode] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const isEnum = typeKind === "enum" || typeKind === "list<enum>";

  return <>
    <form action={addTypeFieldAction.bind(null, code)} className="ts-add-row ts-field-add-row">
      <label htmlFor="new-field-label">필드 추가</label>
      <input id="new-field-label" name="label" placeholder="표시명" required />
      <select name="typeKind" value={typeKind} onChange={(event) => setTypeKind(event.target.value)}>{Object.entries(TYPE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      {isEnum ? <><select name="enumCode" value={enumCode} onChange={(event) => setEnumCode(event.target.value)} required><option value="">선택지 고르기</option>{enums.map((item) => <option key={item.code} value={item.code}>{item.label} ({item.code})</option>)}</select><button type="button" onClick={() => dialog.current?.showModal()}>새 선택지</button></> : <input type="hidden" name="enumCode" value="" />}
      <button type="submit">추가</button>
    </form>
    <dialog ref={dialog} className="ts-dialog">
      <form onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(async () => {
          const result = await createInlineEnumAction({ label: String(data.get("label") ?? ""), values: String(data.get("values") ?? "").split(/\r?\n/) });
          if (!result.ok) { setError(result.message); return; }
          setEnums((current) => [...current, result.item]);
          setEnumCode(result.item.code);
          setError("");
          dialog.current?.close();
          router.refresh();
        });
      }} className="ts-form">
        <h3 className="ts-form-title">새 선택지</h3>
        {error ? <p className="ts-error-banner">{error}</p> : null}
        <div className="ts-form-row"><label htmlFor="dialog-enum-label">표시명</label><div className="ts-form-control"><input id="dialog-enum-label" name="label" disabled={pending} required /></div></div>
        <div className="ts-form-row"><label htmlFor="dialog-enum-values">값</label><div className="ts-form-control"><textarea id="dialog-enum-values" name="values" rows={5} disabled={pending} placeholder={'한 줄에 하나'} /></div></div>
        <div className="ts-form-actions"><button type="button" disabled={pending} onClick={() => dialog.current?.close()}>취소</button><button type="submit" className="primary" disabled={pending}>{pending ? "생성 중…" : "생성"}</button></div>
      </form>
    </dialog>
  </>;
}
