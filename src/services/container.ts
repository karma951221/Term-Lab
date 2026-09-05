/**
 * 조립 루트 (composition root) — 모든 서비스를 실제 주입 구현으로 연결해 한 벌로 만든다.
 *
 * 연결 (2차구현_계획 §2 · 각 서비스 파일 머리말):
 * - catalog  ← ImpactSource = `catalogImpactSource` (값 저장소 + refs 그래프 역조회) · isAlias = expression 파서 기반
 * - coverage ← UsageSource = `coverageUsageSource` (부착 해제·노드 삭제의 문면 사용처)
 * - clause   ← UsageSource = `clauseUsageSource` (참조 문서) · Attacher = coverage.attach / product.attachProductDiscriminator
 * - document ← ClauseGate = 공용조항 정의(존재·요구 구분자·옵션 검증) · TypeResolver = 카탈로그 정의 + 담보속성 유효값 ·
 *              UsageSource = `documentUsageSource` (상품 템플릿 · 담보 문서 연결 · 옵션 오버라이드 · 공용조항의 별표 참조)
 * - product  ← CoverageMasterSource = coverage.get (구조적 상위집합) · GeneralDocumentGate = document.get 이 general 인가 ·
 *              GeneralAttachmentCheck = document.requiredDiscriminators + 카탈로그 레벨(파생은 식의 구분자로 펼침) ·
 *              OptionValidator = clause 정의의 validateOptionSelection · AttributeRefSource = `attributeRefSource`
 * - refs     ← 그래프 서비스 (관계정보 · 무결성)
 * - assembly 는 C2 가 완성한 뒤 오케스트레이터가 연결한다 (여기 없음).
 *
 * 트랜잭션: 서비스마다 자기 트랜잭션을 열고 주입 소스를 그 안에서 부른다. PGlite 는 단일 연결이라 소스가 바깥 핸들로
 * 쿼리하면 교착하므로, 모든 서비스·소스에 `contextualDb()` 프록시를 넘긴다 (txContext.ts) — 열린 tx 를 자동으로 탄다.
 *
 * 순환 의존(clause ↔ coverage · clause → product)은 지연 참조로 푼다 — 주입 객체가 호출 시점에 `services.*` 를 본다.
 */
import type { Discriminator } from "@/domain/catalog";
import { validateOptionSelection } from "@/domain/clause";
import type { ClauseGate } from "@/domain/document";
import { checkTypes, isAliasExpression, parse, requiredDiscriminatorCodes, type TypeResolver } from "@/domain/expression";
import type { RequiredCoverageRef } from "@/domain/product";
import type { Actor, Code, Id, Result } from "@/domain/types";
import { reject } from "@/domain/types";

import * as catalogRepo from "@/db/repo/catalog";
import * as clauseRepo from "@/db/repo/clause";
import * as productRepo from "@/db/repo/product";
import type { Db } from "@/db/repo/types";
import type { ValueOwner } from "@/db/repo/values";

import { createAuthService, type AuthService, type AuthServiceOptions } from "./auth";
import { createCatalogService, type CatalogService } from "./catalog";
import { createClauseService, type ClauseService } from "./clause";
import { createCoverageService, type CoverageService } from "./coverage";
import { catalogTypeResolver, createDocumentService, type DocumentService } from "./document";
import { createProductService, type ProductService } from "./product";
import { attributeRefSource, catalogImpactSource, clauseUsageSource, coverageUsageSource, createRefsService, documentUsageSource, type RefsService } from "./refs";
import { contextualDb } from "./txContext";

export interface Services {
  /** 문맥 인식 Db — 서버 액션이 직접 repo 를 읽을 일이 있으면 이것을 쓴다. */
  db: Db;
  auth: AuthService;
  catalog: CatalogService;
  coverage: CoverageService;
  clause: ClauseService;
  document: DocumentService;
  product: ProductService;
  refs: RefsService;
}

export interface ContainerOptions {
  /** 노드·트리 id 발급 (테스트용 결정적 id). 기본 uuid. */
  newId?: () => Id;
  auth?: AuthServiceOptions;
}

// ───────────────────────────── 주입 구현 ─────────────────────────────

/** 문서 검증용 공용조항 게이트 — 정의 존재 · 요구 구분자 · 옵션 선택 검증 (ADR-0010 · ADR-0017). */
async function clauseGateOf(tx: Db): Promise<ClauseGate> {
  const byCode = new Map((await clauseRepo.listClauses(tx)).map((c) => [c.code, c]));
  return {
    clauseExists: (code) => byCode.has(code),
    requiredCodes: (code) => byCode.get(code)?.required.discriminators ?? [],
    validateOptions: (code, options) => {
      const clause = byCode.get(code);
      return clause ? validateOptionSelection(clause, options) : [];
    },
  };
}

/** 식 타입 조회 — 카탈로그 정의 + 담보속성 카탈로그(`attr.X` 의 유효값). 없는 담보속성은 깨진 참조. */
async function typeResolverOf(tx: Db): Promise<TypeResolver> {
  const [defs, kinds] = await Promise.all([catalogRepo.listDiscriminators(tx), productRepo.listAttributeKinds(tx)]);
  const base = catalogTypeResolver(defs);
  const validValues = new Map(kinds.map((k) => [k.code, k.values.map((v) => v.code)]));
  return (ref) => {
    if (ref.kind !== "attr") return base(ref);
    const values = validValues.get(ref.code);
    return values ? { kind: "attribute", validValues: values } : undefined;
  };
}

