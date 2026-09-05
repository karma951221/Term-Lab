/**
 * 담보 서비스 — 담보 마스터 쓰기의 진입점. actor 검사 · 도메인 규칙 · repo 호출. 모든 쓰기는 한 트랜잭션.
 *
 * - 비파괴(담보 생성 · 이름/설명/문서 연결 · 세부보장/급부 추가 · 이름 · 순서 · 부착 · 값 쓰기/지우기)는 editor 도 가능.
 *   노드 추가는 이벤트 없이 단순 추가 — 기존 상품담보의 빈 값 대응은 상품(B4)이 스냅샷 실체를 트리와 맞출 때 한다.
 * - 파괴적(노드 삭제 `coverage.deleteNode` · 부착 해제 `coverage.detach`)은 `destructive()` 2단:
 *   editor → forbidden · admin 1차 → needsConfirmation(Impact) · `{ confirm: true }` → 실행 + 값 행 연쇄 삭제.
 *   최소 구조 위반은 precheck 에서 admin 도 거부.
 * - 사용처(문면 조건식·슬롯 · 요구 공용조항 · 파생식)는 `UsageSource` 로 주입 (C1 refs). 기본 NO_USAGE.
 * - 완결성의 실행 기반 필터는 `CompletenessFilter` 로 주입 (C2). 기본은 부착 기반 전체.
 */
import { destructive, type DestructiveAction } from "@/domain/auth";
import type { Discriminator, EnumLookup, SlotPath, ValuedDiscriminator } from "@/domain/catalog";
import {
  addBenefit,
  addSubCoverage,
  attachableDefinitions,
  attachedDefinitions,
  checkAttach,
  checkDetach,
  checkValueWrite,
  completeness,
  createCoverageTree,
  descendants,
  detachImpact,
  findBenefit,
  findNode,
  formPrefill,
  NO_USAGE,
  nodeDeleteImpact,
  removeBenefit,
  removeSubCoverage,
  renameBenefit,
  renameCoverage,
  renameSubCoverage,
  reorderBenefits,
  reorderSubCoverages,
  setCoverageDescription,
  setCoverageDocument,
  type CompletenessFilter,
  type Coverage,
  type CoverageNode,
  type CoverageNodeRef,
  type MasterValues,
  type MissingSlot,
  type NewCoverage,
  type NewId,
  type NewSubCoverage,
  type UsageSource,
} from "@/domain/coverage";
import { valueSlotsOf } from "@/domain/catalog";
import type { Actor, Code, Id, Impact, Result, Value, ValueSlot } from "@/domain/types";
import { ok, reject } from "@/domain/types";

import * as catalogRepo from "@/db/repo/catalog";
import * as repo from "@/db/repo/coverage";
import type { Db } from "@/db/repo/types";
import * as values from "@/db/repo/values";

export interface CoverageServiceDeps {
  /** 사용처 역인덱스 (C1). 기본 NO_USAGE — 사용처 없음. */
  usage?: UsageSource;
  /** 완결성 실행 기반 필터 (C2). 기본 항등. */
  completenessFilter?: CompletenessFilter;
  /** id 발급. 기본 crypto.randomUUID. */
  newId?: NewId;
}

/** 파괴적 액션의 2단 프로토콜 옵션. */
export interface Confirmable {
  confirm?: boolean;
}

/** 값 입력 폼 하나 — 정의 · 명시 값 · 프리필(명시 값 ∪ 기본값). */
export interface FormView {
  def: ValuedDiscriminator;
  slots: Record<SlotPath, ValueSlot>;
  prefill: Record<SlotPath, Value>;
}

