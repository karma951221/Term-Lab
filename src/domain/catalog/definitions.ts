/**
 * 구분자·enum 정의의 생성·변경 규칙 (순수).
 *
 * 근거: docs/01_기획/구분자_기획.md · ADR-0001 · ADR-0005 · ADR-0007 · 구분자_액션 D-P1-1·5·7·8·12·13.
 *
 * - 생성은 코드를 채번한다 — 순번은 주입된 `nextSeq` 가 준다 (저장소).
 * - 비파괴 변경(표시명 · 설명 · 기본값 · 필드 추가 · 순서 · enum 값 추가 · const 값 · 파생식)은
 *   여기서 새 정의를 돌려준다. 원본은 바꾸지 않는다.
 * - 파괴적 변경(타입 변경 · 필드 삭제 · enum 값 삭제)의 **정의 쪽 결과**도 여기 있다 —
 *   영향 계산·확인·값 행 삭제는 서비스가 `destructive()` + `ImpactSource` 로 두른다.
 */
import {
  ATTACH_LEVEL_LABEL,
  ATTACH_LEVELS,
  type AttachLevel,
  type Code,
  type FieldType,
  type Issue,
  ok,
  reject,
  type Result,
  type Value,
} from "../types";
import { allocateCode, type NextSeq } from "./codes";
import type {
  ConstDiscriminator,
  DerivedDiscriminator,
  Discriminator,
  EnumDef,
  EnumLookup,
  EnumValueDef,
  FieldDef,
  NewDiscriminator,
  NewEnum,
  NewEnumValue,
  NewField,
  ScalarDiscriminator,
  StructDiscriminator,
} from "./types";
import { slotPath, validateValue } from "./values";

// ───────────────────────────── 문맥 ─────────────────────────────

/** 표시명 중복 검사에 필요한 최소 정보. const 는 level 없음. */
export interface DiscriminatorSummary {
  code: Code;
  label: string;
  level?: AttachLevel;
}

export interface CatalogContext {
  nextSeq: NextSeq;
  /** 현재 카탈로그의 구분자들 (중복 검사용). */
  existing: readonly DiscriminatorSummary[];
  findEnum: EnumLookup;
  /** 현재 enum 표시명들 (D-P1-7 중복 검사용). */
  existingEnumLabels?: readonly string[];
  /** 별칭형 파생 판정. 기본 `isAliasExpression`. expression 모듈이 있으면 그것을 주입. */
  isAlias?: (expression: string) => boolean;
}

// ───────────────────────────── 공통 검사 ─────────────────────────────

const FIELD_TYPE_KINDS: ReadonlySet<string> = new Set([
  "string",
  "number",
  "boolean",
  "date",
  "enum",
  "list<enum>",
]);

function invalid<T>(issues: Issue[]): Result<T> {
  return reject({ reason: "invalid", issues });
}

function issue(kind: Issue["kind"], message: string, refPath?: string): Issue {
  return { kind, message, at: refPath ? { refPath } : {} };
}

function checkLabel(label: unknown, what: string): Issue[] {
  return typeof label === "string" && label.trim().length > 0
    ? []
    : [issue("typeMismatch", `${what} 표시명은 비울 수 없습니다`)];
}

function checkLevel(level: unknown): Issue[] {
  return (ATTACH_LEVELS as readonly string[]).includes(level as string)
    ? []
    : [issue("typeMismatch", `부착 레벨은 ${ATTACH_LEVELS.join(" · ")} 중 하나여야 합니다`)];
}

/** FieldType 이 6종 중 하나이고, enum 참조면 그 enum 이 존재하는가. 구조체 중첩은 여기서 막힌다. */
export function validateFieldType(type: FieldType, findEnum: EnumLookup, refPath?: string): Issue[] {
  if (!type || !FIELD_TYPE_KINDS.has(type.kind)) {
    return [issue("typeMismatch", "필드 타입은 string · number · boolean · date · enum · list<enum> 중 하나입니다 (구조체 중첩 금지)", refPath)];
  }
  if ("enumCode" in type && !findEnum(type.enumCode)) {
    return [issue("brokenRef", `enum ${type.enumCode} 이(가) 없습니다`, refPath)];
  }
  return [];
}

