/**
 * 공용조항 참조 — 사용처 쪽 규칙 (순수).
 *
 * - `checkAttachmentForReference` : 참조 추가 시 부착 검사 (ADR-0010 결정 4). 담보 문맥 —
 *   요구 구분자 중 「값 자리가 부착으로만 생기는 것」(scalar·struct · 담보 이하 레벨 · 선택적 노출)이
 *   부착돼 있지 않으면 미부착. 상품 레벨은 조립 때, const·파생·무조건 노출은 자리가 항상 있다.
 *   보통약관 사용처는 기본계약 지정 시점에 B4 가 같은 함수를 그 상품담보의 부착 집합으로 호출한다 (ADR-0011).
 * - `validateOptionSelection` · `resolveOptions` : 옵션 선택 검증 · 오버라이드 해소 (ADR-0017).
 * - `expandClause` : 인라인화 — 옵션 자리를 선택지 본문으로 치환한 노드 배열. 조건은 해소하지 않는다.
 * - `recheckUsages` : 정의 수정 후 사용처 전부 재검사 (ADR-0010 결정 5 · ADR-0017 §5).
 */
import type { Discriminator } from "../catalog/types";
import { ok, reject } from "../types";
import type { Code, Coordinate, Id, Issue, Result } from "../types";
import type { Block, BlockBranch, Inline, InlineBranch, ItemNode, SubitemNode } from "./nodes";
import type { Clause, ClauseBody, OptionSelection } from "./types";

// ───────────────────────────── 카탈로그 조회 ─────────────────────────────

/** 구분자 코드 → 정의. 없으면 undefined (깨진 참조). 카탈로그 서비스의 `get`/`list` 로 만든다. */
export type DiscriminatorLookup = (code: Code) => Discriminator | undefined;

export function lookupFrom(defs: readonly Discriminator[]): DiscriminatorLookup {
  const map = new Map(defs.map((d) => [d.code, d]));
  return (code) => map.get(code);
}

/** 담보 문맥에서 부착이 있어야 값 자리가 생기는 구분자인가. */
function needsCoverageAttachment(def: Discriminator): boolean {
  if (def.kind !== "scalar" && def.kind !== "struct") return false; // const·파생은 값 자리 없음
  if (def.alwaysExposed) return false; // 무조건 노출 = 전 실체 부착
  return def.level === "coverage" || def.level === "subCoverage" || def.level === "benefit";
}

// ───────────────────────────── 부착 검사 ─────────────────────────────

export interface AttachmentCheck {
  /** 미부착 요구 구분자 (부착 제안 대상). */
  missing: Code[];
  /** 카탈로그에 없는 요구 구분자 (깨진 참조). */
  broken: Code[];
  /** missing → notAttached · broken → brokenRef. */
  issues: Issue[];
}

/**
 * 담보 문맥의 부착 검사. `attachedCodes` 는 그 담보(트리)에 선택 부착된 구분자 코드 집합
 * (`listAttached` 결과 — 무조건 노출분은 정의에서 판단하므로 포함하지 않아도 된다).
 */
export function checkAttachmentForReference(
  clause: Clause,
  attachedCodes: ReadonlySet<Code>,
  lookup: DiscriminatorLookup,
  coordinate: Coordinate = {},
): AttachmentCheck {
  const missing: Code[] = [];
  const broken: Code[] = [];
  const issues: Issue[] = [];
  for (const code of clause.required.discriminators) {
    const def = lookup(code);
    if (!def) {
      broken.push(code);
      issues.push({ kind: "brokenRef", message: `공용조항 ${clause.code} 이(가) 읽는 구분자가 없습니다: ${code}`, at: { ...coordinate, refPath: code } });
      continue;
    }
    if (needsCoverageAttachment(def) && !attachedCodes.has(code)) {
      missing.push(code);
      issues.push({
        kind: "notAttached",
        message: `공용조항 ${clause.label}(${clause.code}) 의 요구 구분자 ${def.label}(${code}) 이(가) 부착돼 있지 않습니다`,
        at: { ...coordinate, refPath: code },
      });
    }
  }
  return { missing, broken, issues };
}

// ───────────────────────────── 옵션 선택 ─────────────────────────────

/** 미선택 → optionUnselected · 정의에 없는 옵션/선택지 → optionInvalid. 빈 배열이면 유효. */
export function validateOptionSelection(clause: Clause, selection: OptionSelection, coordinate: Coordinate = {}): Issue[] {
  const issues: Issue[] = [];
  for (const opt of clause.options) {
    const chosen = selection[opt.code];
    if (chosen === undefined) {
      issues.push({ kind: "optionUnselected", message: `옵션 ${opt.label}(${opt.code}) 이(가) 선택되지 않았습니다`, at: { ...coordinate, refPath: opt.code } });
    } else if (!opt.values.some((v) => v.code === chosen)) {
      issues.push({
        kind: "optionInvalid",
        message: `옵션 ${opt.label}(${opt.code}) 의 유효 집합에 없는 선택입니다: ${chosen}`,
        at: { ...coordinate, refPath: opt.code },
      });
    }
  }
  const known = new Set(clause.options.map((o) => o.code));
  for (const code of Object.keys(selection)) {
    if (!known.has(code)) {
      issues.push({ kind: "optionInvalid", message: `공용조항 ${clause.code} 에 없는 옵션입니다: ${code}`, at: { ...coordinate, refPath: code } });
    }
  }
  return issues;
}

