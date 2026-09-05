/**
 * 공용조항 정의의 생성·변경 규칙 (순수).
 *
 * 근거: docs/01_기획/공용조항_기획.md · ADR-0008 · ADR-0010 · ADR-0017 · 공용조항_액션 D-P3-3·4·6·7.
 *
 * - 생성은 코드를 채번한다 — 순번은 주입된 `nextSeq` 가 준다 (저장소).
 * - 모든 변경은 새 정의를 돌려주고 원본은 바꾸지 않는다.
 * - 본문·옵션이 바뀌는 변경은 `analyzeBody` 로 다시 검사하고 요구 구분자를 **다시 계산**한다 (ADR-0010).
 * - 옵션 자리는 선택지 2개 이상 (D-P3-4) · 기본 선택지 없음 (D-P3-7) · 순서 변경 가능 (D-P3-6).
 * - 옵션·선택지 삭제의 사용처 영향(깨진 선택)은 서비스의 재검사(`recheckUsages`)가 드러낸다 (ADR-0017 §5).
 */
import { ok, reject } from "../types";
import type { Code, Issue, Result } from "../types";
import { analyzeBody, allNodeIds } from "./body";
import type { AnalyzeOptions } from "./body";
import { allocateClauseCode, optionValueScope, type ClauseNextSeq } from "./codes";
import type { Block, Inline } from "./nodes";
import type {
  Clause,
  ClauseBody,
  ClauseMode,
  NewClause,
  NewOption,
  NewOptionValue,
  OptionDef,
  OptionValue,
} from "./types";

// ───────────────────────────── 문맥 ─────────────────────────────

/** 표시명 중복 검사에 필요한 최소 정보. */
export interface ClauseSummaryLite {
  code: Code;
  label: string;
}

export interface ClauseContext {
  nextSeq: ClauseNextSeq;
  /** 현재 공용조항들 (표시명 중복 검사용). */
  existing: readonly ClauseSummaryLite[];
  /** 본문 검사 옵션 (조건식 타입 조회 등). */
  analyze?: AnalyzeOptions;
}

const MODES: readonly ClauseMode[] = ["inline", "block"];

// ───────────────────────────── 헬퍼 ─────────────────────────────

function invalid<T>(kind: Issue["kind"], message: string, refPath?: string): Result<T> {
  return reject({ reason: "invalid", issues: [{ kind, message, at: refPath ? { refPath } : {} }] });
}

function notFound<T>(what: string): Result<T> {
  return reject({ reason: "notFound", what });
}

function checkLabel(label: string, existing: readonly ClauseSummaryLite[], selfCode?: Code): Result<string> {
  const trimmed = label.trim();
  if (trimmed === "") return invalid("typeMismatch", "표시명이 비어 있습니다");
  const dup = existing.find((e) => e.label === trimmed && e.code !== selfCode);
  if (dup) return reject({ reason: "duplicate", what: `표시명 ${trimmed} (${dup.code})` });
  return ok(trimmed);
}

/** 본문·옵션을 검사하고 요구 참조를 계산해 정의를 완성한다. */
function withAnalysis(base: Omit<Clause, "required">, analyze?: AnalyzeOptions): Result<Clause> {
  const r = analyzeBody(base.mode, base.body, base.options, {
    ...analyze,
    coordinate: { document: "clause", ownerName: base.label, ...analyze?.coordinate },
  });
  if (!r.ok) return r as Result<Clause>;
  return ok({ ...base, required: r.value } as Clause);
}

function findOption(clause: Clause, optionCode: Code): OptionDef | undefined {
  return clause.options.find((o) => o.code === optionCode);
}

function replaceOption(clause: Clause, next: OptionDef): OptionDef[] {
  return clause.options.map((o) => (o.code === next.code ? next : o));
}

function withOptions(clause: Clause, options: OptionDef[], analyze?: AnalyzeOptions): Result<Clause> {
  return withAnalysis({ ...clause, options }, analyze);
}

function deepCopy<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// ───────────────────────────── 생성 ─────────────────────────────

async function buildOptionValues(
  clauseCode: Code,
  optionCode: Code,
  inputs: readonly NewOptionValue[],
  startOrder: number,
  nextSeq: ClauseNextSeq,
): Promise<OptionValue[]> {
  const values: OptionValue[] = [];
  for (const [i, v] of inputs.entries()) {
    values.push({
      code: await allocateClauseCode("optionValue", optionValueScope(clauseCode, optionCode), nextSeq),
      label: v.label.trim(),
      body: v.body ?? [],
      order: startOrder + i,
    });
  }
  return values;
}

