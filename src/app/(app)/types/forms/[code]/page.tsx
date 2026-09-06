import Link from "next/link";

import { Confirm } from "@/app/_components/Confirm";
import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { IconButton, IconDown, IconTrash, IconUp } from "@/app/_components/icons";
import { LEVEL_LABEL, TYPE_LABEL } from "@/app/_lib/labels";
import { previewOutcome } from "@/app/_lib/rejection";
import type { EnumDef, FieldDef } from "@/domain/catalog";
import { usagesOf } from "@/domain/refs";
import type { FieldType } from "@/domain/types";
import { currentActor, getServices } from "@/lib/services";

import { fieldTypeFrom } from "../../../catalog/lib";
import {
  changeTypeFieldAction,
  removeTypeFieldAction,
  reorderTypeFieldAction,
  saveTypeFieldAction,
  saveTypeFormBasicAction,
} from "../../actions";
import { FieldAddRow } from "./FieldAddRow";

export const dynamic = "force-dynamic";

function typeText(type: FieldType, enumLabels: Map<string, string>): string {
  return type.kind === "enum" || type.kind === "list<enum>" ? `${TYPE_LABEL[type.kind]} (${enumLabels.get(type.enumCode) ?? type.enumCode})` : TYPE_LABEL[type.kind];
}

function TypeSelect({ defaultValue }: { defaultValue: string }) {
  return <select name="newType" defaultValue={defaultValue}>{Object.entries(TYPE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>;
}

export default async function FormDetailPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ error?: string; delField?: string; field?: string; newType?: string; newEnum?: string }> }) {
  const { code } = await params;
  const sp = await searchParams;
  const services = getServices();
  const [loaded, enums, graph, actor] = await Promise.all([services.catalog.get(code), services.catalog.listEnums(), services.refs.graph(), currentActor()]);
  if (!loaded || loaded.kind !== "struct") return <div><h2 className="ts-h1">폼 {code}</h2><p className="ts-error-banner">찾을 수 없습니다.</p><Link href="/types/forms">← 폼 목록</Link></div>;
  const def = loaded;
  const enumLabels = new Map(enums.map((item) => [item.code, item.label]));
  const fields = [...def.fields].sort((a, b) => a.order - b.order);
  const usageCount = usagesOf(graph, { kind: "discriminator", code }).length;

  let typeConfirm: React.ReactNode = null;
  if (sp.field && sp.newType) {
    const field = fields.find((item) => item.code === sp.field);
    const type = fieldTypeFrom(sp.newType, sp.newEnum ?? "");
    if (field && type) {
      const outcome = previewOutcome(await services.catalog.changeFieldType(actor, code, field.code, type));
      typeConfirm = outcome.kind === "confirm" ? <Confirm impact={outcome.impact} action={changeTypeFieldAction.bind(null, code, field.code, type)} title={`필드 ${field.label}(${field.code}) 타입을 ${typeText(type, enumLabels)}(으)로 바꾼다`} actionLabel={`타입 바꾸고 값 ${outcome.impact.valueRowsLost}건 삭제`} cancelHref={`/types/forms/${code}`} /> : outcome.kind === "error" ? <p className="ts-error-banner">{outcome.message}</p> : null;
    }
  }

  return <div>
    <div className="ts-detail-head"><h2 className="ts-h1">{def.label}</h2><code className="ts-mono ts-muted">{def.code}</code><span className="ts-count">사용처 <b>{usageCount}</b></span></div>
    <ErrorBanner message={sp.error} />
    <form action={saveTypeFormBasicAction.bind(null, code)} className="ts-form">
      <div className="ts-form-row"><label htmlFor="form-label">표시명</label><div className="ts-form-control"><input id="form-label" name="label" defaultValue={def.label} required /></div></div>
      <div className="ts-form-row"><label>레벨</label><div className="ts-form-control">{LEVEL_LABEL[def.level]}</div></div>
      <div className="ts-form-row"><label htmlFor="form-exposure">노출</label><div className="ts-form-control"><label className="ts-form-check"><input id="form-exposure" type="checkbox" name="alwaysExposed" defaultChecked={def.alwaysExposed} /> 무조건</label></div></div>
      <div className="ts-form-row"><label htmlFor="form-description">설명</label><div className="ts-form-control"><textarea id="form-description" name="description" defaultValue={def.description} rows={2} /></div></div>
      <div className="ts-form-actions"><button type="submit">저장</button><Link href={`/catalog/${code}`}>이 폼을 구분자로 보기 →</Link></div>
    </form>
    <section className="ts-section"><h3 className="ts-section-title">필드 <span className="ts-count">{fields.length}</span></h3>
      {fields.length ? <table className="ts-table"><thead><tr><th className="col-num">순서</th><th className="col-code">코드</th><th className="col-flex">표시명</th><th className="col-fixed-md">타입</th><th className="col-fixed-md">선택지</th><th>기본값</th><th className="col-num">사용 수</th><th className="col-act">조작</th></tr></thead>
        <tbody>{fields.map((field, index) => <FieldRow key={field.code} field={field} index={index} total={fields.length} code={code} enums={enums} enumLabels={enumLabels} usageCount={usagesOf(graph, { kind: "field", code, fieldCode: field.code }).length} />)}</tbody></table> : <p className="ts-empty-what">아직 필드가 없습니다.</p>}
      {typeConfirm}
      {sp.delField ? <FieldDeleteConfirm code={code} field={fields.find((item) => item.code === sp.delField)} actor={actor} /> : null}
      <FieldAddRow code={code} initialEnums={enums.map((item) => ({ code: item.code, label: item.label }))} />
    </section>
    <p className="ts-back"><Link href="/types/forms">← 폼 목록</Link></p>
  </div>;
}

