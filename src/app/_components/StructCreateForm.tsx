import { LEVEL_LABEL } from "@/app/_lib/labels";
import { ATTACH_LEVELS, type AttachLevel } from "@/domain/types";

export function StructCreateForm({
  action,
  initialLabel = "",
  initialLevel = "coverage",
}: {
  action: (formData: FormData) => void | Promise<void>;
  initialLabel?: string;
  initialLevel?: AttachLevel;
}) {
  return (
    <form action={action} className="ts-form">
      <div className="ts-form-row"><label htmlFor="struct-label">표시명</label><div className="ts-form-control"><input id="struct-label" name="label" defaultValue={initialLabel} required />{initialLabel ? <span className="ts-badge proposed">제안</span> : null}</div></div>
      <div className="ts-form-row"><label htmlFor="struct-level">레벨</label><div className="ts-form-control"><select id="struct-level" name="level" defaultValue={initialLevel} required>{ATTACH_LEVELS.map((level) => <option key={level} value={level}>{LEVEL_LABEL[level]}</option>)}</select><span className="ts-badge proposed">제안</span></div></div>
      <div className="ts-form-row"><label htmlFor="struct-exposed">노출</label><div className="ts-form-control"><label className="ts-form-check"><input id="struct-exposed" type="checkbox" name="alwaysExposed" /> 무조건</label></div></div>
      <div className="ts-form-row"><label htmlFor="struct-description">설명</label><div className="ts-form-control"><textarea id="struct-description" name="description" rows={2} /></div></div>
      <p className="ts-muted">생성하면 폼 상세에서 첫 필드를 추가할 수 있다.</p>
      <div className="ts-form-actions"><button type="submit" className="primary">폼 생성</button></div>
    </form>
  );
}