async function buildOption(clauseCode: Code, input: NewOption, order: number, nextSeq: ClauseNextSeq): Promise<Result<OptionDef>> {
  if (input.label.trim() === "") return invalid("typeMismatch", "옵션 표시명이 비어 있습니다");
  if (input.values.length < 2) {
    return invalid("typeMismatch", `옵션 자리는 선택지가 2개 이상이어야 합니다: ${input.label}`);
  }
  if (input.values.some((v) => v.label.trim() === "")) return invalid("typeMismatch", "선택지 표시명이 비어 있습니다");
  const code = await allocateClauseCode("option", clauseCode, nextSeq);
  const values = await buildOptionValues(clauseCode, code, input.values, 0, nextSeq);
  return ok({ code, label: input.label.trim(), values, order });
}

/**
 * 공용조항 채번 + 본문·옵션 등록. 모드는 필수.
 *
 * 검사를 전부 통과한 뒤에 채번한다 — 거부된 입력이 순번을 태우지 않게. 새 공용조항의 옵션·선택지
 * 순번 범위는 비어 있으므로 검사 단계의 임시 코드(O01… · V01…)와 실제 채번 결과가 같다.
 */
export async function createClause(input: NewClause, ctx: ClauseContext): Promise<Result<Clause>> {
  if (!MODES.includes(input.mode)) return invalid("typeMismatch", `모드는 inline 또는 block 이어야 합니다: ${String(input.mode)}`);
  const label = checkLabel(input.label, ctx.existing);
  if (!label.ok) return label as Result<Clause>;

  // 1. 임시 코드로 옵션을 만들고 본문까지 검사
  const provisional = memorySeq();
  const options: OptionDef[] = [];
  for (const [i, o] of (input.options ?? []).entries()) {
    const r = await buildOption("C?", o, i, provisional);
    if (!r.ok) return r as Result<Clause>;
    options.push(r.value);
  }
  const checked = withAnalysis(
    {
      code: "C?",
      label: label.value,
      mode: input.mode,
      description: input.description ?? "",
      body: (input.body ?? []) as Inline[] & Block[],
      options,
    } as Omit<Clause, "required">,
    ctx.analyze,
  );
  if (!checked.ok) return checked;

  // 2. 실제 채번 — 순번 범위가 비어 있어 임시 코드와 같은 값이 나온다
  const code = await allocateClauseCode("clause", "", ctx.nextSeq);
  for (const o of options) {
    const oc = await allocateClauseCode("option", code, ctx.nextSeq);
    if (oc !== o.code) throw new Error(`옵션 채번 불일치: ${oc} ≠ ${o.code}`);
    for (const v of o.values) {
      const vc = await allocateClauseCode("optionValue", optionValueScope(code, oc), ctx.nextSeq);
      if (vc !== v.code) throw new Error(`선택지 채번 불일치: ${vc} ≠ ${v.code}`);
    }
  }
  return ok({ ...checked.value, code } as Clause);
}

/** 검사 단계용 임시 순번 — (kind, scope) 마다 1 부터. */
function memorySeq(): ClauseNextSeq {
  const counters = new Map<string, number>();
  return (kind, scope) => {
    const n = (counters.get(`${kind}:${scope}`) ?? 0) + 1;
    counters.set(`${kind}:${scope}`, n);
    return n;
  };
}

// ───────────────────────────── 기본 정보 ─────────────────────────────

export function renameClause(clause: Clause, label: string, existing: readonly ClauseSummaryLite[]): Result<Clause> {
  const r = checkLabel(label, existing, clause.code);
  if (!r.ok) return r as Result<Clause>;
  return ok({ ...clause, label: r.value });
}

export function setClauseDescription(clause: Clause, description: string): Result<Clause> {
  return ok({ ...clause, description });
}

/** 본문 교체 — 모드는 그대로. 요구 구분자를 다시 계산한다. */
export function setBody(clause: Clause, body: ClauseBody, analyze?: AnalyzeOptions): Result<Clause> {
  return withAnalysis({ ...clause, body } as Omit<Clause, "required">, analyze);
}

/**
 * 모드 변경 — 본문 모양이 달라지므로 그 모드의 새 본문과 함께만 받는다.
 * (사용처의 참조 노드 종류가 어긋나는 문제는 사용처 재검사·관계정보 뷰가 드러낸다 — D-P3-1 참고.)
 */
export function setMode(clause: Clause, mode: ClauseMode, body: ClauseBody, analyze?: AnalyzeOptions): Result<Clause> {
  if (!MODES.includes(mode)) return invalid("typeMismatch", `모드는 inline 또는 block 이어야 합니다: ${String(mode)}`);
  return withAnalysis({ ...clause, mode, body } as Omit<Clause, "required">, analyze);
}

