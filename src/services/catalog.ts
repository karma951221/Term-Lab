/**
 * 카탈로그 서비스 — 모든 쓰기의 진입점. actor 검사 · 도메인 규칙 · repo 호출.
 *
 * - 비파괴 액션(채번 · 표시명 · 설명 · 기본값 · 필드 추가 · 순서 · enum 값 추가 · const 값 · 파생식)은
 *   editor 도 가능. 도메인 함수가 새 정의를 돌려주면 그대로 저장한다.
 * - 파괴적 액션(삭제 · 타입 변경 · 필드 삭제 · enum 값/정의 삭제)은 `destructive()` 2단 프로토콜:
 *   editor → forbidden · admin 1차 → needsConfirmation(Impact) · `{ confirm: true }` → 실행.
 *   실행은 정의 저장 + `ImpactSource.purgeValueRows` (값 행 연쇄 삭제) 순.
 * - 값 저장소·참조 역인덱스는 다른 영역(B1·B4·C1) — `ImpactSource` 로 주입한다.
 *   주입이 없으면 `NO_VALUE_STORE` (값 행 0 · 참조 없음).
 */
import { destructive } from "@/domain/auth";
import {
  addEnumValue,
  addField,
  cascadeOf,
  changeFieldType,
  changeScalarType,
  computeImpact,
  createDiscriminator,
  createEnum,
  enumReferences,
  isAliasExpression,
  NO_VALUE_STORE,
  removeEnumValue,
  removeField,
  renameDiscriminator,
  renameEnum,
  renameEnumValue,
  renameField,
  reorderEnumValues,
  reorderFields,
  setAlwaysExposed,
  setConstValue,
  setDefaultValue,
  setDescription,
  setExpression,
  setFieldDefaultValue,
  type CatalogContext,
  type ConstDiscriminator,
  type DerivedDiscriminator,
  type Discriminator,
  type DiscriminatorSummary,
  type EnumDef,
  type ImpactSource,
  type ImpactTarget,
  type NewDiscriminator,
  type NewEnum,
  type NewEnumValue,
  type NewField,
  type ScalarDiscriminator,
  type StructDiscriminator,
  type ValuedDiscriminator,
} from "@/domain/catalog";
import type { Actor, Code, FieldType, Result, Value } from "@/domain/types";
import { ok, reject } from "@/domain/types";

import * as repo from "@/db/repo/catalog";
import type { Db } from "@/db/repo/types";

export interface CatalogServiceDeps {
  /** 값 행 수 · 깨질 참조 · 값 행 삭제. 기본 NO_VALUE_STORE. */
  impact?: ImpactSource;
  /** 별칭형 파생 판정 — expression 모듈 주입. 기본 `isAliasExpression`. */
  isAlias?: (expression: string) => boolean;
}

/** 파괴적 액션의 2단 프로토콜 옵션. */
export interface Confirmable {
  confirm?: boolean;
}

export interface CatalogService {
  // 조회
  get(code: Code): Promise<Discriminator | undefined>;
  list(): Promise<Discriminator[]>;
  audit(code: Code): ReturnType<typeof repo.discriminatorAudit>;
  getEnum(code: Code): Promise<EnumDef | undefined>;
  listEnums(): Promise<EnumDef[]>;

  // 구분자 — 비파괴
  create(actor: Actor, input: NewDiscriminator): Promise<Result<Discriminator>>;
  rename(actor: Actor, code: Code, label: string): Promise<Result<Discriminator>>;
  setDescription(actor: Actor, code: Code, description: string): Promise<Result<Discriminator>>;
  setAlwaysExposed(actor: Actor, code: Code, alwaysExposed: boolean): Promise<Result<ValuedDiscriminator>>;
  setDefaultValue(actor: Actor, code: Code, value: Value | undefined): Promise<Result<ScalarDiscriminator>>;
  addField(actor: Actor, code: Code, input: NewField): Promise<Result<StructDiscriminator>>;
  renameField(actor: Actor, code: Code, fieldCode: Code, label: string): Promise<Result<StructDiscriminator>>;
  reorderFields(actor: Actor, code: Code, order: Code[]): Promise<Result<StructDiscriminator>>;
  setFieldDefaultValue(actor: Actor, code: Code, fieldCode: Code, value: Value | undefined): Promise<Result<StructDiscriminator>>;
  setConstValue(actor: Actor, code: Code, value: string): Promise<Result<ConstDiscriminator>>;
  setExpression(actor: Actor, code: Code, expression: string): Promise<Result<DerivedDiscriminator>>;

