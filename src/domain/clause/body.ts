/**
 * 공용조항 본문 검사 · 식 수집 · 요구 구분자 추출 (순수).
 *
 * - `analyzeBody(mode, body, options)` : 허용 노드 규칙 검사 + 모든 식 파싱 + 요구 참조 추출.
 *   하나라도 어긋나면 `invalid` (저장 거부). 통과하면 `RequiredRefs`.
 * - 허용 규칙 (nodes.ts 머리말): inline 본문은 Inline 만 · block 본문은 paragraph/condBlock 만 ·
 *   조(article)·공용조항 참조(clause*Ref)·반복은 없다 · 인라인 조건 중첩 금지 · 블록 조건 중첩 허용 ·
 *   else 가지는 마지막에만 · 가지 없는 조건 불가 · 옵션 자리는 정의된 옵션만 · 노드 id 유일.
 * - 식 검사: `slot.ref` 는 참조 하나(경로)여야 하고, `when` 은 파싱한다. 참조 존재·boolean 여부는
 *   타입 조회(`resolveType`)가 있을 때만 검사한다 — 없으면 건너뛴다 (카탈로그 없이도 순수 검사가 되게).
 */
import { checkCondition, checkTypes, extractRefs, parse } from "../expression";
import type { Expr, TypeResolver } from "../expression";
import { ok, reject } from "../types";
import type { Code, Coordinate, Id, Issue, Result } from "../types";
import { BLOCK_KINDS, INLINE_KINDS } from "./nodes";
import type { Block, ClauseNode, Inline, InlineBranch, BlockBranch } from "./nodes";
import type { ClauseBody, ClauseMode, OptionDef, RequiredRefs } from "./types";

// ───────────────────────────── 식 수집 ─────────────────────────────

export interface CollectedExpression {
  /** 식 원문. */
  source: string;
  /** 쓰임 — 슬롯 치환 또는 조건. */
  role: "slot" | "condition";
  /** 루트에서 이 식이 달린 노드(가지 포함)까지의 id 경로. */
  nodePath: Id[];
}

/** 본문(Inline[] 또는 Block[])의 모든 식을 등장 순서대로. */
export function collectExpressions(body: ClauseBody, basePath: Id[] = []): CollectedExpression[] {
  const out: CollectedExpression[] = [];
  const walkInline = (node: Inline, path: Id[]) => {
    const here = [...path, node.id];
    if (node.kind === "slot") out.push({ source: node.ref, role: "slot", nodePath: here });
    if (node.kind === "inlineCond") {
      for (const br of node.branches) {
        const bp = [...here, br.id];
        if (br.when !== undefined) out.push({ source: br.when, role: "condition", nodePath: bp });
        for (const c of br.children) walkInline(c, bp);
      }
    }
  };
  const walkBlock = (node: Block, path: Id[]) => {
    const here = [...path, node.id];
    if (node.kind === "paragraph") {
      for (const c of node.children) walkInline(c, here);
      for (const it of node.items ?? []) {
        const ip = [...here, it.id];
        for (const c of it.children) walkInline(c, ip);
        for (const si of it.subitems ?? []) {
          const sp = [...ip, si.id];
          for (const c of si.children) walkInline(c, sp);
        }
      }
    } else {
      for (const br of node.branches) {
        const bp = [...here, br.id];
        if (br.when !== undefined) out.push({ source: br.when, role: "condition", nodePath: bp });
        for (const c of br.children) walkBlock(c, bp);
      }
    }
  };
  for (const n of body as ClauseNode[]) {
    if (isBlockKind(n.kind)) walkBlock(n as Block, basePath);
    else walkInline(n as Inline, basePath);
  }
  return out;
}

