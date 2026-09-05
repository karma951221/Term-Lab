/**
 * 공용조항 서비스 — 모든 쓰기의 진입점. actor 검사 · 도메인 규칙 · repo 호출.
 *
 * - 비파괴 액션(채번 · 표시명 · 설명 · 본문 · 모드 · 옵션 추가/수정/삭제 · 순서 · 복제)은 editor 도 가능.
 *   본문·옵션이 바뀌는 저장은 ① 요구 구분자 재추출 ② 사용처 전부 재검사 → `{ clause, recheck }` 를 돌려준다.
 *   저장 자체는 미부착이 생겨도 차단하지 않는다 (D-P3-8).
 * - 파괴적 액션은 `clause.delete` 하나 — `destructive()` 2단: editor → forbidden ·
 *   admin 1차 → needsConfirmation(Impact: brokenRefs = 사용처) · `{ confirm: true }` → 삭제.
 *   (옵션·선택지 삭제는 정의 수정으로 두고 깨진 선택은 재검사 목록이 드러낸다 — ADR-0017 §5.)
 * - 사용처 역인덱스(`UsageSource`)는 C1/B3 몫, 부착 실행(`Attacher`)은 B1 몫 — 주입한다.
 *   기본값: 사용처 없음 · 부착기 없음(수락 거부).
 * - 카탈로그(구분자 정의)는 catalog repo 에서 읽어 조건식 타입 검사·부착 검사에 쓴다.
 */
import { destructive } from "@/domain/auth";
import { slotType } from "@/domain/catalog/values";
import type { Discriminator } from "@/domain/catalog/types";
import {
  addOption,
  addOptionValue,
  checkAttachmentForReference,
  createClause,
  duplicateClause,
  lookupFrom,
  recheckUsages,
  removeOption,
  removeOptionValue,
  renameClause,
  renameOption,
  renameOptionValue,
  reorderOptions,
  reorderOptionValues,
  setBody,
  setClauseDescription,
  setMode,
  setOptionValueBody,
  usageCoordinate,
  type AttachmentCheck,
  type Clause,
  type ClauseBody,
  type ClauseContext,
  type ClauseMode,
  type ClauseSummary,
  type DiscriminatorLookup,
  type NewClause,
  type NewOption,
  type NewOptionValue,
  type RecheckEntry,
  type RequiredRefs,
  type Usage,
} from "@/domain/clause";
import type { Inline } from "@/domain/clause/nodes";
import { checkTypes, parse, type TypeResolver } from "@/domain/expression";
import type { Actor, Code, Id, Result } from "@/domain/types";
import { ok, reject } from "@/domain/types";

import { listDiscriminators } from "@/db/repo/catalog";
import * as repo from "@/db/repo/clause";
import type { Db } from "@/db/repo/types";
import { listAttached, listOwnersAttaching, type ValueOwner } from "@/db/repo/values";

// ───────────────────────────── 주입 인터페이스 ─────────────────────────────

/** 사용처 역인덱스 — 이 공용조항을 참조하는 문서들. C1(refs)/B3(document) 가 구현한다. */
export interface UsageSource {
  documentsReferencing(clauseCode: Code): Promise<Usage[]>;
}

/** 부착 제안 수락 시 실제 부착 — B1(coverage) 서비스의 attach 로 연결한다. */
export interface Attacher {
  attach(actor: Actor, owner: ValueOwner, discriminatorCode: Code): Promise<Result<void>>;
}

export const NO_USAGES: UsageSource = { documentsReferencing: async () => [] };

/** 부착기가 연결되지 않은 기본값 — 수락은 거부된다. */
export const NO_ATTACHER: Attacher = {
  attach: async (_actor, owner, code) =>
    reject({
      reason: "invalid",
      issues: [{ kind: "notAttached", message: `부착 서비스가 연결되지 않아 ${code} 을(를) 부착할 수 없습니다`, at: { ownerId: owner.id, refPath: code } }],
    }),
};

export interface ClauseServiceDeps {
  usage?: UsageSource;
  attacher?: Attacher;
}

export interface Confirmable {
  confirm?: boolean;
}

/** 본문·옵션이 바뀌는 저장의 결과 — 저장된 정의 + 사용처 재검사 목록. */
export interface SaveOutcome {
  clause: Clause;
  recheck: RecheckEntry[];
}

