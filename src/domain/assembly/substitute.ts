/**
 * 4단계 — 슬롯 치환. 값 참조 슬롯을 문자열로 바꾼다 (ResolvedDoc → SubstitutedDoc).
 *
 * ⚠ 값 포맷 규칙은 **임시**다 (도메인모델 §7 미결 · 문면_기획 「열어 둔 문제」):
 *   string · date 그대로 · number `toLocaleString('ko-KR')` · boolean 예/아니오 · enum 표시명 ·
 *   list<enum> 「, 」연결 · const 정의값(string). 파생은 값의 런타임 타입으로 같은 규칙.
 * 미입력·미부착·깨진 참조·미결은 오류 마커 (ADR-0004 — 조용한 빈칸 없음).
 */

import type { Discriminator, EnumDef } from "../catalog/types";
import { slotType } from "../catalog/values";
import { evaluate, parse, type ValueRef } from "../expression";
import type { Code, Coordinate, FieldType, Issue, Value } from "../types";
import type { AssemblyContext } from "./context";
import type { ErrorNode, RArticle, RInline, RItem, RParagraph, ResolvedDoc, RSubitem, SInline, SubstitutedDoc } from "./types";

export interface SubstituteEnv {
  catalog: ReadonlyMap<Code, Discriminator>;
  enums: ReadonlyMap<Code, EnumDef>;
}

export interface SubstituteOutcome {
  doc: SubstitutedDoc;
  issues: Issue[];
}

// ───────────────────────────── 포맷 (임시 규칙) ─────────────────────────────

export type Formatted = { ok: true; text: string } | { ok: false; issue: Issue };

function enumLabel(enums: ReadonlyMap<Code, EnumDef>, enumCode: Code, valueCode: Value, at: Coordinate): Formatted {
  const def = enums.get(enumCode);
  if (!def) return { ok: false, issue: { kind: "brokenRef", message: `enum ${enumCode} 이(가) 없습니다`, at } };
  const v = def.values.find((x) => x.code === valueCode);
  if (!v) return { ok: false, issue: { kind: "brokenRef", message: `enum ${def.label}(${def.code}) 에 값 코드 ${String(valueCode)} 이(가) 없습니다`, at } };
  return { ok: true, text: v.label };
}

/** 값 → 문자열. `type` 을 모르면(파생) 런타임 타입으로. */
export function formatValue(value: Value, type: FieldType | undefined, enums: ReadonlyMap<Code, EnumDef>, at: Coordinate): Formatted {
  if (type?.kind === "enum" && typeof value === "string") return enumLabel(enums, type.enumCode, value, at);
  if (type?.kind === "list<enum>" && Array.isArray(value)) {
    const labels: string[] = [];
    for (const code of value) {
      const r = enumLabel(enums, type.enumCode, code, at);
      if (!r.ok) return r;
      labels.push(r.text);
    }
    return { ok: true, text: labels.join(", ") };
  }
  if (Array.isArray(value)) return { ok: true, text: value.join(", ") };
  if (typeof value === "number") return { ok: true, text: value.toLocaleString("ko-KR") };
  if (typeof value === "boolean") return { ok: true, text: value ? "예" : "아니오" };
  return { ok: true, text: value };
}

/** 참조의 값 자리 타입 — scalar·struct 필드는 정의에서, const 는 string, 파생·내장은 모름. */
function typeOf(env: SubstituteEnv, ref: ValueRef): FieldType | undefined {
  if (ref.kind !== "discriminator") return { kind: "string" };
  const def = env.catalog.get(ref.code);
  if (!def) return undefined;
  if (def.kind === "const") return { kind: "string" };
  if (def.kind === "derived") return undefined;
  return slotType(def, ref.field === undefined ? ref.code : `${ref.code}.${ref.field}`);
}

// ───────────────────────────── 치환 ─────────────────────────────

class Substituter {
  readonly issues: Issue[] = [];
  constructor(
    private readonly ctx: AssemblyContext,
    private readonly env: SubstituteEnv,
  ) {}

  error(id: string, issue: Issue): ErrorNode {
    this.issues.push(issue);
    return { kind: "error", id, issue };
  }

  slot(n: RInline & { kind: "slot" }): SInline {
    const at = { ...n.at, refPath: n.ref };
    const parsed = parse(n.ref, at);
    if (!parsed.ok) {
      const issue: Issue = parsed.rejection.reason === "invalid" && parsed.rejection.issues[0] ? parsed.rejection.issues[0] : { kind: "syntax", message: "슬롯 참조를 읽을 수 없습니다", at };
      return this.error(n.id, issue);
    }
    if (parsed.value.kind !== "ref" || parsed.value.ref.kind === "attr") {
      return this.error(n.id, { kind: "typeMismatch", message: "슬롯은 값 참조 경로 하나여야 합니다 (식 · 담보속성 불가)", at });
    }
    const r = evaluate(parsed.value, { ...this.ctx.eval, coordinate: n.at });
    if (r.kind === "error") return this.error(n.id, r.issue);
    if (r.kind === "undetermined") return this.error(n.id, this.ctx.explainUndetermined(r.reason, n.at));
    const f = formatValue(r.value, typeOf(this.env, parsed.value.ref), this.env.enums, at);
    if (!f.ok) return this.error(n.id, f.issue);
    return { kind: "text", id: n.id, text: f.text };
  }

  inlines(list: readonly RInline[]): SInline[] {
    return list.map((n) => (n.kind === "slot" ? this.slot(n) : n));
  }

  subitem(n: RSubitem<RInline>): RSubitem<SInline> {
    return { ...n, children: this.inlines(n.children) };
  }

  item(n: RItem<RInline>): RItem<SInline> {
    return {
      kind: "item",
      id: n.id,
      children: this.inlines(n.children),
      ...(n.subitems ? { subitems: n.subitems.map((s) => (s.kind === "error" ? s : this.subitem(s))) } : {}),
    };
  }

  paragraph(n: RParagraph<RInline>): RParagraph<SInline> {
    return {
      kind: "paragraph",
      id: n.id,
      children: this.inlines(n.children),
      ...(n.items ? { items: n.items.map((it) => (it.kind === "error" ? it : this.item(it))) } : {}),
    };
  }

  article(n: RArticle<RInline>): RArticle<SInline> {
    return { ...n, children: n.children.map((p) => (p.kind === "error" ? p : this.paragraph(p))) };
  }
}

export function substituteSlots(doc: ResolvedDoc, ctx: AssemblyContext, env: SubstituteEnv): SubstituteOutcome {
  const s = new Substituter(ctx, env);
  const children = doc.children.map((a) => (a.kind === "error" ? a : s.article(a)));
  return { doc: { ...doc, children }, issues: s.issues };
}
