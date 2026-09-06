"use client";

import Link from "next/link";

import { DefaultValueInput } from "@/app/_components/DefaultValueInput";
import { EditShell, Field, useEditField } from "@/app/_components/EditShell";
import { InfoTip } from "@/app/_components/InfoTip";
import { KIND_LABEL, LEVEL_LABEL, TYPE_LABEL } from "@/app/_lib/labels";
import type { Discriminator, EnumDef } from "@/domain/catalog";
import type { FieldType, Value } from "@/domain/types";

import { removeDiscriminatorEditAction, saveDiscriminatorEditAction } from "../edit-actions";
import type { CatalogEditData } from "../edit-types";

const LEVEL_INFO = "이 구분자가 붙는 모델링의 층. 담보에 붙이면 담보마다 값을 갖는다";
const EXPOSURE_INFO = "선택이면 담보 · 상품 화면에서 이 구분자를 붙인 곳에만 값 자리가 생긴다";
const DEFAULT_INFO = "폼을 열 때 미리 채워 보여줄 제안. 사람이 저장해야 값이 된다";

function initialData(def: Discriminator): CatalogEditData {
  const base: CatalogEditData = { label: def.label, description: def.description };
  if (def.kind === "scalar") return { ...base, alwaysExposed: def.alwaysExposed, typeKind: def.type.kind, enumCode: "enumCode" in def.type ? def.type.enumCode : "", defaultValue: def.defaultValue };
  if (def.kind === "struct") return { ...base, alwaysExposed: def.alwaysExposed };
  if (def.kind === "const") return { ...base, value: def.value };
  return { ...base, expression: def.expression };
}

function TypeField({ enums }: { enums: EnumDef[] }) {
  const kind = useEditField<FieldType["kind"]>("typeKind");
  const enumCode = useEditField<string>("enumCode");
  const defaultValue = useEditField<Value | undefined>("defaultValue");
  const isChoice = kind.value === "enum" || kind.value === "list<enum>";
  const label = isChoice ? `${TYPE_LABEL[kind.value]} (${enums.find((item) => item.code === enumCode.value)?.label ?? enumCode.value})` : TYPE_LABEL[kind.value];
  return <div className="ts-form-row"><label>타입</label><div className="ts-form-control">{kind.mode === "read" ? <span className="ts-field-locked">{label}</span> : <><select value={kind.value} onChange={(event) => { kind.setValue(event.target.value as FieldType["kind"]); enumCode.setValue(""); defaultValue.setValue(undefined); }} className="ts-field-direct">{Object.entries(TYPE_LABEL).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select>{isChoice ? <select value={enumCode.value} onChange={(event) => { enumCode.setValue(event.target.value); defaultValue.setValue(undefined); }} className="ts-field-direct"><option value="">선택지 고르기</option>{enums.map((item) => <option key={item.code} value={item.code}>{item.label} ({item.code})</option>)}</select> : null}</>}</div></div>;
}

function valueText(type: FieldType, value: Value | undefined, enums: EnumDef[]): string {
  if (value === undefined || (Array.isArray(value) && value.length === 0)) return "없음";
  if (type.kind === "boolean") return value ? "예" : "아니오";
  if ((type.kind === "enum" || type.kind === "list<enum>") && "enumCode" in type) {
    const item = enums.find((entry) => entry.code === type.enumCode);
    const codes = Array.isArray(value) ? value : [String(value)];
    return codes.map((code) => item?.values.find((entry) => entry.code === code)?.label ?? code).join(" · ");
  }
  return String(value);
}

function DefaultField({ enums }: { enums: EnumDef[] }) {
  const kind = useEditField<FieldType["kind"]>("typeKind");
  const enumCode = useEditField<string>("enumCode");
  const value = useEditField<Value | undefined>("defaultValue");
  const type: FieldType = kind.value === "enum" || kind.value === "list<enum>" ? { kind: kind.value, enumCode: enumCode.value } : { kind: kind.value } as FieldType;
  return <div className="ts-form-row"><label>기본값 <InfoTip text={DEFAULT_INFO} /></label><div className="ts-form-control">{value.mode === "read" ? <span className="ts-field-locked">{valueText(type, value.value, enums)}</span> : <DefaultValueInput type={type} value={value.value} onChange={value.setValue} enums={enums} />}</div></div>;
}

export function CatalogEditor({ def, enums, valueRows, usage, usageCount }: { def: Discriminator; enums: EnumDef[]; valueRows: number; usage: React.ReactNode; usageCount: number }) {
  const data = initialData(def);
  return <EditShell
    initial={data}
    title={def.label}
    code={def.code}
    headerMeta={<span className="ts-count">사용처 <b>{usageCount}</b></span>}
    saveAction={saveDiscriminatorEditAction.bind(null, def.code)}
    deleteAction={removeDiscriminatorEditAction.bind(null, def.code)}
    deleteLabel={`${def.label} 삭제`}
    deleteTooltip={`구분자 ${def.label}(${def.code}) 삭제 — 저장된 값 ${valueRows}건이 사라진다`}
    deleteSuccessHref="/catalog"
  >
    <div className="ts-l2-split">
      <div className="ts-l2-main">
        <div className="ts-form-row"><label>종류</label><div className="ts-form-control"><span className="ts-field-locked">{KIND_LABEL[def.kind]}</span></div></div>
        {def.kind !== "const" ? <div className="ts-form-row"><label>레벨 <InfoTip text={LEVEL_INFO} /></label><div className="ts-form-control"><span className="ts-field-locked">{LEVEL_LABEL[def.level]}</span></div></div> : null}
        <Field name="label" label="표시명" />
        <Field name="description" label="설명" type="textarea" />
        {def.kind === "scalar" || def.kind === "struct" ? <Field name="alwaysExposed" label="노출" type="checkbox" info={EXPOSURE_INFO} readValue={(value) => value ? "무조건" : "선택"} /> : null}
        {def.kind === "scalar" ? <><TypeField enums={enums} /><DefaultField enums={enums} /></> : null}
        {def.kind === "const" ? <Field name="value" label="값" /> : null}
        {def.kind === "derived" ? <Field name="expression" label="식" className="ts-mono" /> : null}
        {def.kind === "struct" ? <div className="ts-struct-readonly"><table className="ts-table"><thead><tr><th className="col-code">코드</th><th className="col-flex">표시명</th><th className="col-fixed-md">타입</th><th>기본값</th></tr></thead><tbody>{[...def.fields].sort((a, b) => a.order - b.order).map((field) => <tr key={field.code}><td className="col-code">{field.code}</td><td>{field.label}</td><td>{TYPE_LABEL[field.type.kind]}</td><td>{valueText(field.type, field.defaultValue, enums)}</td></tr>)}</tbody></table><p><Link href={`/types/forms/${def.code}`}>폼 탭에서 편집 →</Link></p></div> : null}
      </div>
      <aside className="ts-l2-side">{usage}</aside>
    </div>
  </EditShell>;
}
