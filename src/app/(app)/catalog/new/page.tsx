import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { StructCreateForm } from "@/app/_components/StructCreateForm";
import { LEVEL_LABEL, label } from "@/app/_lib/labels";
import { ATTACH_LEVELS, type AttachLevel } from "@/domain/types";
import type { DiscriminatorKind } from "@/domain/catalog/types";
import { getServices } from "@/lib/services";

import { createConstAction, createDerivedAction, createScalarAction, createStructAction } from "../actions";
import { KindPicker } from "./KindPicker";

export const dynamic = "force-dynamic";

/** 시드 구분자 11개 중 담보 레벨이 최다다 (리뷰 #2) — 구조 선택지라 프리필하되, 「제안」임을 배지로 알린다. */
const DEFAULT_LEVEL: AttachLevel = "coverage";

function LevelSelect() {
  return (
    <div className="ts-form-row">
      <label className="ts-form-label" htmlFor="new-level">
        레벨
      </label>
      <div className="ts-form-control">
        <select id="new-level" name="level" required defaultValue={DEFAULT_LEVEL}>
          {ATTACH_LEVELS.map((l) => (
            <option key={l} value={l}>
              {label(LEVEL_LABEL, l)}
            </option>
          ))}
        </select>
        <span className="ts-badge proposed" title="가장 흔히 쓰는 레벨을 미리 골라 뒀다 — 바꿀 수 있다">
          제안
        </span>
      </div>
    </div>
  );
}

export default async function NewCatalogPage({ searchParams }: { searchParams: Promise<{ error?: string; q?: string; kind?: string; level?: string }> }) {
  const { error, q = "", kind = "scalar", level = DEFAULT_LEVEL } = await searchParams;
  const enums = await getServices().catalog.listEnums();

  const scalarForm = (
    <form action={createScalarAction} className="ts-form">
      <div className="ts-form-row">
        <label className="ts-form-label" htmlFor="scalar-label">
          표시명
        </label>
        <div className="ts-form-control">
          <input id="scalar-label" type="text" name="label" required />
        </div>
      </div>
      <LevelSelect />
      <div className="ts-form-row">
        <label className="ts-form-label" htmlFor="scalar-type">
          타입
        </label>
        <div className="ts-form-control">
          <select id="scalar-type" name="typeKind" required defaultValue="string">
            <option value="string">문자열</option>
            <option value="number">숫자</option>
            <option value="boolean">예/아니오</option>
            <option value="date">날짜</option>
            <option value="enum">선택형</option>
            <option value="list<enum>">선택형(복수)</option>
          </select>
        </div>
      </div>
      <div className="ts-form-row">
        <label className="ts-form-label" htmlFor="scalar-enum">
          선택지 (타입이 선택형일 때만)
        </label>
        <div className="ts-form-control">
          <select id="scalar-enum" name="enumCode" defaultValue="">
            <option value="">—</option>
            {enums.map((e) => (
              <option key={e.code} value={e.code}>
                {e.label} ({e.code})
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="ts-form-row">
        <label className="ts-form-label" htmlFor="scalar-exposed">
          무조건 노출
        </label>
        <div className="ts-form-control">
          <input id="scalar-exposed" type="checkbox" name="alwaysExposed" />
        </div>
      </div>
      <div className="ts-form-row">
        <label className="ts-form-label" htmlFor="scalar-desc">
          설명
        </label>
        <div className="ts-form-control">
          <textarea id="scalar-desc" name="description" rows={2} />
        </div>
      </div>
      <div className="ts-form-actions">
        <button type="submit" className="primary">
          단일값 구분자 생성
        </button>
      </div>
    </form>
  );

  const initialLevel = ATTACH_LEVELS.includes(level as AttachLevel) ? level as AttachLevel : DEFAULT_LEVEL;
  const initialKind = (["scalar", "struct", "const", "derived"] as readonly string[]).includes(kind) ? kind as DiscriminatorKind : "scalar";
  const structForm = <StructCreateForm action={createStructAction} initialLabel={q} initialLevel={initialLevel} />;

  const constForm = (
    <form action={createConstAction} className="ts-form">
      <div className="ts-form-row">
        <label className="ts-form-label" htmlFor="const-label">
          표시명
        </label>
        <div className="ts-form-control">
          <input id="const-label" type="text" name="label" required />
        </div>
      </div>
      <div className="ts-form-row">
        <label className="ts-form-label" htmlFor="const-value">
          값
        </label>
        <div className="ts-form-control">
          <input id="const-value" type="text" name="value" required />
        </div>
      </div>
      <div className="ts-form-row">
        <label className="ts-form-label" htmlFor="const-desc">
          설명
        </label>
        <div className="ts-form-control">
          <textarea id="const-desc" name="description" rows={2} />
        </div>
      </div>
      <div className="ts-form-actions">
        <button type="submit" className="primary">
          상수 구분자 생성
        </button>
      </div>
    </form>
  );

  const derivedForm = (
    <form action={createDerivedAction} className="ts-form">
      <div className="ts-form-row">
        <label className="ts-form-label" htmlFor="derived-label">
          표시명
        </label>
        <div className="ts-form-control">
          <input id="derived-label" type="text" name="label" required />
        </div>
      </div>
      <LevelSelect />
      <div className="ts-form-row">
        <label className="ts-form-label" htmlFor="derived-expr">
          식
        </label>
        <div className="ts-form-control">
          <input id="derived-expr" type="text" name="expression" required className="ts-mono" placeholder="예: any(D0003.F01)" />
        </div>
      </div>
      <div className="ts-form-row">
        <label className="ts-form-label" htmlFor="derived-desc">
          설명
        </label>
        <div className="ts-form-control">
          <textarea id="derived-desc" name="description" rows={2} />
        </div>
      </div>
      <div className="ts-form-actions">
        <button type="submit" className="primary">
          파생 구분자 생성
        </button>
      </div>
    </form>
  );

  return (
    <div>
      <h1 className="ts-h1">새 구분자</h1>
      <ErrorBanner message={error} />
      <KindPicker forms={{ scalar: scalarForm, struct: structForm, const: constForm, derived: derivedForm }} initialKind={initialKind} />
    </div>
  );
}