function checkDefault(
  type: FieldType,
  value: Value | undefined,
  findEnum: EnumLookup,
  refPath: string,
): Issue[] {
  return value === undefined ? [] : validateValue(type, value, findEnum, { refPath });
}

/** 같은 부착 레벨(const 는 레벨 없음) 안 표시명 완전 중복 (D-P1-1). */
function findDuplicateLabel(
  label: string,
  level: AttachLevel | undefined,
  existing: readonly DiscriminatorSummary[],
  selfCode?: Code,
): Result<void> {
  const hit = existing.find((e) => e.code !== selfCode && e.level === level && e.label === label);
  if (!hit) return ok(undefined);
  const scope = level ? `${ATTACH_LEVEL_LABEL[level]} 레벨` : "const";
  return reject({ reason: "duplicate", what: `${scope} 표시명 「${label}」` });
}

function levelOf(def: Discriminator): AttachLevel | undefined {
  return def.kind === "const" ? undefined : def.level;
}

/** 기본 별칭 판정 — 식이 참조 경로 하나뿐이면 별칭 (`D0001` · `D0002.F01`). */
export function isAliasExpression(expression: string): boolean {
  return /^[A-Za-z_][\w]*(\.[A-Za-z_][\w]*)*$/.test(expression.trim());
}

function checkExpression(expression: unknown, isAlias: (e: string) => boolean): Issue[] {
  if (typeof expression !== "string" || expression.trim().length === 0) {
    return [issue("syntax", "파생식은 비울 수 없습니다")];
  }
  if (isAlias(expression)) {
    return [
      issue(
        "syntax",
        "별칭형 파생(A = B)은 만들 수 없습니다 — 값이 필요하면 기존 구분자를 그대로 참조하세요",
      ),
    ];
  }
  return [];
}

// ───────────────────────────── 생성 ─────────────────────────────

async function buildFields(
  structCode: Code,
  inputs: readonly NewField[],
  startOrder: number,
  ctx: Pick<CatalogContext, "nextSeq" | "findEnum">,
  taken: readonly string[],
): Promise<Result<FieldDef[]>> {
  const issues: Issue[] = [];
  const labels = new Set(taken);
  for (const f of inputs) {
    issues.push(...checkLabel(f.label, "필드"));
    if (labels.has(f.label)) {
      return reject({ reason: "duplicate", what: `필드 표시명 「${f.label}」` });
    }
    labels.add(f.label);
    issues.push(...validateFieldType(f.type, ctx.findEnum, f.label));
    if (issues.length === 0) issues.push(...checkDefault(f.type, f.defaultValue, ctx.findEnum, f.label));
  }
  if (issues.length > 0) return invalid(issues);

  const fields: FieldDef[] = [];
  for (const [i, f] of inputs.entries()) {
    const code = await allocateCode("field", structCode, ctx.nextSeq);
    fields.push({
      code,
      label: f.label,
      type: f.type,
      ...(f.defaultValue !== undefined ? { defaultValue: f.defaultValue } : {}),
      order: startOrder + i,
    });
  }
  return ok(fields);
}

/** 구분자 채번. 코드는 여기서 태어난다 — 입력에 code 는 없다. */
export async function createDiscriminator(
  input: NewDiscriminator,
  ctx: CatalogContext,
): Promise<Result<Discriminator>> {
  const issues = checkLabel(input.label, "구분자");
  const level = input.kind === "const" ? undefined : input.level;
  if (input.kind !== "const") issues.push(...checkLevel(input.level));
  if (issues.length > 0) return invalid(issues);

  const dup = findDuplicateLabel(input.label, level, ctx.existing);
  if (!dup.ok) return dup as Result<Discriminator>;

  const description = input.description ?? "";

  switch (input.kind) {
    case "scalar": {
      const typeIssues = validateFieldType(input.type, ctx.findEnum);
      if (typeIssues.length > 0) return invalid(typeIssues);
      const dv = checkDefault(input.type, input.defaultValue, ctx.findEnum, "");
      if (dv.length > 0) return invalid(dv);
      const code = await allocateCode("discriminator", "", ctx.nextSeq);
      return ok({
        kind: "scalar",
        code,
        label: input.label,
        description,
        level: input.level,
        alwaysExposed: input.alwaysExposed ?? false,
        type: input.type,
        ...(input.defaultValue !== undefined ? { defaultValue: input.defaultValue } : {}),
      });
    }
    case "struct": {
      const code = await allocateCode("discriminator", "", ctx.nextSeq);
      const fields = await buildFields(code, input.fields ?? [], 0, ctx, []);
      if (!fields.ok) return fields as Result<Discriminator>;
      return ok({
        kind: "struct",
        code,
        label: input.label,
        description,
        level: input.level,
        alwaysExposed: input.alwaysExposed ?? false,
        fields: fields.value,
      });
    }
    case "const": {
      if (typeof input.value !== "string") {
        return invalid([issue("typeMismatch", "const 구분자의 값은 문자열만 가능합니다 (MVP)")]);
      }
      const code = await allocateCode("discriminator", "", ctx.nextSeq);
      return ok({ kind: "const", code, label: input.label, description, value: input.value });
    }
    case "derived": {
      const exprIssues = checkExpression(input.expression, ctx.isAlias ?? isAliasExpression);
      if (exprIssues.length > 0) return invalid(exprIssues);
      const code = await allocateCode("discriminator", "", ctx.nextSeq);
      return ok({
        kind: "derived",
        code,
        label: input.label,
        description,
        level: input.level,
        expression: input.expression,
      });
    }
  }
}

