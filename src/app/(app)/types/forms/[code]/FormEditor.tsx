"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { ConfirmActionButton } from "@/app/_components/ConfirmActionButton";
import { DefaultValueInput } from "@/app/_components/DefaultValueInput";
import { EditShell, Field, useEditField } from "@/app/_components/EditShell";
import { InfoTip } from "@/app/_components/InfoTip";
import { IconButton, IconClose, IconDown, IconUp } from "@/app/_components/icons";
import { LEVEL_LABEL, TYPE_LABEL } from "@/app/_lib/labels";
import type { EnumDef, StructDiscriminator } from "@/domain/catalog";
import type { FieldType } from "@/domain/types";

import { createInlineEnumAction } from "../../actions";
import { removeFormEditAction, removeFormFieldEditAction, saveFormEditAction } from "../../edit-actions";
import type { FormEditData, FormEditField } from "../../edit-types";

const LEVEL_INFO = "이 구분자가 붙는 모델링의 층. 담보에 붙이면 담보마다 값을 갖는다";
const EXPOSURE_INFO = "선택이면 담보 · 상품 화면에서 이 구분자를 붙인 곳에만 값 자리가 생긴다";
const DEFAULT_INFO = "폼을 열 때 미리 채워 보여줄 제안. 사람이 저장해야 값이 된다";

function selectedEnum(type: FieldType, enums: EnumDef[]) {
  if (type.kind !== "enum" && type.kind !== "list<enum>") return undefined;
  return enums.find((item) => item.code === type.enumCode);
}

function defaultLabel(field: FormEditField, enums: EnumDef[]) {
  if (field.defaultValue === undefined) return "없음";
  if (field.type.kind === "boolean") return field.defaultValue ? "예" : "아니오";
  const choice = selectedEnum(field.type, enums);
  if (choice) {
    const values = Array.isArray(field.defaultValue) ? field.defaultValue : [field.defaultValue];
    return values.map((value) => choice.values.find((item) => item.code === value)?.label ?? String(value)).join(" · ");
  }
  return Array.isArray(field.defaultValue) ? field.defaultValue.join(" · ") : String(field.defaultValue);
}