export interface CoverageService {
  // 조회
  get(id: Id): Promise<Coverage | undefined>;
  list(): Promise<Coverage[]>;
  audit(id: Id): ReturnType<typeof repo.coverageAudit>;
  /** 실체의 부착 목록(무조건 노출 + 부착된 선택적 노출)을 폼으로. */
  forms(owner: CoverageNodeRef): Promise<Result<FormView[]>>;
  /** + 버튼 목록 — 그 레벨 선택적 노출 중 미부착분. */
  attachable(owner: CoverageNodeRef): Promise<Result<ValuedDiscriminator[]>>;
  /** 담보 하위 트리의 값·부착 전부 — masterEvalContext 의 입력. */
  masterValues(coverageId: Id): Promise<Result<{ tree: Coverage; values: MasterValues }>>;
  /** 완결성 조회 — 부착 기반 미입력 목록 (필터 주입 시 실행 기반). */
  completeness(coverageId: Id): Promise<Result<MissingSlot[]>>;

  // 담보 — 비파괴
  create(actor: Actor, input: NewCoverage): Promise<Result<Coverage>>;
  rename(actor: Actor, id: Id, name: string): Promise<Result<Coverage>>;
  setDescription(actor: Actor, id: Id, description: string): Promise<Result<Coverage>>;
  setDocument(actor: Actor, id: Id, documentId: Id | undefined): Promise<Result<Coverage>>;

  // 세부보장 · 급부 — 비파괴
  addSubCoverage(actor: Actor, coverageId: Id, input: NewSubCoverage): Promise<Result<Coverage>>;
  addBenefit(actor: Actor, subCoverageId: Id, name: string): Promise<Result<Coverage>>;
  renameSubCoverage(actor: Actor, subCoverageId: Id, name: string): Promise<Result<Coverage>>;
  renameBenefit(actor: Actor, benefitId: Id, name: string): Promise<Result<Coverage>>;
  reorderSubCoverages(actor: Actor, coverageId: Id, order: Id[]): Promise<Result<Coverage>>;
  reorderBenefits(actor: Actor, subCoverageId: Id, order: Id[]): Promise<Result<Coverage>>;

  // 구조 삭제 — 파괴적 (admin · 2단 · coverage.deleteNode)
  removeSubCoverage(actor: Actor, subCoverageId: Id, opts?: Confirmable): Promise<Result<Coverage>>;
  removeBenefit(actor: Actor, benefitId: Id, opts?: Confirmable): Promise<Result<Coverage>>;
  remove(actor: Actor, coverageId: Id, opts?: Confirmable): Promise<Result<void>>;

  // 부착 — 부착은 비파괴, 해제는 파괴적 (coverage.detach)
  attach(actor: Actor, owner: CoverageNodeRef, discriminatorCode: Code): Promise<Result<void>>;
  detach(actor: Actor, owner: CoverageNodeRef, discriminatorCode: Code, opts?: Confirmable): Promise<Result<void>>;

  // 값 — 비파괴 (미입력 ↔ 명시 값 상태 전이)
  writeValue(actor: Actor, owner: CoverageNodeRef, path: SlotPath, value: Value): Promise<Result<void>>;
  clearValue(actor: Actor, owner: CoverageNodeRef, path: SlotPath): Promise<Result<void>>;
}