// ───────────────────────────── 비파괴 변경 ─────────────────────────────

/** 표시명 변경 — 자유. 같은 레벨 중복만 막는다 (자기 자신 제외). */
export function renameDiscriminator<D extends Discriminator>(
  def: D,
  label: string,
  existing: readonly DiscriminatorSummary[],
): Result<D> {
  const issues = checkLabel(label, "구분자");
  if (issues.length > 0) return invalid(issues);
  const dup = findDuplicateLabel(label, levelOf(def), existing, def.code);
  if (!dup.ok) return dup as Result<D>;
  return ok({ ...def, label });
}

export function setDescription<D extends Discriminator>(def: D, description: string): Result<D> {
  return ok({ ...def, description });
}

export function setAlwaysExposed<D extends ScalarDiscriminator | StructDiscriminator>(
  def: D,
  alwaysExposed: boolean,
): Result<D> {
  return ok({ ...def, alwaysExposed });
}

/** scalar 기본값 지정(값) · 해제(undefined). 프리필 전용 — 저장소 값 자리는 그대로. */
export function setDefaultValue(
  def: ScalarDiscriminator,
  value: Value | undefined,
  findEnum: EnumLookup,
): Result<ScalarDiscriminator> {
  const issues = checkDefault(def.type, value, findEnum, slotPath(def.code));
  if (issues.length > 0) return invalid(issues);
  const { defaultValue: _dropped, ...rest } = def;
  void _dropped;
  return ok(value === undefined ? rest : { ...rest, defaultValue: value });
}

function findField(def: StructDiscriminator, fieldCode: Code): Result<FieldDef> {
  const f = def.fields.find((x) => x.code === fieldCode);
  return f ? ok(f) : reject({ reason: "notFound", what: `필드 ${fieldCode}` });
}

function replaceField(def: StructDiscriminator, next: FieldDef): StructDiscriminator {
  return { ...def, fields: def.fields.map((f) => (f.code === next.code ? next : f)) };
}

/** 필드 추가 — 비파괴. 다음 코드를 받고 맨 뒤에 붙는다. 기존 저장분에는 새 자리가 미입력으로 나타난다. */
export async function addField(
  def: StructDiscriminator,
  input: NewField,
  ctx: Pick<CatalogContext, "nextSeq" | "findEnum">,
): Promise<Result<StructDiscriminator>> {
  const built = await buildFields(
    def.code,
    [input],
    def.fields.length,
    ctx,
    def.fields.map((f) => f.label),
  );
  if (!built.ok) return built as Result<StructDiscriminator>;
  return ok({ ...def, fields: [...def.fields, ...built.value] });
}

export function renameField(
  def: StructDiscriminator,
  fieldCode: Code,
  label: string,
): Result<StructDiscriminator> {
  const issues = checkLabel(label, "필드");
  if (issues.length > 0) return invalid(issues);
  const f = findField(def, fieldCode);
  if (!f.ok) return f as Result<StructDiscriminator>;
  if (def.fields.some((x) => x.code !== fieldCode && x.label === label)) {
    return reject({ reason: "duplicate", what: `필드 표시명 「${label}」` });
  }
  return ok(replaceField(def, { ...f.value, label }));
}