function FieldTypeEditor({ field, update }: { field: FormEditField; update: (field: FormEditField) => void }) {
  return <select value={field.type.kind} onChange={(event) => {
    const kind = event.target.value as FieldType["kind"];
    update({
      ...field,
      type: kind === "enum" || kind === "list<enum>" ? { kind, enumCode: "" } : { kind } as FieldType,
      defaultValue: undefined,
    });
  }}>{Object.entries(TYPE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>;
}

function ChoiceCell({ field, enums, update, mode }: { field: FormEditField; enums: EnumDef[]; update: (field: FormEditField) => void; mode: "read" | "edit" }) {
  if (field.type.kind !== "enum" && field.type.kind !== "list<enum>") return <>—</>;
  const choice = selectedEnum(field.type, enums);
  if (mode === "read") return <Link href={`/types/enums/${field.type.enumCode}`}>{choice?.label ?? field.type.enumCode}</Link>;
  return <select value={field.type.enumCode} onChange={(event) => update({ ...field, type: { kind: field.type.kind, enumCode: event.target.value }, defaultValue: undefined })}>
    <option value="">선택지 고르기</option>
    {enums.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
  </select>;
}

function NewFieldComposer({ enums, setEnums, add }: { enums: EnumDef[]; setEnums: React.Dispatch<React.SetStateAction<EnumDef[]>>; add: (field: FormEditField) => void }) {
  const [label, setLabel] = useState("");
  const [type, setType] = useState<FieldType>({ kind: "string" });
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const dialog = useRef<HTMLDialogElement>(null);
  const next = useRef(1);
  const isChoice = type.kind === "enum" || type.kind === "list<enum>";
  const router = useRouter();
  return <>
    <div className="ts-add-row ts-field-add-row"><label>필드 추가</label><input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="표시명" /><select value={type.kind} onChange={(event) => { const kind = event.target.value as FieldType["kind"]; setType(kind === "enum" || kind === "list<enum>" ? { kind, enumCode: "" } : { kind } as FieldType); }}>{Object.entries(TYPE_LABEL).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select>{isChoice ? <><select value={type.enumCode} onChange={(event) => setType({ kind: type.kind, enumCode: event.target.value })}><option value="">선택지 고르기</option>{enums.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select><button type="button" onClick={() => dialog.current?.showModal()}>새 선택지</button></> : null}<button type="button" disabled={!label.trim() || (isChoice && !type.enumCode)} onClick={() => { add({ code: `new:${next.current++}`, label: label.trim(), type }); setLabel(""); }}>추가</button></div>
    <dialog ref={dialog} className="ts-dialog"><form className="ts-form" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); startTransition(async () => { const result = await createInlineEnumAction({ label: String(data.get("label") ?? ""), values: String(data.get("values") ?? "").split(/\r?\n/) }); if (!result.ok) { setError(result.message); return; } const item: EnumDef = result.item; setEnums((current) => [...current, item]); setType((current) => current.kind === "enum" || current.kind === "list<enum>" ? { kind: current.kind, enumCode: item.code } : current); setError(""); dialog.current?.close(); router.refresh(); }); }}><h3 className="ts-form-title">새 선택지</h3>{error ? <p className="ts-error-banner">{error}</p> : null}<div className="ts-form-row"><label>표시명</label><div className="ts-form-control"><input name="label" required disabled={pending} /></div></div><div className="ts-form-row"><label>값</label><div className="ts-form-control"><textarea name="values" rows={5} placeholder="한 줄에 하나" disabled={pending} /></div></div><div className="ts-form-actions"><button type="button" onClick={() => dialog.current?.close()} disabled={pending}>취소</button><button type="submit" className="primary" disabled={pending}>생성</button></div></form></dialog>
  </>;
}

function FieldsEditor({ code, enums, setEnums, usage }: { code: string; enums: EnumDef[]; setEnums: React.Dispatch<React.SetStateAction<EnumDef[]>>; usage: Record<string, number> }) {
  const fieldState = useEditField<FormEditField[]>("fields");
  const update = (next: FormEditField) => fieldState.setValue(fieldState.value.map((item) => item.code === next.code ? next : item));
  const move = (index: number, delta: number) => { const fields = [...fieldState.value]; const target = index + delta; if (target < 0 || target >= fields.length) return; [fields[index], fields[target]] = [fields[target]!, fields[index]!]; fieldState.setValue(fields); };
  return <section className="ts-section">
    <h3 className="ts-section-title">필드 <span className="ts-count">{fieldState.value.length}</span></h3>
    <table className="ts-table">
      <thead><tr><th className="col-num">순서</th><th className="col-code">코드</th><th className="col-flex">표시명</th><th className="col-fixed-md">타입</th><th className="col-fixed-md">선택지</th><th>기본값 <InfoTip text={DEFAULT_INFO} /></th><th className="col-num">사용 수</th>{fieldState.mode === "edit" ? <th className="col-act">조작</th> : null}</tr></thead>
      <tbody>{fieldState.value.map((field, index) => {
        const saved = !field.code.startsWith("new:");
        return <tr key={field.code}>
          <td className="col-num">{index + 1}</td>
          <td className="col-code"><code>{saved ? field.code : "새 필드"}</code></td>
          <td>{fieldState.mode === "read" ? <span className="ts-field-locked">{field.label}</span> : <input value={field.label} onChange={(event) => update({ ...field, label: event.target.value })} />}</td>
          <td>{fieldState.mode === "read" ? TYPE_LABEL[field.type.kind] : <FieldTypeEditor field={field} update={update} />}</td>
          <td><ChoiceCell field={field} enums={enums} update={update} mode={fieldState.mode} /></td>
          <td>{fieldState.mode === "read" ? <span className="ts-field-locked">{defaultLabel(field, enums)}</span> : <DefaultValueInput type={field.type} value={field.defaultValue} onChange={(value) => update({ ...field, defaultValue: value })} enums={enums} />}</td>
          <td className="col-num">{saved ? usage[field.code] || "—" : "—"}</td>
          {fieldState.mode === "edit" ? <td className="col-act"><span className="ts-row-actions"><IconButton icon={<IconUp />} label={`${field.label} 위로`} disabled={index === 0} onClick={() => move(index, -1)} /><IconButton icon={<IconDown />} label={`${field.label} 아래로`} disabled={index === fieldState.value.length - 1} onClick={() => move(index, 1)} />{saved ? <ConfirmActionButton label={`필드 ${field.label}(${field.code}) 삭제`} action={removeFormFieldEditAction.bind(null, code, field.code)} /> : <IconButton icon={<IconClose />} label={`${field.label} 추가 취소`} onClick={() => fieldState.setValue(fieldState.value.filter((item) => item.code !== field.code))} />}</span></td> : null}
        </tr>;
      })}</tbody>
    </table>
    {fieldState.mode === "edit" ? <NewFieldComposer enums={enums} setEnums={setEnums} add={(field) => fieldState.setValue([...fieldState.value, field])} /> : null}
  </section>;
}

export function FormEditor({ def, initialEnums, usageCount, fieldUsage, valueRows }: { def: StructDiscriminator; initialEnums: EnumDef[]; usageCount: number; fieldUsage: Record<string, number>; valueRows: number }) {
  const [enums, setEnums] = useState(initialEnums);
  const initial: FormEditData = { label: def.label, description: def.description, alwaysExposed: def.alwaysExposed, fields: [...def.fields].sort((a, b) => a.order - b.order).map(({ code, label, type, defaultValue }) => ({ code, label, type, ...(defaultValue !== undefined ? { defaultValue } : {}) })) };
  return <EditShell initial={initial} title={def.label} code={def.code} headerMeta={<span className="ts-count">사용처 <b>{usageCount}</b></span>} backHref="/types/forms" backLabel="폼 목록" saveAction={saveFormEditAction.bind(null, def.code)} deleteAction={removeFormEditAction.bind(null, def.code)} deleteLabel={`${def.label} 삭제`} deleteTooltip={`폼 ${def.label}(${def.code}) 삭제 — 저장된 값 ${valueRows}건이 사라진다`} deleteSuccessHref="/types/forms">
    <div className="ts-form-grid"><div className="ts-form-row"><label>레벨 <InfoTip text={LEVEL_INFO} /></label><div className="ts-form-control"><span className="ts-field-locked">{LEVEL_LABEL[def.level]}</span></div></div><Field name="label" label="표시명" /><Field name="description" label="설명" type="textarea" /><Field name="alwaysExposed" label="노출" type="checkbox" info={EXPOSURE_INFO} readValue={(value) => value ? "무조건" : "선택"} /></div>
    <FieldsEditor code={def.code} enums={enums} setEnums={setEnums} usage={fieldUsage} />
    <p><Link href={`/catalog/${def.code}`}>이 폼을 구분자로 보기 →</Link></p>
  </EditShell>;
}
