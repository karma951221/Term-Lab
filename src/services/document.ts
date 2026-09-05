/**
 * 문면 서비스 — 모든 쓰기의 진입점. actor 검사 · 도메인 규칙 · repo 호출 (한 트랜잭션).
 *
 * - 문서 생성(담보약관 · 보통약관 마스터) · 조회 · 목록 · 제목 · 대응 보통약관 지정(D-P4-5) ·
 *   트리 커맨드 적용(저장 시 `validateTree` + `validateExpressions`) · 복제(D-P4-4·9) · 사전평가(문맥 주입) · 별표 CRUD.
 * - 파괴적 액션(문서 삭제 `document.delete` · 별표 삭제 `appendix.delete`)은 `destructive()` 2단 프로토콜.
 *   영향의 「깨질 참조」 = 사용처 — 기본은 이 DB 의 문서들을 훑어 계산하고, 상품이 보통약관을 선택하는 사용처 등
 *   다른 영역(B4 · C1)의 것은 `UsageSource` 로 주입해 합친다.
 * - 공용조항 게이트(`ClauseGate`)는 B2 가, 담보 마스터 평가 문맥(`EvalContext`)은 B1 이 만든다 — 여기서는 주입만 받는다.
 * - 타입 조회(`TypeResolver`)는 기본으로 카탈로그 정의에서 만든다. 담보속성(attr.X)의 유효값은 B4 몫이라
 *   기본 조회는 「담보속성 타입(유효값 모름)」으로만 답한다 — 정밀 검사는 `typeResolver` 주입.
 */
import { destructive } from "@/domain/auth";
import type { Discriminator } from "@/domain/catalog";
import {
  applyCommands,
  cloneTree,
  collectRefs,
  createAppendix,
  numberTree,
  preEvaluate,
  renameAppendix,
  requiredDiscriminators,
  setAppendixDescription,
  validateExpressions,
  validateTree,
  type Appendix,
  type BranchEvaluation,
  type BranchState,
  type ClauseGate,
  type Command,
  type DocRef,
  type DocumentNode,
  type NewAppendix,
  type NodeNumber,
  type PreEvaluation,
  type TreeEnv,
} from "@/domain/document";
import { checkTypes, parse, type EvalContext, type ExprType, type TypeResolver } from "@/domain/expression";
import type { Actor, Code, Coordinate, Id, Impact, Issue, Result } from "@/domain/types";
import { ok, reject } from "@/domain/types";

import * as catalogRepo from "@/db/repo/catalog";
import * as repo from "@/db/repo/document";
import type { DocumentKind, DocumentRecord, DocumentSummary } from "@/db/repo/document";
import type { Db } from "@/db/repo/types";

export type { DocumentKind, DocumentRecord, DocumentSummary } from "@/db/repo/document";

/** 다른 영역이 아는 사용처 (상품의 보통약관 선택 등). 문서 안 참조는 서비스가 직접 훑는다. */
export interface UsageSource {
  documentUsages(tx: Db, documentId: Id): Promise<Coordinate[]>;
  appendixUsages(tx: Db, code: Code): Promise<Coordinate[]>;
}

export interface DocumentServiceDeps {
  /** 공용조항 게이트 (B2). 기본 전부 통과. */
  clauseGate?: (tx: Db) => Promise<ClauseGate>;
  /** 식 타입 조회. 기본 카탈로그 정의로 구성. */
  typeResolver?: (tx: Db) => Promise<TypeResolver>;
  /** 외부 사용처. 기본 없음. */
  usages?: UsageSource;
  /** 새 노드 id (복제용). 기본 uuid. */
  newId?: () => Id;
}

export interface Confirmable {
  confirm?: boolean;
}

export type DuplicateTarget = { coverageId: Id; title: string } | { title: string };

export interface DocumentService {
  // 조회
  get(id: Id): Promise<DocumentRecord | undefined>;
  findByCoverage(coverageId: Id): Promise<DocumentRecord | undefined>;
  list(kind?: DocumentKind): Promise<DocumentSummary[]>;
  validate(id: Id): Promise<Issue[]>;
  numbering(id: Id, branchStates?: ReadonlyMap<Id, BranchState | BranchEvaluation>): Promise<Map<Id, NodeNumber>>;
  refs(id: Id): Promise<DocRef[]>;
  requiredDiscriminators(id: Id): Promise<Code[]>;
  preEvaluate(id: Id, ctx: EvalContext): Promise<PreEvaluation>;
  documentUsages(id: Id): Promise<Coordinate[]>;