// ───────────────────────────── 옵션 ─────────────────────────────

export async function addOption(clause: Clause, input: NewOption, ctx: ClauseContext): Promise<Result<Clause>> {
  const r = await buildOption(clause.code, input, clause.options.length, ctx.nextSeq);
  if (!r.ok) return r as Result<Clause>;
  return withOptions(clause, [...clause.options, r.value], ctx.analyze);
}

export function renameOption(clause: Clause, optionCode: Code, label: string): Result<Clause> {
  const opt = findOption(clause, optionCode);
  if (!opt) return notFound(`옵션 ${optionCode}`);
  if (label.trim() === "") return invalid("typeMismatch", "옵션 표시명이 비어 있습니다");
  return ok({ ...clause, options: replaceOption(clause, { ...opt, label: label.trim() }) });
}

/** 선택지 추가 — 기존 사용처의 선택은 그대로, 미선택 자리도 생기지 않는다. */
export async function addOptionValue(clause: Clause, optionCode: Code, input: NewOptionValue, ctx: ClauseContext): Promise<Result<Clause>> {
  const opt = findOption(clause, optionCode);
  if (!opt) return notFound(`옵션 ${optionCode}`);
  if (input.label.trim() === "") return invalid("typeMismatch", "선택지 표시명이 비어 있습니다");
  const [value] = await buildOptionValues(clause.code, optionCode, [input], opt.values.length, ctx.nextSeq);
  return withOptions(clause, replaceOption(clause, { ...opt, values: [...opt.values, value] }), ctx.analyze);
}

export function renameOptionValue(clause: Clause, optionCode: Code, valueCode: Code, label: string): Result<Clause> {
  const opt = findOption(clause, optionCode);
  if (!opt) return notFound(`옵션 ${optionCode}`);
  const val = opt.values.find((v) => v.code === valueCode);
  if (!val) return notFound(`선택지 ${optionCode}/${valueCode}`);
  if (label.trim() === "") return invalid("typeMismatch", "선택지 표시명이 비어 있습니다");
  const values = opt.values.map((v) => (v.code === valueCode ? { ...v, label: label.trim() } : v));
  return ok({ ...clause, options: replaceOption(clause, { ...opt, values }) });
}

/** 선택지 문구 수정 — 이 선택지를 고른 사용처 전부에 전파된다 (마스터 소유). */
export function setOptionValueBody(clause: Clause, optionCode: Code, valueCode: Code, body: Inline[], analyze?: AnalyzeOptions): Result<Clause> {
  const opt = findOption(clause, optionCode);
  if (!opt) return notFound(`옵션 ${optionCode}`);
  if (!opt.values.some((v) => v.code === valueCode)) return notFound(`선택지 ${optionCode}/${valueCode}`);
  const values = opt.values.map((v) => (v.code === valueCode ? { ...v, body } : v));
  return withOptions(clause, replaceOption(clause, { ...opt, values }), analyze);
}

function checkOrder(current: readonly Code[], order: readonly Code[], what: string): Result<void> {
  const a = [...current].sort();
  const b = [...order].sort();
  if (a.length !== b.length || a.some((c, i) => c !== b[i])) {
    return invalid("typeMismatch", `${what} 순서 목록이 현재 목록과 맞지 않습니다 (빠지거나 낯선 코드)`);
  }
  return ok(undefined);
}

export function reorderOptions(clause: Clause, order: readonly Code[]): Result<Clause> {
  const r = checkOrder(clause.options.map((o) => o.code), order, "옵션");
  if (!r.ok) return r as Result<Clause>;
  const options = order.map((c, i) => ({ ...findOption(clause, c)!, order: i }));
  return ok({ ...clause, options });
}

export function reorderOptionValues(clause: Clause, optionCode: Code, order: readonly Code[]): Result<Clause> {
  const opt = findOption(clause, optionCode);
  if (!opt) return notFound(`옵션 ${optionCode}`);
  const r = checkOrder(opt.values.map((v) => v.code), order, "선택지");
  if (!r.ok) return r as Result<Clause>;
  const values = order.map((c, i) => ({ ...opt.values.find((v) => v.code === c)!, order: i }));
  return ok({ ...clause, options: replaceOption(clause, { ...opt, values }) });
}

/** 선택지 삭제 — 남는 선택지가 2개 미만이면 minimumStructure (D-P3-4). */
export function removeOptionValue(clause: Clause, optionCode: Code, valueCode: Code, analyze?: AnalyzeOptions): Result<Clause> {
  const opt = findOption(clause, optionCode);
  if (!opt) return notFound(`옵션 ${optionCode}`);
  if (!opt.values.some((v) => v.code === valueCode)) return notFound(`선택지 ${optionCode}/${valueCode}`);
  if (opt.values.length <= 2) {
    return reject({ reason: "minimumStructure", what: `옵션 ${opt.label}(${optionCode}) 은 선택지 2개 이상이어야 합니다` });
  }
  const values = opt.values.filter((v) => v.code !== valueCode).map((v, i) => ({ ...v, order: i }));
  return withOptions(clause, replaceOption(clause, { ...opt, values }), analyze);
}