/** 필드 순서 변경 (D-P1-5) — 전체 필드 코드를 새 순서로. */
export function reorderFields(def: StructDiscriminator, order: readonly Code[]): Result<StructDiscriminator> {
  const have = def.fields.map((f) => f.code).sort();
  const want = [...order].sort();
  if (have.length !== want.length || have.some((c, i) => c !== want[i])) {
    return invalid([issue("typeMismatch", "필드 순서에는 모든 필드 코드가 한 번씩 있어야 합니다")]);
  }
  const byCode = new Map(def.fields.map((f) => [f.code, f]));
  return ok({ ...def, fields: order.map((c, i) => ({ ...byCode.get(c)!, order: i })) });
}

export function setFieldDefaultValue(
  def: StructDiscriminator,
  fieldCode: Code,
  value: Value | undefined,
  findEnum: EnumLookup,
): Result<StructDiscriminator> {
  const f = findField(def, fieldCode);
  if (!f.ok) return f as Result<StructDiscriminator>;
  const issues = checkDefault(f.value.type, value, findEnum, slotPath(def.code, fieldCode));
  if (issues.length > 0) return invalid(issues);
  const { defaultValue: _dropped, ...rest } = f.value;
  void _dropped;
  return ok(replaceField(def, value === undefined ? rest : { ...rest, defaultValue: value }));
}

/** const 값 변경 — 비파괴 (D-P1-14). string 만. */
export function setConstValue(def: ConstDiscriminator, value: string): Result<ConstDiscriminator> {
  if (typeof value !== "string") {
    return invalid([issue("typeMismatch", "const 구분자의 값은 문자열만 가능합니다 (MVP)")]);
  }
  return ok({ ...def, value });
}

/** 파생식 수정 — 비파괴 (D-P1-12). 채번과 같은 검증. */
export function setExpression(
  def: DerivedDiscriminator,
  expression: string,
  isAlias: (e: string) => boolean = isAliasExpression,
): Result<DerivedDiscriminator> {
  const issues = checkExpression(expression, isAlias);
  if (issues.length > 0) return invalid(issues);
  return ok({ ...def, expression });
}

// ───────────────────────────── 파괴적 변경의 정의 쪽 결과 ─────────────────────────────

/** scalar 타입 변경 — 옛 타입의 기본값은 버린다. 값 행 삭제는 서비스 몫. */
export function changeScalarType(
  def: ScalarDiscriminator,
  type: FieldType,
  findEnum: EnumLookup,
): Result<ScalarDiscriminator> {
  const issues = validateFieldType(type, findEnum, slotPath(def.code));
  if (issues.length > 0) return invalid(issues);
  const { defaultValue: _dropped, ...rest } = def;
  void _dropped;
  return ok({ ...rest, type });
}

export function changeFieldType(
  def: StructDiscriminator,
  fieldCode: Code,
  type: FieldType,
  findEnum: EnumLookup,
): Result<StructDiscriminator> {
  const f = findField(def, fieldCode);
  if (!f.ok) return f as Result<StructDiscriminator>;
  const issues = validateFieldType(type, findEnum, slotPath(def.code, fieldCode));
  if (issues.length > 0) return invalid(issues);
  const { defaultValue: _dropped, ...rest } = f.value;
  void _dropped;
  return ok(replaceField(def, { ...rest, type }));
}

/** 필드 삭제 — 남은 필드의 order 를 다시 매긴다. */
export function removeField(def: StructDiscriminator, fieldCode: Code): Result<StructDiscriminator> {
  const f = findField(def, fieldCode);
  if (!f.ok) return f as Result<StructDiscriminator>;
  return ok({
    ...def,
    fields: def.fields.filter((x) => x.code !== fieldCode).map((x, i) => ({ ...x, order: i })),
  });
}

// ───────────────────────────── enum ─────────────────────────────

function checkEnumLabel(label: string, existing: readonly string[], self?: string): Result<void> {
  const issues = checkLabel(label, "enum");
  if (issues.length > 0) return invalid(issues);
  if (label !== self && existing.includes(label)) {
    return reject({ reason: "duplicate", what: `enum 표시명 「${label}」` });
  }
  return ok(undefined);
}

