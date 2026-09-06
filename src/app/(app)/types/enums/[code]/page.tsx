import Link from "next/link";

import { Confirm } from "@/app/_components/Confirm";
import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { IconButton, IconDown, IconTrash, IconUp } from "@/app/_components/icons";
import { previewOutcome } from "@/app/_lib/rejection";
import { usagesOf } from "@/domain/refs";
import { currentActor, getServices } from "@/lib/services";

import {
  addTypeEnumValueAction,
  removeTypeEnumAction,
  removeTypeEnumValueAction,
  renameTypeEnumAction,
  renameTypeEnumValueAction,
  reorderTypeEnumValueAction,
} from "../../actions";

export const dynamic = "force-dynamic";

export default async function EnumDetailPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ error?: string; del?: string; delValue?: string }> }) {
  const { code } = await params;
  const sp = await searchParams;
  const services = getServices();
  const [item, graph, actor] = await Promise.all([services.catalog.getEnum(code), services.refs.graph(), currentActor()]);
  if (!item) return <div><h2 className="ts-h1">선택지 {code}</h2><p className="ts-error-banner">찾을 수 없습니다.</p><Link href="/types/enums">← 선택지 목록</Link></div>;
  const values = [...item.values].sort((a, b) => a.order - b.order);
  const usageCount = usagesOf(graph, { kind: "enum", enumCode: code }, { via: ["type"] }).length;

  return (
    <div>
      <div className="ts-detail-head">
        <form action={renameTypeEnumAction.bind(null, code)} className="ts-inline-edit">
          <input name="label" defaultValue={item.label} required aria-label="선택지 표시명" />
          <button type="submit">저장</button>
        </form>
        <code className="ts-mono ts-muted">{item.code}</code>
        <Link href={`/relations?kind=enum&code=${encodeURIComponent(code)}`} className="ts-count">사용처 <b>{usageCount}</b></Link>
        <Link href={`?del=1`} className="ts-iconbtn danger" title={`선택지 ${item.label}(${code}) 삭제`} aria-label={`선택지 ${item.label}(${code}) 삭제`}><IconTrash /></Link>
      </div>
      <ErrorBanner message={sp.error} />
      {sp.del === "1" ? <EnumDeleteConfirm code={code} label={item.label} actor={actor} /> : null}
      <table className="ts-table">
        <thead><tr><th className="col-num">순서</th><th className="col-code">코드</th><th className="col-flex">표시명</th><th className="col-num">사용 수</th><th className="col-act">조작</th></tr></thead>
        <tbody>{values.map((value, index) => {
          const valueUsage = usagesOf(graph, { kind: "enumValue", enumCode: code, valueCode: value.code }).length;
          return <tr key={value.code}>
            <td className="col-num">{index + 1}</td>
            <td className="col-code"><code>{value.code}</code></td>
            <td className="col-flex"><form action={renameTypeEnumValueAction.bind(null, code, value.code)} className="ts-inline-edit"><input name="label" defaultValue={value.label} required /><button type="submit">저장</button></form></td>
            <td className="col-num">{valueUsage || "—"}</td>
            <td className="col-act"><span className="ts-row-actions">
              <form action={reorderTypeEnumValueAction.bind(null, code, value.code, "up")}><IconButton type="submit" icon={<IconUp />} label={`${value.label} 위로`} disabled={index === 0} /></form>
              <form action={reorderTypeEnumValueAction.bind(null, code, value.code, "down")}><IconButton type="submit" icon={<IconDown />} label={`${value.label} 아래로`} disabled={index === values.length - 1} /></form>
              <Link href={`?delValue=${encodeURIComponent(value.code)}`} className="ts-iconbtn danger" title={`${value.label}(${value.code}) 삭제`} aria-label={`${value.label}(${value.code}) 삭제`}><IconTrash /></Link>
            </span></td>
          </tr>;
        })}</tbody>
      </table>
      {sp.delValue ? <EnumValueDeleteConfirm enumCode={code} valueCode={sp.delValue} label={values.find((value) => value.code === sp.delValue)?.label ?? sp.delValue} actor={actor} /> : null}
      <form action={addTypeEnumValueAction.bind(null, code)} className="ts-add-row"><label htmlFor="new-value">값 추가</label><input id="new-value" name="label" placeholder="표시명" required /><button type="submit">추가</button></form>
      <p className="ts-back"><Link href="/types/enums">← 선택지 목록</Link></p>
    </div>
  );
}

async function EnumDeleteConfirm({ code, label, actor }: { code: string; label: string; actor: Awaited<ReturnType<typeof currentActor>> }) {
  const outcome = previewOutcome(await getServices().catalog.removeEnum(actor, code));
  if (outcome.kind === "confirm") return <Confirm impact={outcome.impact} action={removeTypeEnumAction.bind(null, code)} targetLabel={`선택지 ${label}(${code})`} actionLabel={`${label} 삭제`} cancelHref={`/types/enums/${code}`} />;
  if (outcome.kind === "error") return <p className="ts-error-banner">{outcome.message}</p>;
  return null;
}

async function EnumValueDeleteConfirm({ enumCode, valueCode, label, actor }: { enumCode: string; valueCode: string; label: string; actor: Awaited<ReturnType<typeof currentActor>> }) {
  const outcome = previewOutcome(await getServices().catalog.removeEnumValue(actor, enumCode, valueCode));
  if (outcome.kind === "confirm") return <Confirm impact={outcome.impact} action={removeTypeEnumValueAction.bind(null, enumCode, valueCode)} targetLabel={`선택지 값 ${label}(${valueCode})`} actionLabel={`${label} 삭제`} cancelHref={`/types/enums/${enumCode}`} />;
  if (outcome.kind === "error") return <p className="ts-error-banner">{outcome.message}</p>;
  return null;
}