/** 옵션 자리 삭제 — 본문이 아직 그 자리를 쓰면 거부 (자리를 먼저 빼야 한다). */
export function removeOption(clause: Clause, optionCode: Code, analyze?: AnalyzeOptions): Result<Clause> {
  if (!findOption(clause, optionCode)) return notFound(`옵션 ${optionCode}`);
  const slots = optionSlotIds(clause.body, optionCode);
  if (slots.length > 0) {
    return reject({
      reason: "invalid",
      issues: slots.map((id) => ({
        kind: "brokenRef" as const,
        message: `본문의 옵션 자리(${id})가 옵션 ${optionCode} 을(를) 아직 쓰고 있습니다`,
        at: { document: "clause", nodePath: [id], refPath: optionCode },
      })),
    });
  }
  const options = clause.options.filter((o) => o.code !== optionCode).map((o, i) => ({ ...o, order: i }));
  return withOptions(clause, options, analyze);
}

/** 본문에서 이 옵션을 가리키는 optionSlot 노드 id 들. */
export function optionSlotIds(body: ClauseBody, optionCode: Code): Code[] {
  const ids: Code[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const n = node as { id?: string; kind?: string; optionCode?: string; children?: unknown[]; items?: unknown[]; subitems?: unknown[]; branches?: unknown[] };
    if (n.kind === "optionSlot" && n.optionCode === optionCode && n.id) ids.push(n.id);
    for (const key of ["children", "items", "subitems", "branches"] as const) {
      const list = n[key];
      if (Array.isArray(list)) for (const c of list) visit(c);
    }
  };
  for (const n of body) visit(n);
  return ids;
}

// ───────────────────────────── 복제 (D-P3-3) ─────────────────────────────

/** 본문·옵션을 복사한 새 정의. 새 코드 채번, 표시명 「(복제)」 접미. 사용처 참조는 승계하지 않는다. */
export async function duplicateClause(origin: Clause, ctx: ClauseContext): Promise<Result<Clause>> {
  const taken = new Set(ctx.existing.map((e) => e.label));
  let label = `${origin.label}(복제)`;
  for (let n = 2; taken.has(label); n++) label = `${origin.label}(복제${n})`;

  const code = await allocateClauseCode("clause", "", ctx.nextSeq);
  // 옵션·선택지 코드는 새 공용조항 안에서 다시 채번한다 (순번 범위가 공용조항마다라 같은 코드가 나온다).
  const options: OptionDef[] = [];
  for (const o of origin.options) {
    const optionCode = await allocateClauseCode("option", code, ctx.nextSeq);
    const values: OptionValue[] = [];
    for (const v of o.values) {
      values.push({
        ...deepCopy(v),
        code: await allocateClauseCode("optionValue", optionValueScope(code, optionCode), ctx.nextSeq),
      });
    }
    options.push({ ...o, code: optionCode, values });
  }
  // 옵션 코드가 원본과 다르게 채번됐다면 본문의 optionSlot 도 맞춘다.
  const codeMap = new Map(origin.options.map((o, i) => [o.code, options[i].code]));
  const body = remapOptionSlots(deepCopy(origin.body), codeMap);

  return withAnalysis(
    { code, label, mode: origin.mode, description: origin.description, body, options } as Omit<Clause, "required">,
    ctx.analyze,
  );
}

function remapOptionSlots<B extends ClauseBody>(body: B, codeMap: Map<Code, Code>): B {
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const n = node as { kind?: string; optionCode?: string; children?: unknown[]; items?: unknown[]; subitems?: unknown[]; branches?: unknown[] };
    if (n.kind === "optionSlot" && n.optionCode && codeMap.has(n.optionCode)) n.optionCode = codeMap.get(n.optionCode);
    for (const key of ["children", "items", "subitems", "branches"] as const) {
      const list = n[key];
      if (Array.isArray(list)) for (const c of list) visit(c);
    }
  };
  for (const n of body) visit(n);
  return body;
}

/** 정의 안의 노드 id 전부 (본문 + 선택지 본문). */
export function clauseNodeIds(clause: Clause): Code[] {
  return [...allNodeIds(clause.body), ...clause.options.flatMap((o) => o.values.flatMap((v) => allNodeIds(v.body)))];
}