function FieldRow({ field, index, total, code, enums, enumLabels, usageCount }: { field: FieldDef; index: number; total: number; code: string; enums: EnumDef[]; enumLabels: Map<string, string>; usageCount: number }) {
  const enumCode = field.type.kind === "enum" || field.type.kind === "list<enum>" ? field.type.enumCode : undefined;
  return <tr>
    <td className="col-num">{index + 1}</td><td className="col-code"><code>{field.code}</code></td>
    <td className="col-flex"><form id={`field-${field.code}`} action={saveTypeFieldAction.bind(null, code, field.code)} className="ts-inline-edit"><input name="label" defaultValue={field.label} required /><button type="submit">저장</button></form></td>
    <td>{typeText(field.type, enumLabels)}<form method="get" className="ts-type-change"><input type="hidden" name="field" value={field.code} /><TypeSelect defaultValue={field.type.kind} /><select name="newEnum" defaultValue={enumCode ?? ""}><option value="">선택형일 때</option>{enums.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select><button type="submit">변경…</button></form></td>
    <td>{enumCode ? <Link href={`/types/enums/${enumCode}`}>{enumLabels.get(enumCode) ?? enumCode}</Link> : "—"}</td>
    <td><input name="defaultValue" form={`field-${field.code}`} defaultValue={field.defaultValue === undefined ? "" : Array.isArray(field.defaultValue) ? field.defaultValue.join(",") : String(field.defaultValue)} className="ts-field-direct" /></td>
    <td className="col-num">{usageCount || "—"}</td>
    <td className="col-act"><span className="ts-row-actions"><form action={reorderTypeFieldAction.bind(null, code, field.code, "up")}><IconButton type="submit" icon={<IconUp />} label={`${field.label} 위로`} disabled={index === 0} /></form><form action={reorderTypeFieldAction.bind(null, code, field.code, "down")}><IconButton type="submit" icon={<IconDown />} label={`${field.label} 아래로`} disabled={index === total - 1} /></form><Link href={`?delField=${field.code}`} className="ts-iconbtn danger" title={`필드 ${field.label}(${field.code}) 삭제`} aria-label={`필드 ${field.label}(${field.code}) 삭제`}><IconTrash /></Link></span></td>
  </tr>;
}

async function FieldDeleteConfirm({ code, field, actor }: { code: string; field?: FieldDef; actor: Awaited<ReturnType<typeof currentActor>> }) {
  if (!field) return <p className="ts-error-banner">필드를 찾을 수 없습니다.</p>;
  const outcome = previewOutcome(await getServices().catalog.removeField(actor, code, field.code));
  if (outcome.kind === "confirm") return <Confirm impact={outcome.impact} action={removeTypeFieldAction.bind(null, code, field.code)} targetLabel={`필드 ${field.label}(${field.code})`} actionLabel={`${field.label} 삭제`} cancelHref={`/types/forms/${code}`} />;
  if (outcome.kind === "error") return <p className="ts-error-banner">{outcome.message}</p>;
  return null;
}