  // 문서 — 비파괴
  createSpecial(actor: Actor, coverageId: Id, title: string): Promise<Result<DocumentRecord>>;
  createGeneral(actor: Actor, title: string): Promise<Result<DocumentRecord>>;
  setTitle(actor: Actor, id: Id, title: string): Promise<Result<DocumentRecord>>;
  setGeneralDocument(actor: Actor, id: Id, generalDocumentId: Id | undefined): Promise<Result<DocumentRecord>>;
  apply(actor: Actor, id: Id, commands: readonly Command[]): Promise<Result<DocumentRecord>>;
  duplicate(actor: Actor, id: Id, target: DuplicateTarget): Promise<Result<DocumentRecord>>;
  // 문서 — 파괴적
  remove(actor: Actor, id: Id, opts?: Confirmable): Promise<Result<void>>;

  // 별표
  getAppendix(code: Code): Promise<Appendix | undefined>;
  listAppendices(): Promise<Appendix[]>;
  appendixUsages(code: Code): Promise<Coordinate[]>;
  createAppendix(actor: Actor, input: NewAppendix): Promise<Result<Appendix>>;
  renameAppendix(actor: Actor, code: Code, name: string): Promise<Result<Appendix>>;
  setAppendixDescription(actor: Actor, code: Code, description: string): Promise<Result<Appendix>>;
  removeAppendix(actor: Actor, code: Code, opts?: Confirmable): Promise<Result<void>>;
}

// ───────────────────────────── 타입 조회 (카탈로그 → TypeResolver) ─────────────────────────────

/** 카탈로그 정의로 식 타입 조회를 만든다. 파생은 식을 검사해 타입을 얻는다 (재귀 가드). */
export function catalogTypeResolver(defs: readonly Discriminator[]): TypeResolver {
  const byCode = new Map(defs.map((d) => [d.code, d]));
  const derivedCache = new Map<Code, ExprType | undefined>();
  const visiting = new Set<Code>();
  const resolve: TypeResolver = (ref) => {
    switch (ref.kind) {
      case "attr":
        return { kind: "attribute" };
      case "builtin":
        return { kind: "string" };
      case "discriminator": {
        const def = byCode.get(ref.code);
        if (!def) return undefined;
        switch (def.kind) {
          case "scalar":
            return ref.field === undefined ? def.type : undefined;
          case "struct":
            return ref.field === undefined ? undefined : def.fields.find((f) => f.code === ref.field)?.type;
          case "const":
            return ref.field === undefined ? { kind: "string" } : undefined;
          case "derived": {
            if (ref.field !== undefined) return undefined;
            if (derivedCache.has(def.code)) return derivedCache.get(def.code);
            if (visiting.has(def.code)) return undefined;
            visiting.add(def.code);
            const parsed = parse(def.expression);
            const t = parsed.ok ? checkTypes(parsed.value, resolve) : undefined;
            visiting.delete(def.code);
            const type = t?.ok ? t.value : undefined;
            derivedCache.set(def.code, type);
            return type;
          }
        }
      }
    }
  };
  return resolve;
}

// ───────────────────────────── 서비스 ─────────────────────────────