  // 구분자 — 파괴적 (admin · 2단)
  changeScalarType(actor: Actor, code: Code, type: FieldType, opts?: Confirmable): Promise<Result<ScalarDiscriminator>>;
  changeFieldType(actor: Actor, code: Code, fieldCode: Code, type: FieldType, opts?: Confirmable): Promise<Result<StructDiscriminator>>;
  removeField(actor: Actor, code: Code, fieldCode: Code, opts?: Confirmable): Promise<Result<StructDiscriminator>>;
  remove(actor: Actor, code: Code, opts?: Confirmable): Promise<Result<void>>;

  // enum — 비파괴
  createEnum(actor: Actor, input: NewEnum): Promise<Result<EnumDef>>;
  renameEnum(actor: Actor, code: Code, label: string): Promise<Result<EnumDef>>;
  addEnumValue(actor: Actor, code: Code, input: NewEnumValue): Promise<Result<EnumDef>>;
  renameEnumValue(actor: Actor, code: Code, valueCode: Code, label: string): Promise<Result<EnumDef>>;
  reorderEnumValues(actor: Actor, code: Code, order: Code[]): Promise<Result<EnumDef>>;

  // enum — 파괴적 (admin · 2단)
  removeEnumValue(actor: Actor, code: Code, valueCode: Code, opts?: Confirmable): Promise<Result<EnumDef>>;
  removeEnum(actor: Actor, code: Code, opts?: Confirmable): Promise<Result<void>>;
}

type KindOf<K extends Discriminator["kind"]> = Extract<Discriminator, { kind: K }>;

