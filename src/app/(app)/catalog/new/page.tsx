import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { ATTACH_LEVELS, ATTACH_LEVEL_LABEL } from "@/domain/types";
import { getServices } from "@/lib/services";

import { createConstAction, createDerivedAction, createScalarAction, createStructAction } from "../actions";

export const dynamic = "force-dynamic";

function LevelSelect() {
  return (
    <label className="ts-field">
      <span>레벨</span>
      <select name="level" required defaultValue="">
        <option value="" disabled>
          — 선택 —
        </option>
        {ATTACH_LEVELS.map((l) => (
          <option key={l} value={l}>
            {ATTACH_LEVEL_LABEL[l]}
          </option>
        ))}
      </select>
    </label>
  );
}

export default async function NewCatalogPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const enums = await getServices().catalog.listEnums();

  return (
    <div>
      <h1 className="ts-h1">새 구분자</h1>
      <ErrorBanner message={error} />

      <h2 className="ts-h2">스칼라</h2>
      <form action={createScalarAction} className="ts-form">
        <label className="ts-field">
          <span>표시명</span>
          <input type="text" name="label" required />
        </label>
        <LevelSelect />
        <label className="ts-field">
          <span>타입</span>
          <select name="typeKind" required>
            <option value="string">string</option>
            <option value="number">number</option>
            <option value="boolean">boolean</option>
            <option value="date">date</option>
            <option value="enum">enum</option>
            <option value="list<enum>">list&lt;enum&gt;</option>
          </select>
        </label>
        <label className="ts-field">
          <span>enum 대상 (타입이 enum 류일 때만)</span>
          <select name="enumCode" defaultValue="">
            <option value="">—</option>
            {enums.map((e) => (
              <option key={e.code} value={e.code}>
                {e.label} ({e.code})
              </option>
            ))}
          </select>
        </label>
        <label className="ts-field">
          <span>
            <input type="checkbox" name="alwaysExposed" /> 무조건 노출
          </span>
        </label>
        <label className="ts-field">
          <span>설명</span>
          <textarea name="description" rows={2} />
        </label>
        <div className="ts-form-actions">
          <button type="submit">생성</button>
        </div>
      </form>

      <h2 className="ts-h2">구조체</h2>
      <form action={createStructAction} className="ts-form">
        <label className="ts-field">
          <span>표시명</span>
          <input type="text" name="label" required />
        </label>
        <LevelSelect />
        <label className="ts-field">
          <span>
            <input type="checkbox" name="alwaysExposed" /> 무조건 노출
          </span>
        </label>
        <label className="ts-field">
          <span>설명</span>
          <textarea name="description" rows={2} />
        </label>
        <p className="ts-muted">필드는 생성 후 상세 화면에서 추가합니다.</p>
        <div className="ts-form-actions">
          <button type="submit">생성</button>
        </div>
      </form>

      <h2 className="ts-h2">const</h2>
      <form action={createConstAction} className="ts-form">
        <label className="ts-field">
          <span>표시명</span>
          <input type="text" name="label" required />
        </label>
        <label className="ts-field">
          <span>값</span>
          <input type="text" name="value" required />
        </label>
        <label className="ts-field">
          <span>설명</span>
          <textarea name="description" rows={2} />
        </label>
        <div className="ts-form-actions">
          <button type="submit">생성</button>
        </div>
      </form>

      <h2 className="ts-h2">파생</h2>
      <form action={createDerivedAction} className="ts-form">
        <label className="ts-field">
          <span>표시명</span>
          <input type="text" name="label" required />
        </label>
        <LevelSelect />
        <label className="ts-field">
          <span>식 (예: any(D0003.F01))</span>
          <input type="text" name="expression" required className="ts-json" style={{ minHeight: "auto" }} />
        </label>
        <label className="ts-field">
          <span>설명</span>
          <textarea name="description" rows={2} />
        </label>
        <div className="ts-form-actions">
          <button type="submit">생성</button>
        </div>
      </form>
    </div>
  );
}