async function buildEnumValues(
  enumCode: Code,
  inputs: readonly NewEnumValue[],
  startOrder: number,
  nextSeq: NextSeq,
  taken: readonly string[],
): Promise<Result<EnumValueDef[]>> {
  const labels = new Set(taken);
  for (const v of inputs) {
    const issues = checkLabel(v.label, "enum 값");
    if (issues.length > 0) return invalid(issues);
    if (labels.has(v.label)) return reject({ reason: "duplicate", what: `enum 값 표시명 「${v.label}」` });
    labels.add(v.label);
  }
  const values: EnumValueDef[] = [];
  for (const [i, v] of inputs.entries()) {
    values.push({ code: await allocateCode("enumValue", enumCode, nextSeq), label: v.label, order: startOrder + i });
  }
  return ok(values);
}

/** enum 정의 생성 — E0001 부터, 값은 그 enum 안에서 V01 부터. */
export async function createEnum(
  input: NewEnum,
  ctx: Pick<CatalogContext, "nextSeq" | "existingEnumLabels">,
): Promise<Result<EnumDef>> {
  const labelOk = checkEnumLabel(input.label, ctx.existingEnumLabels ?? []);
  if (!labelOk.ok) return labelOk as Result<EnumDef>;
  const code = await allocateCode("enum", "", ctx.nextSeq);
  const values = await buildEnumValues(code, input.values ?? [], 0, ctx.nextSeq, []);
  if (!values.ok) return values as Result<EnumDef>;
  return ok({ code, label: input.label, values: values.value });
}

export function renameEnum(def: EnumDef, label: string, existingEnumLabels: readonly string[]): Result<EnumDef> {
  const r = checkEnumLabel(label, existingEnumLabels, def.label);
  if (!r.ok) return r as Result<EnumDef>;
  return ok({ ...def, label });
}

/** enum 값 추가 — 자유. 코드 배포 없이 유효값이 늘어난다. */
export async function addEnumValue(def: EnumDef, input: NewEnumValue, nextSeq: NextSeq): Promise<Result<EnumDef>> {
  const built = await buildEnumValues(
    def.code,
    [input],
    def.values.length,
    nextSeq,
    def.values.map((v) => v.label),
  );
  if (!built.ok) return built as Result<EnumDef>;
  return ok({ ...def, values: [...def.values, ...built.value] });
}

function findEnumValue(def: EnumDef, valueCode: Code): Result<EnumValueDef> {
  const v = def.values.find((x) => x.code === valueCode);
  return v ? ok(v) : reject({ reason: "notFound", what: `enum 값 ${valueCode}` });
}

export function renameEnumValue(def: EnumDef, valueCode: Code, label: string): Result<EnumDef> {
  const issues = checkLabel(label, "enum 값");
  if (issues.length > 0) return invalid(issues);
  const v = findEnumValue(def, valueCode);
  if (!v.ok) return v as Result<EnumDef>;
  if (def.values.some((x) => x.code !== valueCode && x.label === label)) {
    return reject({ reason: "duplicate", what: `enum 값 표시명 「${label}」` });
  }
  return ok({ ...def, values: def.values.map((x) => (x.code === valueCode ? { ...x, label } : x)) });
}

/** 값 순서 변경 (D-P1-8) — 전체 값 코드를 새 순서로. */
export function reorderEnumValues(def: EnumDef, order: readonly Code[]): Result<EnumDef> {
  const have = def.values.map((v) => v.code).sort();
  const want = [...order].sort();
  if (have.length !== want.length || have.some((c, i) => c !== want[i])) {
    return invalid([issue("typeMismatch", "값 순서에는 모든 값 코드가 한 번씩 있어야 합니다")]);
  }
  const byCode = new Map(def.values.map((v) => [v.code, v]));
  return ok({ ...def, values: order.map((c, i) => ({ ...byCode.get(c)!, order: i })) });
}

/** enum 값 삭제의 정의 쪽 결과 — 값 행 삭제·참조 오류화는 서비스 몫. */
export function removeEnumValue(def: EnumDef, valueCode: Code): Result<EnumDef> {
  const v = findEnumValue(def, valueCode);
  if (!v.ok) return v as Result<EnumDef>;
  return ok({
    ...def,
    values: def.values.filter((x) => x.code !== valueCode).map((x, i) => ({ ...x, order: i })),
  });
}