/**
 * 보통약관이 요구하는 담보 레벨 참조 (ADR-0011) — 문서의 요구 구분자(공용조항 게이트 포함)를 카탈로그 레벨로 푼다.
 * 파생은 값 자리가 없으므로 그 식이 읽는 구분자로 펼친다 (MVP 는 다단 파생이 없다).
 */
function requiredCoverageRefs(codes: readonly Code[], defs: readonly Discriminator[], generalDocumentId: Id): RequiredCoverageRef[] {
  const byCode = new Map(defs.map((d) => [d.code, d]));
  const out: RequiredCoverageRef[] = [];
  const seen = new Set<Code>();
  const add = (code: Code, depth: number): void => {
    if (seen.has(code) || depth > 2) return;
    seen.add(code);
    const def = byCode.get(code);
    if (!def) return;
    if (def.kind === "derived") {
      const parsed = parse(def.expression);
      if (parsed.ok) for (const c of requiredDiscriminatorCodes(parsed.value)) add(c, depth + 1);
      return;
    }
    if (def.kind === "const") return;
    if (def.level === "coverage" || def.level === "subCoverage" || def.level === "benefit") {
      out.push({ level: def.level, discriminatorCode: code, at: { document: "general", ownerId: generalDocumentId, refPath: code } });
    }
  };
  for (const c of codes) add(c, 0);
  return out;
}

/** 별칭형 파생 판정 — 파서로 본다 (`(D0001)` 도 별칭). 문법이 깨진 식은 별칭이 아니다 (다른 검사 몫). */
function isAliasSource(expression: string): boolean {
  const parsed = parse(expression);
  return parsed.ok && isAliasExpression(parsed.value);
}

function isCoverageLevel(kind: ValueOwner["kind"]): kind is "coverage" | "subCoverage" | "benefit" {
  return kind === "coverage" || kind === "subCoverage" || kind === "benefit";
}

// ───────────────────────────── 조립 ─────────────────────────────

export function createServices(root: Db, opts: ContainerOptions = {}): Services {
  const db = contextualDb(root);
  const newId = opts.newId ?? (() => globalThis.crypto.randomUUID());
  // 지연 참조 — 주입 객체는 호출 시점에 services 를 본다 (clause ↔ coverage · clause → product).
  const services = {} as Services;

  const refs = createRefsService(db);
  const catalog = createCatalogService(db, { impact: catalogImpactSource(db), isAlias: isAliasSource });
  const coverage = createCoverageService(db, { usage: coverageUsageSource(db), newId });
  const clause = createClauseService(db, {
    usage: clauseUsageSource(db),
    attacher: {
      attach: (actor: Actor, owner: ValueOwner, code: Code): Promise<Result<void>> => {
        if (isCoverageLevel(owner.kind)) return services.coverage.attach(actor, { level: owner.kind, id: owner.id }, code);
        if (owner.kind === "product") return services.product.attachProductDiscriminator(actor, owner.id, code);
        return Promise.resolve(
          reject({
            reason: "invalid",
            issues: [{ kind: "notAttached", message: `${owner.kind} 실체에는 구분자를 부착할 수 없습니다: ${code}`, at: { ownerId: owner.id, refPath: code } }],
          }),
        );
      },
    },
  });
  const document = createDocumentService(db, { clauseGate: clauseGateOf, typeResolver: typeResolverOf, usages: documentUsageSource(), newId });
  const product = createProductService(db, {
    coverageMaster: { tree: (id) => services.coverage.get(id) },
    generalDocuments: { exists: async (id) => (await services.document.get(id))?.kind === "general" },
    generalAttachment: {
      requiredRefs: async (generalDocumentId) => {
        const [codes, defs] = [await services.document.requiredDiscriminators(generalDocumentId), await services.catalog.list()];
        return requiredCoverageRefs(codes, defs, generalDocumentId);
      },
    },
    optionValidator: {
      validate: async (clauseCode, options) => {
        const def = await services.clause.get(clauseCode);
        if (!def) return [{ kind: "brokenRef", message: `공용조항 ${clauseCode} 가 없습니다`, at: { refPath: clauseCode } }];
        return validateOptionSelection(def, options, { refPath: clauseCode });
      },
    },
    attributeRefs: attributeRefSource(db),
  });
  const auth = createAuthService(db, opts.auth);

  Object.assign(services, { db, auth, catalog, coverage, clause, document, product, refs });
  return services;
}

/** 파생식의 타입을 카탈로그로 검사한다 — 서버 액션이 파생 저장 전에 쓸 수 있는 보조 (카탈로그 서비스는 문법·타입을 보지 않는다). */
export async function checkDerivedExpression(db: Db, expression: string) {
  const parsed = parse(expression);
  if (!parsed.ok) return parsed;
  return checkTypes(parsed.value, await typeResolverOf(db));
}