/** 본문의 모든 노드 id (가지 id 포함) — 등장 순. 검증을 거치지 않은 입력도 견딘다. */
export function allNodeIds(body: ClauseBody): Id[] {
  const ids: Id[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const n = node as { id?: Id; children?: unknown[]; items?: unknown[]; subitems?: unknown[]; branches?: unknown[] };
    if (typeof n.id === "string") ids.push(n.id);
    for (const key of ["children", "items", "subitems", "branches"] as const) {
      const list = n[key];
      if (Array.isArray(list)) for (const c of list) visit(c);
    }
  };
  for (const n of body) visit(n);
  return ids;
}

function isBlockKind(kind: string): boolean {
  return (BLOCK_KINDS as readonly string[]).includes(kind);
}

function isInlineKind(kind: string): boolean {
  return (INLINE_KINDS as readonly string[]).includes(kind);
}

// ───────────────────────────── 검사 ─────────────────────────────

export interface AnalyzeOptions {
  /** 오류 좌표의 기본값 (공용조항 코드 등). nodePath 는 검사기가 얹는다. */
  coordinate?: Coordinate;
  /** 참조 타입 조회 — 있으면 조건식이 boolean 인지까지 검사한다. */
  resolveType?: TypeResolver;
}

/** 공용조항 참조 노드 종류 — 본문 안에 나타나면 중첩이라 거부. */
const CLAUSE_REF_KINDS = new Set(["clauseInlineRef", "clauseBlockRef"]);

/**
 * 본문 + 옵션 선택지 본문을 한꺼번에 검사하고 요구 참조를 추출한다.
 * 옵션 선택지 본문은 인라인 규칙으로 검사한다 (옵션은 문구 수준 대안).
 */