export interface ClauseService {
  // 조회
  get(code: Code): Promise<Clause | undefined>;
  list(): Promise<Clause[]>;
  summaries(): Promise<ClauseSummary[]>;
  required(code: Code): Promise<RequiredRefs | undefined>;
  usages(code: Code): Promise<Usage[]>;
  audit(code: Code): ReturnType<typeof repo.clauseAudit>;

  // 정의 — 비파괴
  create(actor: Actor, input: NewClause): Promise<Result<Clause>>;
  rename(actor: Actor, code: Code, label: string): Promise<Result<Clause>>;
  setDescription(actor: Actor, code: Code, description: string): Promise<Result<Clause>>;
  setBody(actor: Actor, code: Code, body: ClauseBody): Promise<Result<SaveOutcome>>;
  setMode(actor: Actor, code: Code, mode: ClauseMode, body: ClauseBody): Promise<Result<SaveOutcome>>;
  duplicate(actor: Actor, code: Code): Promise<Result<Clause>>;

  // 옵션 — 비파괴 (선택지·옵션 삭제의 사용처 영향은 recheck 로)
  addOption(actor: Actor, code: Code, input: NewOption): Promise<Result<SaveOutcome>>;
  renameOption(actor: Actor, code: Code, optionCode: Code, label: string): Promise<Result<Clause>>;
  addOptionValue(actor: Actor, code: Code, optionCode: Code, input: NewOptionValue): Promise<Result<SaveOutcome>>;
  renameOptionValue(actor: Actor, code: Code, optionCode: Code, valueCode: Code, label: string): Promise<Result<Clause>>;
  setOptionValueBody(actor: Actor, code: Code, optionCode: Code, valueCode: Code, body: Inline[]): Promise<Result<SaveOutcome>>;
  reorderOptions(actor: Actor, code: Code, order: Code[]): Promise<Result<Clause>>;
  reorderOptionValues(actor: Actor, code: Code, optionCode: Code, order: Code[]): Promise<Result<Clause>>;
  removeOptionValue(actor: Actor, code: Code, optionCode: Code, valueCode: Code): Promise<Result<SaveOutcome>>;
  removeOption(actor: Actor, code: Code, optionCode: Code): Promise<Result<SaveOutcome>>;

  // 파괴적 (admin · 2단)
  remove(actor: Actor, code: Code, opts?: Confirmable): Promise<Result<void>>;

  // 참조 쪽
  /** 사용처(담보)가 참조를 추가하려는 순간의 부착 검사 — 미부착 목록(부착 제안). */
  checkReference(code: Code, owner: ValueOwner): Promise<Result<AttachmentCheck>>;
  /** 부착 제안 수락 — 미부착 요구 구분자를 Attacher 로 부착. 부착한 코드 목록. */
  acceptAttachments(actor: Actor, code: Code, owner: ValueOwner): Promise<Result<Code[]>>;
  /** 정의 수정 후 사용처 전부 재검사 — 문제 있는 사용처만. */
  recheck(code: Code): Promise<Result<RecheckEntry[]>>;
}

// ───────────────────────────── 카탈로그 타입 조회 ─────────────────────────────

/** 카탈로그 정의로 만드는 식 타입 조회 — 조건식 boolean 검사용. */
function typeResolverFrom(lookup: DiscriminatorLookup): TypeResolver {
  const resolve: TypeResolver = (ref) => {
    switch (ref.kind) {
      case "attr":
        return { kind: "attribute" };
      case "builtin":
        return { kind: "string" }; // 뼈대 속성(이름) — MVP 는 문자열
      case "discriminator": {
        const def: Discriminator | undefined = lookup(ref.code);
        if (!def) return undefined;
        if (def.kind === "const") return ref.field ? undefined : { kind: "string" };
        if (def.kind === "derived") {
          if (ref.field) return undefined;
          const parsed = parse(def.expression);
          if (!parsed.ok) return undefined;
          const t = checkTypes(parsed.value, resolve);
          return t.ok ? t.value : undefined;
        }
        return slotType(def, ref.field ? `${ref.code}.${ref.field}` : ref.code);
      }
    }
  };
  return resolve;
}

// ───────────────────────────── 서비스 ─────────────────────────────