/** 오버라이드 > 마스터 기본 순으로 합친 뒤 유효 집합 검사 (ADR-0017 결정 3). */
export function resolveOptions(
  clause: Clause,
  master: OptionSelection,
  override: OptionSelection = {},
  coordinate: Coordinate = {},
): { selection: OptionSelection; issues: Issue[] } {
  const selection: OptionSelection = { ...master, ...override };
  return { selection, issues: validateOptionSelection(clause, selection, coordinate) };
}

// ───────────────────────────── 인라인화 ─────────────────────────────

/**
 * 옵션 자리를 선택지 본문으로 치환한 새 노드 배열. 모든 노드 id 는 `${refNodeId}/${원노드id}`.
 * 조건은 해소하지 않는다 — 문맥은 사용처(조립·사전평가) 몫.
 */
export function expandClause(clause: Clause, selection: OptionSelection, refNodeId: Id): Result<ClauseBody> {
  const issues = validateOptionSelection(clause, selection);
  if (issues.length > 0) return reject({ reason: "invalid", issues });

  const nid = (id: Id) => `${refNodeId}/${id}`;
  const valueBody = (optionCode: Code): Inline[] => {
    const opt = clause.options.find((o) => o.code === optionCode)!;
    return opt.values.find((v) => v.code === selection[optionCode])!.body;
  };

  const inlines = (list: Inline[]): Inline[] => list.flatMap(inline);
  const inline = (n: Inline): Inline[] => {
    switch (n.kind) {
      case "optionSlot":
        return inlines(valueBody(n.optionCode));
      case "inlineCond":
        return [{ ...n, id: nid(n.id), branches: n.branches.map((b): InlineBranch => ({ ...b, id: nid(b.id), children: inlines(b.children) })) }];
      default:
        return [{ ...n, id: nid(n.id) }];
    }
  };
  const subitem = (s: SubitemNode): SubitemNode => ({ ...s, id: nid(s.id), children: inlines(s.children) });
  const item = (it: ItemNode): ItemNode => ({
    ...it,
    id: nid(it.id),
    children: inlines(it.children),
    ...(it.subitems ? { subitems: it.subitems.map(subitem) } : {}),
  });
  const block = (b: Block): Block => {
    if (b.kind === "paragraph") {
      return { ...b, id: nid(b.id), children: inlines(b.children), ...(b.items ? { items: b.items.map(item) } : {}) };
    }
    return { ...b, id: nid(b.id), branches: b.branches.map((br): BlockBranch => ({ ...br, id: nid(br.id), children: br.children.map(block) })) };
  };

  if (clause.mode === "inline") return ok(inlines(clause.body));
  return ok(clause.body.map(block));
}

// ───────────────────────────── 사용처 재검사 ─────────────────────────────

/** 사용처 문서의 소유 실체 종류 — 담보약관은 담보, 보통약관은 템플릿. */
export type UsageOwnerKind = "coverage" | "general";

/** 공용조항을 참조하는 문서 1건 (참조 인스턴스 단위 — D-P3-10). C1/B3 가 제공한다. */
export interface Usage {
  documentId: Id;
  ownerKind: UsageOwnerKind;
  ownerId: Id;
  ownerName?: string;
  /** 문서 안 참조 노드 id (있으면 좌표에 싣는다). */
  refNodeId?: Id;
  /** 그 참조의 마스터 옵션 선택. 없으면 옵션 검사는 건너뛴다. */
  selection?: OptionSelection;
}

export interface RecheckEntry {
  usage: Usage;
  /** 미부착 요구 구분자 (담보 사용처만). */
  missing: Code[];
  /** notAttached · brokenRef · optionUnselected · optionInvalid */
  issues: Issue[];
}

export function usageCoordinate(u: Usage): Coordinate {
  return {
    document: u.ownerKind === "coverage" ? "coverageMaster" : "general",
    ownerId: u.ownerId,
    ...(u.ownerName ? { ownerName: u.ownerName } : {}),
    ...(u.refNodeId ? { nodePath: [u.refNodeId] } : {}),
  };
}

/**
 * 사용처 전부를 훑어 문제가 있는 것만 돌려준다. 보통약관 사용처는 부착 검사를 건너뛴다
 * (대상 담보는 기본계약 지정 때 확정 — ADR-0011).
 */
export function recheckUsages(
  clause: Clause,
  usages: readonly Usage[],
  lookup: DiscriminatorLookup,
  attachedOf: (ownerId: Id) => ReadonlySet<Code>,
): RecheckEntry[] {
  const out: RecheckEntry[] = [];
  for (const usage of usages) {
    const at = usageCoordinate(usage);
    let missing: Code[] = [];
    const issues: Issue[] = [];
    if (usage.ownerKind === "coverage") {
      const r = checkAttachmentForReference(clause, attachedOf(usage.ownerId), lookup, at);
      missing = r.missing;
      issues.push(...r.issues);
    }
    if (usage.selection) issues.push(...validateOptionSelection(clause, usage.selection, at));
    if (issues.length > 0) out.push({ usage, missing, issues });
  }
  return out;
}