export function createDocumentService(db: Db, deps: DocumentServiceDeps = {}): DocumentService {
  const newId = deps.newId ?? (() => globalThis.crypto.randomUUID());

  function notFound<T>(what: string): Result<T> {
    return reject({ reason: "notFound", what });
  }
  function invalid<T>(issues: Issue[]): Result<T> {
    return reject({ reason: "invalid", issues });
  }
  function bad<T>(message: string, at: Coordinate = {}): Result<T> {
    return invalid([{ kind: "structure", message, at }]);
  }

  /** 문서 좌표 기본값 — special 은 담보 id, general 은 문서 id 가 소유 실체다. */
  function coordinateOf(doc: DocumentSummary): Coordinate {
    return { document: doc.kind, ownerId: doc.ownerId ?? doc.id, ownerName: doc.title };
  }

  async function withDoc<T>(tx: Db, id: Id, fn: (doc: DocumentRecord) => Promise<Result<T>> | Result<T>): Promise<Result<T>> {
    const doc = await repo.loadDocument(tx, id);
    return doc ? fn(doc) : notFound(`문서 ${id}`);
  }

  async function generalTitleTaken(tx: Db, title: string, exceptId?: Id): Promise<boolean> {
    const list = await repo.listDocuments(tx, "general");
    return list.some((d) => d.title === title && d.id !== exceptId);
  }

  /** 저장 검증 환경 — 대응 보통약관의 조 집합 · 별표 존재 · 공용조항 게이트 · 좌표. */
  async function envOf(tx: Db, doc: DocumentRecord): Promise<TreeEnv> {
    let generalArticleIds: ReadonlySet<Id> | undefined;
    if (doc.kind === "special") {
      const ids = new Set<Id>();
      if (doc.generalDocumentId) {
        const g = await repo.loadDocument(tx, doc.generalDocumentId);
        if (g) for (const c of g.tree.children) if (c.kind === "article") ids.add(c.id);
        // 조 자리 조건 블록 안의 조도 대상이 된다
        if (g) for (const c of g.tree.children) if (c.kind === "condBlock") collectArticleIds(c, ids);
      }
      generalArticleIds = ids;
    }
    const appendixCodes = new Set((await repo.listAppendices(tx)).map((a) => a.code));
    const clauseGate = deps.clauseGate ? await deps.clauseGate(tx) : undefined;
    return {
      kind: doc.kind,
      generalArticleIds,
      appendixExists: (c) => appendixCodes.has(c),
      ...(clauseGate ? { clauseGate } : {}),
      coordinate: coordinateOf(doc),
    };
  }

  async function resolverOf(tx: Db): Promise<TypeResolver> {
    if (deps.typeResolver) return deps.typeResolver(tx);
    return catalogTypeResolver(await catalogRepo.listDiscriminators(tx));
  }

  /** 저장 시점 전체 검증. */
  async function validateDoc(tx: Db, doc: DocumentRecord, tree: DocumentNode): Promise<Issue[]> {
    const env = await envOf(tx, doc);
    const issues = validateTree(tree, env);
    issues.push(...validateExpressions(tree, await resolverOf(tx), env.coordinate));
    return issues;
  }

  /** 이 DB 의 문서들 중 `documentId` 를 쓰는 곳 — 대응 보통약관 지정 · 조연결 · 보통약관 조 참조. */
  async function scanDocumentUsages(tx: Db, documentId: Id): Promise<Coordinate[]> {
    const target = await repo.loadDocument(tx, documentId);
    if (!target) return [];
    const articleIds = new Set<Id>();
    for (const c of target.tree.children) {
      if (c.kind === "article") articleIds.add(c.id);
      else collectArticleIds(c, articleIds);
    }
    const out: Coordinate[] = [];
    for (const d of await repo.listDocumentRecords(tx)) {
      if (d.id === documentId) continue;
      if (d.generalDocumentId === documentId) out.push({ ...coordinateOf(d) });
      for (const r of collectRefs(d.tree, coordinateOf(d))) {
        if (r.kind === "link" && articleIds.has(r.linkedArticleId)) out.push(r.at);
        else if (r.kind === "article" && r.scope === "general" && articleIds.has(r.articleId)) out.push(r.at);
      }
    }
    return out;
  }

  async function scanAppendixUsages(tx: Db, code: Code): Promise<Coordinate[]> {
    const out: Coordinate[] = [];
    for (const d of await repo.listDocumentRecords(tx)) {
      for (const r of collectRefs(d.tree, coordinateOf(d))) {
        if (r.kind === "appendix" && r.appendixCode === code) out.push(r.at);
      }
    }
    return out;
  }

  async function documentUsages(tx: Db, id: Id): Promise<Coordinate[]> {
    const own = await scanDocumentUsages(tx, id);
    const external = deps.usages ? await deps.usages.documentUsages(tx, id) : [];
    return [...own, ...external];
  }

  async function appendixUsages(tx: Db, code: Code): Promise<Coordinate[]> {
    const own = await scanAppendixUsages(tx, code);
    const external = deps.usages ? await deps.usages.appendixUsages(tx, code) : [];
    return [...own, ...external];
  }

  function emptyTree(title: string): DocumentNode {
    return { id: newId(), kind: "document", title, children: [] };
  }

  async function createDoc(tx: Db, actor: Actor, input: repo.NewDocumentRow): Promise<Result<DocumentRecord>> {
    return ok(await repo.insertDocument(tx, input, actor.userId));
  }

  async function editAppendix(actor: Actor, code: Code, change: (a: Appendix) => Result<Appendix>): Promise<Result<Appendix>> {
    return db.transaction(async (tx) => {
      const a = await repo.loadAppendix(tx, code);
      if (!a) return notFound(`별표 ${code}`);
      const r = change(a);
      if (!r.ok) return r;
      await repo.saveAppendix(tx, r.value, actor.userId);
      return r;
    });
  }

  return {
    get: (id) => repo.loadDocument(db, id),
    findByCoverage: (coverageId) => repo.findByOwner(db, coverageId),
    list: (kind) => repo.listDocuments(db, kind),

    validate: (id) =>
      db.transaction(async (tx) => {
        const doc = await repo.loadDocument(tx, id);
        return doc ? validateDoc(tx, doc, doc.tree) : [];
      }),

    numbering: async (id, branchStates) => {
      const doc = await repo.loadDocument(db, id);
      if (!doc) return new Map();
      const states = branchStates
        ? new Map([...branchStates].map(([k, v]) => [k, typeof v === "string" ? v : v.state] as [Id, BranchState]))
        : undefined;
      return numberTree(doc.tree, states ? { branchStates: states } : {});
    },

    refs: async (id) => {
      const doc = await repo.loadDocument(db, id);
      return doc ? collectRefs(doc.tree, coordinateOf(doc)) : [];
    },

    requiredDiscriminators: (id) =>
      db.transaction(async (tx) => {
        const doc = await repo.loadDocument(tx, id);
        if (!doc) return [];
        return requiredDiscriminators(doc.tree, deps.clauseGate ? await deps.clauseGate(tx) : undefined);
      }),

    preEvaluate: async (id, ctx) => {
      const doc = await repo.loadDocument(db, id);
      if (!doc) return { branches: new Map(), slots: new Map(), issues: [] };
      return preEvaluate(doc.tree, ctx, { coordinate: { ...coordinateOf(doc), ...(ctx.coordinate ?? {}) } });
    },

    documentUsages: (id) => db.transaction((tx) => documentUsages(tx, id)),

    createSpecial: (actor, coverageId, title) =>
      db.transaction(async (tx) => {
        if (await repo.findByOwner(tx, coverageId)) return reject({ reason: "duplicate", what: `담보 ${coverageId} 의 문면` });
        return createDoc(tx, actor, { kind: "special", ownerId: coverageId, title, tree: emptyTree(title) });
      }),

    createGeneral: (actor, title) =>
      db.transaction(async (tx) => {
        if (await generalTitleTaken(tx, title)) return reject({ reason: "duplicate", what: `보통약관 마스터 명 ${title}` });
        return createDoc(tx, actor, { kind: "general", title, tree: emptyTree(title) });
      }),

    setTitle: (actor, id, title) =>
      db.transaction((tx) =>
        withDoc(tx, id, async (doc) => {
          if (doc.kind === "general" && (await generalTitleTaken(tx, title, id))) {
            return reject({ reason: "duplicate", what: `보통약관 마스터 명 ${title}` });
          }
          const tree = { ...doc.tree, title };
          await repo.saveDocument(tx, id, { title, tree }, actor.userId);
          return ok({ ...doc, title, tree });
        }),
      ),

    setGeneralDocument: (actor, id, generalDocumentId) =>
      db.transaction((tx) =>
        withDoc(tx, id, async (doc) => {
          if (doc.kind !== "special") return bad("대응 보통약관은 담보약관에만 지정합니다 (D-P4-5)");
          if (generalDocumentId === undefined) {
            const remaining = collectRefs(doc.tree, coordinateOf(doc)).filter(
              (r) => r.kind === "link" || (r.kind === "article" && r.scope === "general"),
            );
            if (remaining.length > 0) {
              return invalid(remaining.map((r) => ({ kind: "brokenRef", message: "조연결 · 보통약관 조 참조가 남아 있어 해제할 수 없습니다", at: r.at })));
            }
          } else {
            const g = await repo.loadDocument(tx, generalDocumentId);
            if (!g) return notFound(`문서 ${generalDocumentId}`);
            if (g.kind !== "general") return bad("대응 보통약관은 보통약관 마스터여야 합니다");
          }
          await repo.saveDocument(tx, id, { generalDocumentId: generalDocumentId ?? null }, actor.userId);
          return ok((await repo.loadDocument(tx, id))!);
        }),
      ),

    apply: (actor, id, commands) =>
      db.transaction((tx) =>
        withDoc(tx, id, async (doc) => {
          const env = await envOf(tx, doc);
          const applied = applyCommands(doc.tree, commands, { env, newId });
          if (!applied.ok) return applied;
          const tree = applied.value;
          const issues = validateTree(tree, env);
          issues.push(...validateExpressions(tree, await resolverOf(tx), env.coordinate));
          if (issues.length > 0) return invalid(issues);
          await repo.saveDocument(tx, id, { tree, title: tree.title }, actor.userId);
          return ok((await repo.loadDocument(tx, id))!);
        }),
      ),

    duplicate: (actor, id, target) =>
      db.transaction((tx) =>
        withDoc(tx, id, async (doc) => {
          if ("coverageId" in target) {
            if (doc.kind !== "special") return bad("담보약관만 담보로 복제할 수 있습니다");
            if (await repo.findByOwner(tx, target.coverageId)) return reject({ reason: "duplicate", what: `담보 ${target.coverageId} 의 문면` });
            return createDoc(tx, actor, {
              kind: "special",
              ownerId: target.coverageId,
              title: target.title,
              generalDocumentId: doc.generalDocumentId,
              tree: cloneTree(doc.tree, newId, target.title),
            });
          }
          if (doc.kind !== "general") return bad("보통약관 마스터만 새 벌로 복제할 수 있습니다");
          if (await generalTitleTaken(tx, target.title)) return reject({ reason: "duplicate", what: `보통약관 마스터 명 ${target.title}` });
          return createDoc(tx, actor, { kind: "general", title: target.title, tree: cloneTree(doc.tree, newId, target.title) });
        }),
      ),

    remove: (actor, id, opts = {}) =>
      db.transaction(async (tx) => {
        let loaded: DocumentRecord | undefined;
        return destructive<void>({
          actor,
          action: "document.delete",
          confirm: opts.confirm,
          precheck: async () => {
            loaded = await repo.loadDocument(tx, id);
            return loaded ? ok(undefined) : notFound(`문서 ${id}`);
          },
          computeImpact: async (): Promise<Impact> => ({
            valueRowsLost: 0,
            brokenRefs: await documentUsages(tx, id),
            cascade: loaded!.tree.children.filter((c) => c.kind === "article").map((c) => `조 ${(c as { title: string }).title}`),
          }),
          execute: async () => {
            await repo.deleteDocument(tx, id);
            return ok(undefined);
          },
        });
      }),

    getAppendix: (code) => repo.loadAppendix(db, code),
    listAppendices: () => repo.listAppendices(db),
    appendixUsages: (code) => db.transaction((tx) => appendixUsages(tx, code)),

    createAppendix: (actor, input) =>
      db.transaction(async (tx) => {
        const existing = (await repo.listAppendices(tx)).map((a) => a.code);
        const r = createAppendix(input, existing);
        if (!r.ok) return r;
        await repo.insertAppendix(tx, r.value, actor.userId);
        return r;
      }),
    renameAppendix: (actor, code, name) => editAppendix(actor, code, (a) => renameAppendix(a, name)),
    setAppendixDescription: (actor, code, description) => editAppendix(actor, code, (a) => setAppendixDescription(a, description)),

    removeAppendix: (actor, code, opts = {}) =>
      db.transaction(async (tx) =>
        destructive<void>({
          actor,
          action: "appendix.delete",
          confirm: opts.confirm,
          precheck: async () => ((await repo.loadAppendix(tx, code)) ? ok(undefined) : notFound(`별표 ${code}`)),
          computeImpact: async (): Promise<Impact> => ({ valueRowsLost: 0, brokenRefs: await appendixUsages(tx, code), cascade: [] }),
          execute: async () => {
            await repo.deleteAppendix(tx, code);
            return ok(undefined);
          },
        }),
      ),
  };
}

/** 조건 블록(중첩 포함) 안의 조 id 를 모은다. */
function collectArticleIds(node: DocumentNode["children"][number], out: Set<Id>): void {
  if (node.kind === "article") {
    out.add(node.id);
    return;
  }
  for (const br of node.branches) {
    for (const c of br.children) {
      if (c.kind === "article" || c.kind === "condBlock") collectArticleIds(c, out);
    }
  }
}
