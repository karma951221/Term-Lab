"use client";

/**
 * 담보명 → 세부보장명 → 급부명 자동 추종 (리뷰 #9). 기본값을 helper text 로 깔지 않고
 * (디자인원칙 §8 금지) 타이핑에 맞춰 실시간으로 채운다 — 사람이 그 칸을 직접 고치면 그 순간부터
 * 추종을 멈춘다 (§9.1 「사람이 덮어쓸 수 있게」). name 속성은 그대로라 서버 액션은 안 바뀐다.
 */
import { useState, type ChangeEvent } from "react";

export function NameFollow() {
  const [name, setName] = useState("");
  const [sub, setSub] = useState("");
  const [subTouched, setSubTouched] = useState(false);
  const [benefit, setBenefit] = useState("");
  const [benefitTouched, setBenefitTouched] = useState(false);

  const effectiveSub = subTouched ? sub : name;
  const effectiveBenefit = benefitTouched ? benefit : effectiveSub;

  function onName(e: ChangeEvent<HTMLInputElement>) {
    setName(e.target.value);
  }
  function onSub(e: ChangeEvent<HTMLInputElement>) {
    setSubTouched(true);
    setSub(e.target.value);
  }
  function onBenefit(e: ChangeEvent<HTMLInputElement>) {
    setBenefitTouched(true);
    setBenefit(e.target.value);
  }

  return (
    <>
      <div className="ts-form-row">
        <label className="ts-form-label" htmlFor="cov-name">
          담보명
        </label>
        <div className="ts-form-control">
          <input id="cov-name" type="text" name="name" required value={name} onChange={onName} className="ts-field-direct" />
        </div>
      </div>
      <div className="ts-form-row">
        <label className="ts-form-label" htmlFor="cov-sub">
          세부보장명
        </label>
        <div className="ts-form-control">
          <input
            id="cov-sub"
            type="text"
            name="subCoverageName"
            value={effectiveSub}
            onChange={onSub}
            title="담보명을 따라간다 — 직접 고치면 그 뒤로는 따라가지 않는다"
            className="ts-field-direct"
          />
        </div>
      </div>
      <div className="ts-form-row">
        <label className="ts-form-label" htmlFor="cov-benefit">
          급부명
        </label>
        <div className="ts-form-control">
          <input
            id="cov-benefit"
            type="text"
            name="benefitName"
            value={effectiveBenefit}
            onChange={onBenefit}
            title="세부보장명을 따라간다 — 직접 고치면 그 뒤로는 따라가지 않는다"
            className="ts-field-direct"
          />
        </div>
      </div>
    </>
  );
}