export function createCoverageService(db: Db, deps: CoverageServiceDeps = {}): CoverageService {
  const usage = deps.usage ?? NO_USAGE;
  const filter = deps.completenessFilter;
  const newId: NewId = deps.newId ?? (() => crypto.randomUUID());

  // ───────── 공통 헬퍼 ─────────

  function notFound<T>(what: string): Result<T> {
    return reject({ reason: "notFound", what });
  }

  /** 트리 노드 지시자 → 값 저장소 소유자 (레벨 이름 = 소유자 종류). */
  function ownerOf(ref: CoverageNodeRef): values.ValueOwner {
    return { kind: ref.level, id: ref.id };
  }

  async function loadTree(tx: Db, coverageId: Id): Promise<Result<Coverage>> {
    const tree = await repo.loadCoverage(tx, coverageId);
    return tree ? ok(tree) : notFound(`담보 ${coverageId}`);
  }

  /** 노드 지시자 → (트리, 노드). 없으면 notFound. */
  async function loadNode(tx: Db, ref: CoverageNodeRef): Promise<Result<{ tree: Coverage; node: CoverageNode }>> {
    const coverageId = await repo.coverageIdOfNode(tx, ref);
    if (!coverageId) return notFound(`${ref.level} ${ref.id}`);
    const tree = await loadTree(tx, coverageId);
    if (!tree.ok) return tree as Result<never>;
    const node = findNode(tree.value, ref);
    return node ? ok({ tree: tree.value, node }) : notFound(`${ref.level} ${ref.id}`);
  }

  /** 담보 하위 트리 전 노드의 값·부착. */
  async function loadMasterValues(tx: Db, tree: Coverage): Promise<MasterValues> {
    const root: CoverageNodeRef = { level: "coverage", id: tree.id };
    const subs = descendants(tree, root, "subCoverage").map((n) => n.id);
    const bens = descendants(tree, root, "benefit").map((n) => n.id);
    const [cov, sub, ben] = await Promise.all([
      values.readSlotsMany(tx, "coverage", [tree.id]),
      values.readSlotsMany(tx, "subCoverage", subs),
      values.readSlotsMany(tx, "benefit", bens),
    ]);
    const slots = new Map<Id, ReadonlyMap<SlotPath, ValueSlot>>([...cov, ...sub, ...ben]);
    const attached = new Map<Id, ReadonlySet<Code>>();
    for (const [kind, ids] of [
      ["coverage", [tree.id]],
      ["subCoverage", subs],
      ["benefit", bens],
    ] as const) {
      for (const id of ids) attached.set(id, new Set(await values.listAttached(tx, { kind, id })));
    }
    return { slots, attached };
  }

  async function enumLookup(tx: Db): Promise<EnumLookup> {
    const enums = await catalogRepo.listEnums(tx);
    const byCode = new Map(enums.map((e) => [e.code, e]));
    return (c) => byCode.get(c);
  }

  async function loadDef(tx: Db, code: Code): Promise<Result<Discriminator>> {
    const def = await catalogRepo.loadDiscriminator(tx, code);
    return def ? ok(def) : notFound(`구분자 ${code}`);
  }

  /** 비파괴 트리 편집 — 읽기 → 도메인 → 저장, 한 트랜잭션. */
  function editTree(
    actor: Actor,
    ref: CoverageNodeRef,
    change: (tree: Coverage, tx: Db) => Promise<Result<Coverage>> | Result<Coverage>,
  ): Promise<Result<Coverage>> {
    return db.transaction(async (tx) => {
      const id = await repo.coverageIdOfNode(tx, ref);
      if (!id) return notFound(`${ref.level} ${ref.id}`);
      const loaded = await loadTree(tx, id);
      if (!loaded.ok) return loaded;
      const r = await change(loaded.value, tx);
      if (!r.ok) return r;
      await repo.saveCoverage(tx, r.value, actor.userId);
      return r;
    });
  }

  /** 담보 id 로 트리 편집. */
  function editCoverage(
    actor: Actor,
    coverageId: Id,
    change: (tree: Coverage, tx: Db) => Promise<Result<Coverage>> | Result<Coverage>,
  ): Promise<Result<Coverage>> {
    return editTree(actor, { level: "coverage", id: coverageId }, change);
  }

  /**
   * 노드 삭제(파괴적) — 트리 쪽 결과는 도메인이, 영향은 nodeDeleteImpact 가, 실행은 값 행 clearOwner + 저장.
   * 담보 자체 삭제는 `next` 가 없고 deleteCoverage 로 간다.
   */
  function deleteNode<T>(
    actor: Actor,
    ref: CoverageNodeRef,
    opts: Confirmable,
    change: (tree: Coverage) => Result<Coverage | undefined>,
    done: (next: Coverage | undefined) => T,
  ): Promise<Result<T>> {
    return db.transaction(async (tx) => {
      let tree: Coverage | undefined;
      let next: Coverage | undefined;
      return destructive<T>({
        actor,
        action: "coverage.deleteNode" satisfies DestructiveAction,
        confirm: opts.confirm,
        precheck: async () => {
          const loaded = await loadNode(tx, ref);
          if (!loaded.ok) return loaded as Result<void>;
          tree = loaded.value.tree;
          const changed = change(tree);
          if (!changed.ok) return changed as Result<void>;
          next = changed.value;
          return ok(undefined);
        },
        computeImpact: async (): Promise<Impact> => nodeDeleteImpact(tree!, ref, await loadMasterValues(tx, tree!), usage),
        execute: async () => {
          if (!tree) throw new Error("precheck 없이 execute 호출");
          const gone = ["coverage", "subCoverage", "benefit"] as const;
          for (const level of gone) {
            for (const n of descendants(tree, ref, level)) await values.clearOwner(tx, { kind: level, id: n.id });
          }
          if (next) await repo.saveCoverage(tx, next, actor.userId);
          else await repo.deleteCoverage(tx, tree.id);
          return ok(done(next));
        },
      });
    });
  }

  // ───────── 서비스 ─────────

  return {
    get: (id) => repo.loadCoverage(db, id),
    list: () => repo.listCoverages(db),
    audit: (id) => repo.coverageAudit(db, id),

    forms: async (owner) => {
      const loaded = await loadNode(db, owner);
      if (!loaded.ok) return loaded as Result<never>;
      const [defs, attached, slots] = await Promise.all([
        catalogRepo.listDiscriminators(db),
        values.listAttached(db, ownerOf(owner)),
        values.readSlots(db, ownerOf(owner)),
      ]);
      return ok(
        attachedDefinitions(owner.level, defs, new Set(attached)).map<FormView>((def) => ({
          def,
          slots: Object.fromEntries(valueSlotsOf(def).flatMap((p) => (slots.has(p) ? [[p, slots.get(p)!]] : []))),
          prefill: formPrefill(def, slots),
        })),
      );
    },

    attachable: async (owner) => {
      const loaded = await loadNode(db, owner);
      if (!loaded.ok) return loaded as Result<never>;
      const [defs, attached] = await Promise.all([catalogRepo.listDiscriminators(db), values.listAttached(db, ownerOf(owner))]);
      return ok(attachableDefinitions(owner.level, defs, new Set(attached)));
    },

    masterValues: async (coverageId) => {
      const tree = await loadTree(db, coverageId);
      if (!tree.ok) return tree as Result<never>;
      return ok({ tree: tree.value, values: await loadMasterValues(db, tree.value) });
    },

    completeness: async (coverageId) => {
      const tree = await loadTree(db, coverageId);
      if (!tree.ok) return tree as Result<never>;
      const [defs, mv] = await Promise.all([catalogRepo.listDiscriminators(db), loadMasterValues(db, tree.value)]);
      return ok(completeness(tree.value, defs, mv, filter));
    },

    create: (actor, input) =>
      db.transaction(async (tx) => {
        const r = createCoverageTree(input, newId, await repo.listCoverageNames(tx));
        if (!r.ok) return r;
        await repo.insertCoverage(tx, r.value, actor.userId);
        return r;
      }),
    rename: (actor, id, name) => editCoverage(actor, id, async (tree, tx) => renameCoverage(tree, name, await repo.listCoverageNames(tx))),
    setDescription: (actor, id, description) => editCoverage(actor, id, (tree) => setCoverageDescription(tree, description)),
    setDocument: (actor, id, documentId) => editCoverage(actor, id, (tree) => setCoverageDocument(tree, documentId)),

    addSubCoverage: (actor, coverageId, input) => editCoverage(actor, coverageId, (tree) => addSubCoverage(tree, input, newId)),
    addBenefit: (actor, subCoverageId, name) =>
      editTree(actor, { level: "subCoverage", id: subCoverageId }, (tree) => addBenefit(tree, subCoverageId, name, newId)),
    renameSubCoverage: (actor, subCoverageId, name) =>
      editTree(actor, { level: "subCoverage", id: subCoverageId }, (tree) => renameSubCoverage(tree, subCoverageId, name)),
    renameBenefit: (actor, benefitId, name) =>
      editTree(actor, { level: "benefit", id: benefitId }, (tree) => {
        const hit = findBenefit(tree, benefitId);
        return hit ? renameBenefit(tree, hit.subCoverage.id, benefitId, name) : notFound(`급부 ${benefitId}`);
      }),
    reorderSubCoverages: (actor, coverageId, order) => editCoverage(actor, coverageId, (tree) => reorderSubCoverages(tree, order)),
    reorderBenefits: (actor, subCoverageId, order) =>
      editTree(actor, { level: "subCoverage", id: subCoverageId }, (tree) => reorderBenefits(tree, subCoverageId, order)),

    removeSubCoverage: (actor, subCoverageId, opts = {}) =>
      deleteNode(actor, { level: "subCoverage", id: subCoverageId }, opts, (tree) => removeSubCoverage(tree, subCoverageId), (next) => next!),
    removeBenefit: (actor, benefitId, opts = {}) =>
      deleteNode(
        actor,
        { level: "benefit", id: benefitId },
        opts,
        (tree) => {
          const hit = findBenefit(tree, benefitId);
          return hit ? removeBenefit(tree, hit.subCoverage.id, benefitId) : notFound(`급부 ${benefitId}`);
        },
        (next) => next!,
      ),
    remove: (actor, coverageId, opts = {}) =>
      deleteNode(actor, { level: "coverage", id: coverageId }, opts, () => ok(undefined), () => undefined),

    attach: (actor, owner, code) =>
      db.transaction(async (tx) => {
        const loaded = await loadNode(tx, owner);
        if (!loaded.ok) return loaded as Result<never>;
        const def = await loadDef(tx, code);
        if (!def.ok) return def as Result<never>;
        const checked = checkAttach(def.value, owner.level, new Set(await values.listAttached(tx, ownerOf(owner))));
        if (!checked.ok) return checked as Result<never>;
        await values.attach(tx, ownerOf(owner), code, actor.userId);
        return ok(undefined);
      }),

    detach: (actor, owner, code, opts = {}) =>
      db.transaction(async (tx) => {
        let tree: Coverage | undefined;
        let def: ValuedDiscriminator | undefined;
        return destructive<void>({
          actor,
          action: "coverage.detach",
          confirm: opts.confirm,
          precheck: async () => {
            const loaded = await loadNode(tx, owner);
            if (!loaded.ok) return loaded as Result<void>;
            tree = loaded.value.tree;
            const d = await loadDef(tx, code);
            if (!d.ok) return d as Result<void>;
            const checked = checkDetach(d.value, owner.level, new Set(await values.listAttached(tx, ownerOf(owner))));
            if (!checked.ok) return checked as Result<void>;
            def = checked.value;
            return ok(undefined);
          },
          computeImpact: async () => detachImpact(tree!, owner, def!, await loadMasterValues(tx, tree!), usage),
          execute: async () => {
            if (!def) throw new Error("precheck 없이 execute 호출");
            await values.detach(tx, ownerOf(owner), code);
            for (const path of valueSlotsOf(def)) {
              const [, fieldCode] = path.split(".");
              await values.writeSlot(tx, ownerOf(owner), code, fieldCode || undefined, undefined, actor.userId);
            }
            return ok(undefined);
          },
        });
      }),

    writeValue: (actor, owner, path, value) =>
      db.transaction(async (tx) => {
        const loaded = await loadNode(tx, owner);
        if (!loaded.ok) return loaded as Result<never>;
        const def = await loadDef(tx, path.split(".")[0]);
        if (!def.ok) return def as Result<never>;
        const checked = checkValueWrite(def.value, path, value, owner, new Set(await values.listAttached(tx, ownerOf(owner))), await enumLookup(tx));
        if (!checked.ok) return checked as Result<never>;
        await values.writeSlot(tx, ownerOf(owner), checked.value.def.code, checked.value.fieldCode, value, actor.userId);
        return ok(undefined);
      }),

    clearValue: (actor, owner, path) =>
      db.transaction(async (tx) => {
        const loaded = await loadNode(tx, owner);
        if (!loaded.ok) return loaded as Result<never>;
        const [code, fieldCode] = path.split(".");
        await values.writeSlot(tx, ownerOf(owner), code, fieldCode || undefined, undefined, actor.userId);
        return ok(undefined);
      }),
  };
}