export function createCatalogService(db: Db, deps: CatalogServiceDeps = {}): CatalogService {
  const impact = deps.impact ?? NO_VALUE_STORE;
  const isAlias = deps.isAlias ?? isAliasExpression;

  // ───────── 공통 헬퍼 ─────────

  async function context(tx: Db): Promise<CatalogContext> {
    const [defs, enumDefs] = await Promise.all([repo.listDiscriminators(tx), repo.listEnums(tx)]);
    const existing: DiscriminatorSummary[] = defs.map((d) => ({
      code: d.code,
      label: d.label,
      ...(d.kind === "const" ? {} : { level: d.level }),
    }));
    const enumByCode = new Map(enumDefs.map((e) => [e.code, e]));
    return {
      nextSeq: repo.seqSource(tx),
      existing,
      findEnum: (c) => enumByCode.get(c),
      existingEnumLabels: enumDefs.map((e) => e.label),
      isAlias,
    };
  }

  function notFound<T>(what: string): Result<T> {
    return reject({ reason: "notFound", what });
  }

  function wrongKind<T>(code: Code, expected: string): Result<T> {
    return reject({
      reason: "invalid",
      issues: [{ kind: "typeMismatch", message: `구분자 ${code} 은(는) ${expected} 이(가) 아닙니다`, at: { refPath: code } }],
    });
  }

  /** 정의를 읽어 종류를 확인하고 fn 에 넘긴다. */
  async function withDef<K extends Discriminator["kind"], T>(
    tx: Db,
    code: Code,
    kinds: readonly K[] | undefined,
    fn: (def: KindOf<K>) => Promise<Result<T>> | Result<T>,
  ): Promise<Result<T>> {
    const def = await repo.loadDiscriminator(tx, code);
    if (!def) return notFound(`구분자 ${code}`);
    if (kinds && !(kinds as readonly string[]).includes(def.kind)) return wrongKind(code, kinds.join(" | "));
    return fn(def as KindOf<K>);
  }

  /** 비파괴 변경 — 읽기 → 도메인 → 저장, 한 트랜잭션. */
  function edit<K extends Discriminator["kind"], D extends Discriminator>(
    actor: Actor,
    code: Code,
    kinds: readonly K[] | undefined,
    change: (def: KindOf<K>, ctx: CatalogContext) => Promise<Result<D>> | Result<D>,
  ): Promise<Result<D>> {
    return db.transaction((tx) =>
      withDef(tx, code, kinds, async (def) => {
        const r = await change(def, await context(tx));
        if (!r.ok) return r;
        await repo.saveDiscriminator(tx, r.value, actor.userId);
        return r;
      }),
    );
  }

  /** 파괴적 변경 — destructive() 2단 + 저장 + 값 행 purge. */
  function editDestructive<K extends Discriminator["kind"], D extends Discriminator>(
    actor: Actor,
    action: "catalog.changeType" | "catalog.deleteField",
    code: Code,
    kinds: readonly K[],
    target: ImpactTarget,
    opts: Confirmable,
    change: (def: KindOf<K>, ctx: CatalogContext) => Result<D>,
  ): Promise<Result<D>> {
    return db.transaction(async (tx) => {
      let loaded: KindOf<K> | undefined;
      let changed: Result<D> | undefined;
      return destructive<D>({
        actor,
        action,
        confirm: opts.confirm,
        precheck: () =>
          withDef(tx, code, kinds, async (def) => {
            loaded = def;
            changed = change(def, await context(tx));
            return changed.ok ? ok(undefined) : (changed as Result<void>);
          }),
        computeImpact: () => computeImpact(target, impact),
        execute: async () => {
          if (!changed?.ok || !loaded) throw new Error("precheck 없이 execute 호출");
          await repo.saveDiscriminator(tx, changed.value, actor.userId);
          await impact.purgeValueRows(target);
          return changed;
        },
      });
    });
  }

  async function withEnum<T>(tx: Db, code: Code, fn: (def: EnumDef) => Promise<Result<T>> | Result<T>): Promise<Result<T>> {
    const def = await repo.loadEnum(tx, code);
    if (!def) return notFound(`enum ${code}`);
    return fn(def);
  }

  function editEnum(
    actor: Actor,
    code: Code,
    change: (def: EnumDef, ctx: CatalogContext) => Promise<Result<EnumDef>> | Result<EnumDef>,
  ): Promise<Result<EnumDef>> {
    return db.transaction((tx) =>
      withEnum(tx, code, async (def) => {
        const r = await change(def, await context(tx));
        if (!r.ok) return r;
        await repo.saveEnum(tx, r.value, actor.userId);
        return r;
      }),
    );
  }

  // ───────── 서비스 ─────────

  return {
    get: (code) => repo.loadDiscriminator(db, code),
    list: () => repo.listDiscriminators(db),
    audit: (code) => repo.discriminatorAudit(db, code),
    getEnum: (code) => repo.loadEnum(db, code),
    listEnums: () => repo.listEnums(db),

    create: (actor, input) =>
      db.transaction(async (tx) => {
        const r = await createDiscriminator(input, await context(tx));
        if (!r.ok) return r;
        await repo.insertDiscriminator(tx, r.value, actor.userId);
        return r;
      }),

    rename: (actor, code, label) => edit(actor, code, undefined, (def, ctx) => renameDiscriminator(def, label, ctx.existing)),
    setDescription: (actor, code, description) => edit(actor, code, undefined, (def) => setDescription(def, description)),
    setAlwaysExposed: (actor, code, v) => edit(actor, code, ["scalar", "struct"] as const, (def) => setAlwaysExposed(def, v)),
    setDefaultValue: (actor, code, value) =>
      edit(actor, code, ["scalar"] as const, (def, ctx) => setDefaultValue(def, value, ctx.findEnum)),
    addField: (actor, code, input) => edit(actor, code, ["struct"] as const, (def, ctx) => addField(def, input, ctx)),
    renameField: (actor, code, fieldCode, label) => edit(actor, code, ["struct"] as const, (def) => renameField(def, fieldCode, label)),
    reorderFields: (actor, code, order) => edit(actor, code, ["struct"] as const, (def) => reorderFields(def, order)),
    setFieldDefaultValue: (actor, code, fieldCode, value) =>
      edit(actor, code, ["struct"] as const, (def, ctx) => setFieldDefaultValue(def, fieldCode, value, ctx.findEnum)),
    setConstValue: (actor, code, value) => edit(actor, code, ["const"] as const, (def) => setConstValue(def, value)),
    setExpression: (actor, code, expression) =>
      edit(actor, code, ["derived"] as const, (def) => setExpression(def, expression, isAlias)),

    changeScalarType: (actor, code, type, opts = {}) =>
      editDestructive(
        actor,
        "catalog.changeType",
        code,
        ["scalar"] as const,
        { kind: "discriminator", code },
        opts,
        (def, ctx) => changeScalarType(def, type, ctx.findEnum),
      ),
    changeFieldType: (actor, code, fieldCode, type, opts = {}) =>
      editDestructive(
        actor,
        "catalog.changeType",
        code,
        ["struct"] as const,
        { kind: "field", code, fieldCode },
        opts,
        (def, ctx) => changeFieldType(def, fieldCode, type, ctx.findEnum),
      ),
    removeField: (actor, code, fieldCode, opts = {}) =>
      editDestructive(
        actor,
        "catalog.deleteField",
        code,
        ["struct"] as const,
        { kind: "field", code, fieldCode },
        opts,
        (def) => removeField(def, fieldCode),
      ),

    remove: (actor, code, opts = {}) =>
      db.transaction(async (tx) => {
        let loaded: Discriminator | undefined;
        const target: ImpactTarget = { kind: "discriminator", code };
        return destructive<void>({
          actor,
          action: "catalog.delete",
          confirm: opts.confirm,
          precheck: async () => {
            loaded = await repo.loadDiscriminator(tx, code);
            return loaded ? ok(undefined) : notFound(`구분자 ${code}`);
          },
          computeImpact: () => computeImpact(target, impact, { cascade: cascadeOf(loaded!) }),
          execute: async () => {
            await repo.deleteDiscriminator(tx, code);
            await impact.purgeValueRows(target);
            return ok(undefined);
          },
        });
      }),

    createEnum: (actor, input) =>
      db.transaction(async (tx) => {
        const r = await createEnum(input, await context(tx));
        if (!r.ok) return r;
        await repo.insertEnum(tx, r.value, actor.userId);
        return r;
      }),
    renameEnum: (actor, code, label) => editEnum(actor, code, (def, ctx) => renameEnum(def, label, ctx.existingEnumLabels ?? [])),
    addEnumValue: (actor, code, input) => editEnum(actor, code, (def, ctx) => addEnumValue(def, input, ctx.nextSeq)),
    renameEnumValue: (actor, code, valueCode, label) => editEnum(actor, code, (def) => renameEnumValue(def, valueCode, label)),
    reorderEnumValues: (actor, code, order) => editEnum(actor, code, (def) => reorderEnumValues(def, order)),

    removeEnumValue: (actor, code, valueCode, opts = {}) =>
      db.transaction(async (tx) => {
        let changed: Result<EnumDef> | undefined;
        const target: ImpactTarget = { kind: "enumValue", enumCode: code, valueCode };
        return destructive<EnumDef>({
          actor,
          action: "enum.deleteValue",
          confirm: opts.confirm,
          precheck: () =>
            withEnum(tx, code, (def) => {
              changed = removeEnumValue(def, valueCode);
              return changed.ok ? ok(undefined) : (changed as Result<void>);
            }),
          computeImpact: () => computeImpact(target, impact),
          execute: async () => {
            if (!changed?.ok) throw new Error("precheck 없이 execute 호출");
            await repo.saveEnum(tx, changed.value, actor.userId);
            await impact.purgeValueRows(target);
            return changed;
          },
        });
      }),

    removeEnum: (actor, code, opts = {}) =>
      db.transaction(async (tx) => {
        let loaded: EnumDef | undefined;
        const target: ImpactTarget = { kind: "enum", enumCode: code };
        return destructive<void>({
          actor,
          action: "enum.delete",
          confirm: opts.confirm,
          precheck: async () => {
            loaded = await repo.loadEnum(tx, code);
            return loaded ? ok(undefined) : notFound(`enum ${code}`);
          },
          computeImpact: async () =>
            computeImpact(target, impact, {
              cascade: cascadeOf(loaded!),
              brokenRefs: enumReferences(code, await repo.listDiscriminators(tx)),
            }),
          execute: async () => {
            await repo.deleteEnum(tx, code);
            await impact.purgeValueRows(target);
            return ok(undefined);
          },
        });
      }),
  };
}