export function analyzeBody(
  mode: ClauseMode,
  body: ClauseBody,
  options: readonly OptionDef[],
  opts: AnalyzeOptions = {},
): Result<RequiredRefs> {
  const issues: Issue[] = [];
  const base = opts.coordinate ?? {};
  const optionCodes = new Set(options.map((o) => o.code));
  const exprs: { expr: Expr; role: "slot" | "condition"; path: Id[] }[] = [];

  const report = (kind: Issue["kind"], message: string, path: Id[], refPath?: string) => {
    issues.push({ kind, message, at: { ...base, nodePath: path, ...(refPath ? { refPath } : {}) } });
  };

  const kindError = (node: { id?: Id; kind?: string }, path: Id[], expected: string) => {
    const kind = String(node.kind);
    const why = CLAUSE_REF_KINDS.has(kind)
      ? "공용조항 안에 공용조항 참조를 둘 수 없습니다 (중첩 금지)"
      : kind === "article"
        ? "조(article)는 항상 사용처 소유입니다 — 공용조항 본문에 둘 수 없습니다"
        : `${expected} 자리에 올 수 없는 노드입니다: ${kind}`;
    report("typeMismatch", why, [...path, String(node.id ?? "?")]);
  };

  const checkExpr = (source: string, role: "slot" | "condition", path: Id[]) => {
    const parsed = parse(source, { ...base, nodePath: path });
    if (!parsed.ok) {
      if (parsed.rejection.reason === "invalid") issues.push(...parsed.rejection.issues);
      return;
    }
    if (role === "slot" && parsed.value.kind !== "ref") {
      report("typeMismatch", `슬롯의 참조는 경로 하나여야 합니다: ${source}`, path, source);
      return;
    }
    exprs.push({ expr: parsed.value, role, path });
  };

  const checkBranches = (
    branches: (InlineBranch | BlockBranch)[],
    path: Id[],
    each: (br: InlineBranch | BlockBranch, bp: Id[]) => void,
  ) => {
    if (!Array.isArray(branches) || branches.length === 0) {
      report("typeMismatch", "조건에는 가지가 하나 이상 있어야 합니다", path);
      return;
    }
    branches.forEach((br, i) => {
      const bp = [...path, br.id];
      const isLast = i === branches.length - 1;
      if (br.when === undefined) {
        if (!isLast) report("typeMismatch", "else 가지는 마지막에만 올 수 있습니다", bp);
      } else {
        checkExpr(br.when, "condition", bp);
      }
      each(br, bp);
    });
  };

  const checkInline = (node: Inline, path: Id[], insideCond: boolean) => {
    const here = [...path, node.id];
    if (!isInlineKind(String(node.kind))) return kindError(node, path, "인라인");
    switch (node.kind) {
      case "text":
      case "articleRef":
      case "appendixRef":
        return;
      case "slot":
        return checkExpr(node.ref, "slot", here);
      case "optionSlot":
        if (!optionCodes.has(node.optionCode)) {
          report("brokenRef", `정의되지 않은 옵션입니다: ${node.optionCode}`, here, node.optionCode);
        }
        return;
      case "inlineCond":
        if (insideCond) {
          report("typeMismatch", "인라인 조건 안에 인라인 조건을 둘 수 없습니다 (중첩 금지)", here);
          return;
        }
        checkBranches(node.branches, here, (br, bp) => {
          for (const c of (br as InlineBranch).children ?? []) checkInline(c, bp, true);
        });
        return;
    }
  };

  const checkInlines = (list: Inline[], path: Id[]) => {
    for (const c of list ?? []) checkInline(c, path, false);
  };

  const checkBlock = (node: Block, path: Id[]) => {
    const here = [...path, node.id];
    if (!isBlockKind(String(node.kind))) return kindError(node, path, "블록(항)");
    if (node.kind === "paragraph") {
      checkInlines(node.children, here);
      for (const it of node.items ?? []) {
        const ip = [...here, it.id];
        if (it.kind !== "item") {
          kindError(it, here, "호");
          continue;
        }
        checkInlines(it.children, ip);
        for (const si of it.subitems ?? []) {
          if (si.kind !== "subitem") {
            kindError(si, ip, "목");
            continue;
          }
          checkInlines(si.children, [...ip, si.id]);
        }
      }
      return;
    }
    checkBranches(node.branches, here, (br, bp) => {
      for (const c of (br as BlockBranch).children ?? []) checkBlock(c, bp);
    });
  };

  // 1. 본문
  if (mode === "inline") checkInlines(body as Inline[], []);
  else for (const b of body as Block[]) checkBlock(b, []);

  // 2. 옵션 선택지 본문 — 인라인 규칙
  for (const o of options) {
    for (const v of o.values) checkInlines(v.body, [o.code, v.code]);
  }

  // 3. 노드 id 유일성 (본문 + 선택지 본문)
  const seen = new Set<Id>();
  const ids = [...allNodeIds(body), ...options.flatMap((o) => o.values.flatMap((v) => allNodeIds(v.body)))];
  for (const id of ids) {
    if (seen.has(id)) report("typeMismatch", `노드 id 가 중복됩니다: ${id}`, [id]);
    seen.add(id);
  }

  // 4. 참조 존재·타입 (조회가 있을 때만) — 조건은 boolean 이어야, 슬롯은 참조가 존재해야 한다
  if (opts.resolveType) {
    for (const e of exprs) {
      const at = { ...base, nodePath: e.path };
      const r = e.role === "condition" ? checkCondition(e.expr, opts.resolveType, at) : checkTypes(e.expr, opts.resolveType, { coordinate: at });
      if (!r.ok && r.rejection.reason === "invalid") issues.push(...r.rejection.issues);
    }
  }

  if (issues.length > 0) return reject({ reason: "invalid", issues });

  // 5. 요구 참조 추출
  const discriminators: Code[] = [];
  const attributes: Code[] = [];
  for (const e of exprs) {
    for (const { ref } of extractRefs(e.expr)) {
      if (ref.kind === "discriminator" && !discriminators.includes(ref.code)) discriminators.push(ref.code);
      if (ref.kind === "attr" && !attributes.includes(ref.code)) attributes.push(ref.code);
    }
  }
  return ok({ discriminators, attributes });
}