export function createClauseService(db: Db, deps: ClauseServiceDeps = {}): ClauseService {
  const usage = deps.usage ?? NO_USAGES;
  const attacher = deps.attacher ?? NO_ATTACHER;

  async function lookupOf(tx: Db): Promise<DiscriminatorLookup> {
    return lookupFrom(await listDiscriminators(tx));
  }

  async function context(tx: Db, lookup?: DiscriminatorLookup): Promise<ClauseContext> {
    const lk = lookup ?? (await lookupOf(tx));
    const existing = (await repo.listClauses(tx)).map((c) => ({ code: c.code, label: c.label }));
    return { nextSeq: repo.clauseSeqSource(tx), existing, analyze: { resolveType: typeResolverFrom(lk) } };
  }

  function notFound<T>(code: Code): Result<T> {
    return reject({ reason: "notFound", what: `공용조항 ${code}` });
  }

  async function withClause<T>(tx: Db, code: Code, fn: (def: Clause) => Promise<Result<T>> | Result<T>): Promise<Result<T>> {
    const def = await repo.loadClause(tx, code);
    if (!def) return notFound(code);
    return fn(def);
  }

  /** 사용처 재검사 — 담보 사용처의 부착은 listOwnersAttaching 으로, 보통약관은 건너뛴다. */
  async function recheckOf(tx: Db, clause: Clause, lookup: DiscriminatorLookup): Promise<RecheckEntry[]> {
    const usages = await usage.documentsReferencing(clause.code);
    if (usages.length === 0) return [];
    const attachedBy = new Map<Id, Set<Code>>();
    for (const code of clause.required.discriminators) {
      for (const owner of await listOwnersAttaching(tx, code)) {
        const set = attachedBy.get(owner.id) ?? new Set<Code>();
        set.add(code);
        attachedBy.set(owner.id, set);
      }
    }
    return recheckUsages(clause, usages, lookup, (ownerId) => attachedBy.get(ownerId) ?? new Set());
  }

  /** 비파괴 변경 (본문·옵션 무관) — 읽기 → 도메인 → 저장. */
  function edit(actor: Actor, code: Code, change: (def: Clause, ctx: ClauseContext) => Promise<Result<Clause>> | Result<Clause>): Promise<Result<Clause>> {
    return db.transaction((tx) =>
      withClause(tx, code, async (def) => {
        const r = await change(def, await context(tx));
        if (!r.ok) return r;
        await repo.saveClause(tx, r.value, actor.userId);
        return r;
      }),
    );
  }

  /**
   * 본문·옵션이 바뀌는 변경 — 저장(트랜잭션) 후 사용처 재검사.
   * 재검사는 주입된 UsageSource 를 부르므로 트랜잭션 **밖**에서 한다 (같은 연결을 다시 잡으면 막힌다).
   */
  async function editAndRecheck(
    actor: Actor,
    code: Code,
    change: (def: Clause, ctx: ClauseContext) => Promise<Result<Clause>> | Result<Clause>,
  ): Promise<Result<SaveOutcome>> {
    let lookup: DiscriminatorLookup | undefined;
    const saved = await db.transaction((tx) =>
      withClause<Clause>(tx, code, async (def) => {
        lookup = await lookupOf(tx);
        const r = await change(def, await context(tx, lookup));
        if (!r.ok) return r;
        await repo.saveClause(tx, r.value, actor.userId);
        return r;
      }),
    );
    if (!saved.ok) return saved as Result<SaveOutcome>;
    return ok({ clause: saved.value, recheck: await recheckOf(db, saved.value, lookup!) });
  }

  return {
    get: (code) => repo.loadClause(db, code),
    list: () => repo.listClauses(db),
    summaries: async () => {
      const all = await repo.listClauses(db);
      const out: ClauseSummary[] = [];
      for (const c of all) {
        out.push({ code: c.code, label: c.label, mode: c.mode, usageCount: (await usage.documentsReferencing(c.code)).length });
      }
      return out;
    },
    required: async (code) => (await repo.loadClause(db, code))?.required,
    usages: (code) => usage.documentsReferencing(code),
    audit: (code) => repo.clauseAudit(db, code),

    create: (actor, input) =>
      db.transaction(async (tx) => {
        const r = await createClause(input, await context(tx));
        if (!r.ok) return r;
        await repo.insertClause(tx, r.value, actor.userId);
        return r;
      }),
    rename: (actor, code, label) => edit(actor, code, (def, ctx) => renameClause(def, label, ctx.existing)),
    setDescription: (actor, code, description) => edit(actor, code, (def) => setClauseDescription(def, description)),
    setBody: (actor, code, body) => editAndRecheck(actor, code, (def, ctx) => setBody(def, body, ctx.analyze)),
    setMode: (actor, code, mode, body) => editAndRecheck(actor, code, (def, ctx) => setMode(def, mode, body, ctx.analyze)),
    duplicate: (actor, code) =>
      db.transaction((tx) =>
        withClause(tx, code, async (def) => {
          const r = await duplicateClause(def, await context(tx));
          if (!r.ok) return r;
          await repo.insertClause(tx, r.value, actor.userId);
          return r;
        }),
      ),

    addOption: (actor, code, input) => editAndRecheck(actor, code, (def, ctx) => addOption(def, input, ctx)),
    renameOption: (actor, code, optionCode, label) => edit(actor, code, (def) => renameOption(def, optionCode, label)),
    addOptionValue: (actor, code, optionCode, input) => editAndRecheck(actor, code, (def, ctx) => addOptionValue(def, optionCode, input, ctx)),
    renameOptionValue: (actor, code, optionCode, valueCode, label) =>
      edit(actor, code, (def) => renameOptionValue(def, optionCode, valueCode, label)),
    setOptionValueBody: (actor, code, optionCode, valueCode, body) =>
      editAndRecheck(actor, code, (def, ctx) => setOptionValueBody(def, optionCode, valueCode, body, ctx.analyze)),
    reorderOptions: (actor, code, order) => edit(actor, code, (def) => reorderOptions(def, order)),
    reorderOptionValues: (actor, code, optionCode, order) => edit(actor, code, (def) => reorderOptionValues(def, optionCode, order)),
    removeOptionValue: (actor, code, optionCode, valueCode) =>
      editAndRecheck(actor, code, (def, ctx) => removeOptionValue(def, optionCode, valueCode, ctx.analyze)),
    removeOption: (actor, code, optionCode) => editAndRecheck(actor, code, (def, ctx) => removeOption(def, optionCode, ctx.analyze)),

    remove: async (actor, code, opts = {}) => {
      // 사용처는 주입 소스가 자기 저장소를 볼 수 있어 트랜잭션 밖에서 미리 읽는다.
      const referencing = opts.confirm ? [] : await usage.documentsReferencing(code);
      return db.transaction(async (tx) => {
        let loaded: Clause | undefined;
        return destructive<void>({
          actor,
          action: "clause.delete",
          confirm: opts.confirm,
          precheck: async () => {
            loaded = await repo.loadClause(tx, code);
            return loaded ? ok(undefined) : notFound(code);
          },
          computeImpact: () => ({
            valueRowsLost: 0,
            brokenRefs: referencing.map(usageCoordinate),
            cascade: loaded!.options.map((o) => `옵션 ${o.label}(${o.code})`),
          }),
          execute: async () => {
            await repo.deleteClause(tx, code);
            return ok(undefined);
          },
        });
      });
    },

    checkReference: (code, owner) =>
      withClause(db, code, async (def) => {
        const attached = new Set(await listAttached(db, owner));
        return ok(checkAttachmentForReference(def, attached, await lookupOf(db), { ownerId: owner.id }));
      }),

    // 부착은 Attacher(B1 서비스)가 자기 트랜잭션으로 한다 — 여기서 트랜잭션을 열지 않는다.
    acceptAttachments: (actor, code, owner) =>
      withClause<Code[]>(db, code, async (def) => {
        const attached = new Set(await listAttached(db, owner));
        const check = checkAttachmentForReference(def, attached, await lookupOf(db), { ownerId: owner.id });
        if (check.broken.length > 0) {
          return reject({ reason: "invalid", issues: check.issues.filter((i) => i.kind === "brokenRef") });
        }
        const done: Code[] = [];
        for (const c of check.missing) {
          const r = await attacher.attach(actor, owner, c);
          if (!r.ok) return r as Result<Code[]>;
          done.push(c);
        }
        return ok(done);
      }),

    recheck: (code) => withClause(db, code, async (def) => ok(await recheckOf(db, def, await lookupOf(db)))),
  };
}
