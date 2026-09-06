"use client";

import { useRef } from "react";

import { ConfirmActionButton } from "@/app/_components/ConfirmActionButton";
import { EditShell, Field, useEditField } from "@/app/_components/EditShell";
import { IconButton, IconClose, IconDown, IconUp } from "@/app/_components/icons";
import type { EnumDef } from "@/domain/catalog";

import { removeEnumEditAction, removeEnumValueEditAction, saveEnumEditAction } from "../../edit-actions";
import type { EnumEditData, EnumEditValue } from "../../edit-types";

function ValuesEditor({ code, usage }: { code: string; usage: Record<string, number> }) {
  const field = useEditField<EnumEditValue[]>("values");
  const next = useRef(1);
  const move = (index: number, delta: number) => {
    const values = [...field.value];
    const target = index + delta;
    if (target < 0 || target >= values.length) return;
    [values[index], values[target]] = [values[target]!, values[index]!];
    field.setValue(values);
  };
  return <>
    <table className="ts-table"><thead><tr><th className="col-num">순서</th><th className="col-code">코드</th><th className="col-flex">표시명</th><th className="col-num">사용 수</th>{field.mode === "edit" ? <th className="col-act">조작</th> : null}</tr></thead>
      <tbody>{field.value.map((value, index) => {
        const saved = !value.code.startsWith("new:");
        return <tr key={value.code}><td className="col-num">{index + 1}</td><td className="col-code"><code>{saved ? value.code : "새 값"}</code></td><td className="col-flex">{field.mode === "read" ? <span className="ts-field-locked">{value.label}</span> : <input value={value.label} onChange={(event) => field.setValue(field.value.map((item) => item.code === value.code ? { ...item, label: event.target.value } : item))} className="ts-field-direct" />}</td><td className="col-num">{saved ? usage[value.code] || "—" : "—"}</td>{field.mode === "edit" ? <td className="col-act"><span className="ts-row-actions"><IconButton icon={<IconUp />} label={`${value.label} 위로`} disabled={field.pending || index === 0} onClick={() => move(index, -1)} /><IconButton icon={<IconDown />} label={`${value.label} 아래로`} disabled={field.pending || index === field.value.length - 1} onClick={() => move(index, 1)} />{saved ? <ConfirmActionButton label={`${value.label}(${value.code}) 삭제`} action={removeEnumValueEditAction.bind(null, code, value.code)} /> : <IconButton icon={<IconClose />} label={`${value.label || "새 값"} 추가 취소`} onClick={() => field.setValue(field.value.filter((item) => item.code !== value.code))} />}</span></td> : null}</tr>;
      })}</tbody>
    </table>
    {field.mode === "edit" ? <div className="ts-add-row"><label htmlFor="new-enum-value">값 추가</label><input id="new-enum-value" placeholder="표시명" onKeyDown={(event) => { if (event.key !== "Enter") return; event.preventDefault(); const label = event.currentTarget.value.trim(); if (!label) return; field.setValue([...field.value, { code: `new:${next.current++}`, label }]); event.currentTarget.value = ""; }} /><span className="ts-muted">Enter</span></div> : null}
  </>;
}

export function EnumEditor({ item, usageCount, valueUsage }: { item: EnumDef; usageCount: number; valueUsage: Record<string, number> }) {
  const values = [...item.values].sort((a, b) => a.order - b.order).map(({ code, label }) => ({ code, label }));
  const initial: EnumEditData = { label: item.label, values };
  return <EditShell initial={initial} title={item.label} code={item.code} headerMeta={<span className="ts-count">사용처 <b>{usageCount}</b></span>} backHref="/types/enums" backLabel="선택지 목록" saveAction={saveEnumEditAction.bind(null, item.code)} deleteAction={removeEnumEditAction.bind(null, item.code)} deleteLabel={`${item.label} 삭제`} deleteTooltip={`선택지 ${item.label}(${item.code}) 삭제`} deleteSuccessHref="/types/enums">
    <Field name="label" label="표시명" />
    <ValuesEditor code={item.code} usage={valueUsage} />
  </EditShell>;
}
