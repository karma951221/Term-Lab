/**
 * 참조 그래프 조회 (순수) — 사용처 역인덱스 · 고아 · 순환 · 깨진 참조 · 관계정보 뷰.
 *
 * - `usagesOf`     : 이 실체(와 그 하위 — 구조체면 필드, enum 이면 값, 문서면 조 …)를 참조하는 간선. 좌표가 실려 있다.
 * - `orphans`      : 어디서도 참조되지 않는 구분자·공용조항·별표 (문면_기획 「고아 탐지」). 부착·타입 간선은 참조가 아니다.
 * - `cycles`       : 순환 (파생식 · 조 참조 · 조연결 …). 어떤 간선이든 닫힌 경로면 보고한다.
 * - `brokenEdges`  : 대상이 선언되지 않은 참조 — 삭제 뒤 남은 오류 상태 (ADR-0019 「깨진 참조는 오류 상태로」).
 * - `relationView` : 관계정보 뷰 한 구조 — 정방향 · 역방향 · 옵션 오버라이드 사용처(ADR-0017) · 깨진 정방향.
 */
import type { Issue } from "../types";
import { nodeKey, structuralParent } from "./graph";
import type { EdgeVia, RefEdge, RefGraph, RefNodeInfo, RefNodeKey } from "./types";

// ───────────────────────────── 포함 관계 ─────────────────────────────

/** 자기부터 최상위까지의 키 문자열 (선언된 부모 우선, 없으면 키 구조로). */
export function ancestorKeys(graph: RefGraph, key: RefNodeKey): string[] {
  const out: string[] = [];
  let cur: RefNodeKey | undefined = key;
  while (cur !== undefined && out.length < 16) {
    const k = nodeKey(cur);
    out.push(k);
    cur = graph.nodes.get(k)?.parent ?? structuralParent(cur);
  }
  return out;
}

function underOrSelf(graph: RefGraph, key: RefNodeKey, target: string): boolean {
  return ancestorKeys(graph, key).includes(target);
}

/** 참조가 아닌 관계 — 고아 판정에서 제외. */
const NON_REFERENCE: ReadonlySet<EdgeVia> = new Set<EdgeVia>(["attach", "type"]);

// ───────────────────────────── 사용처 ─────────────────────────────

export interface UsageOptions {
  /** 이 형태의 참조만. 없으면 전부. */
  via?: readonly EdgeVia[];
}

/** 역방향 — 대상(과 하위)을 참조하는 간선, 등장 순. */
export function usagesOf(graph: RefGraph, target: RefNodeKey, opts: UsageOptions = {}): RefEdge[] {
  const t = nodeKey(target);
  const via = opts.via ? new Set(opts.via) : undefined;
  return graph.edges.filter((e) => (!via || via.has(e.via)) && underOrSelf(graph, e.to, t));
}

/** 정방향 — 대상(과 하위)에서 나가는 간선. */
export function referencesFrom(graph: RefGraph, source: RefNodeKey, opts: UsageOptions = {}): RefEdge[] {
  const s = nodeKey(source);
  const via = opts.via ? new Set(opts.via) : undefined;
  return graph.edges.filter((e) => (!via || via.has(e.via)) && underOrSelf(graph, e.from, s));
}

// ───────────────────────────── 고아 ─────────────────────────────

const ORPHAN_KINDS: readonly RefNodeKey["kind"][] = ["discriminator", "clause", "appendix"];

/** 어디서도 참조되지 않는 구분자·공용조항·별표 (종류 순 · 선언 순). */
export function orphans(graph: RefGraph): RefNodeInfo[] {
  const referenced = new Set<string>();
  for (const e of graph.edges) {
    if (NON_REFERENCE.has(e.via)) continue;
    for (const k of ancestorKeys(graph, e.to)) referenced.add(k);
  }
  const out: RefNodeInfo[] = [];
  for (const kind of ORPHAN_KINDS) {
    for (const [k, info] of graph.nodes) if (info.key.kind === kind && !referenced.has(k)) out.push(info);
  }
  return out;
}

// ───────────────────────────── 순환 ─────────────────────────────

export interface RefCycle {
  /** 순환에 든 노드 (경로 순). */
  nodes: RefNodeKey[];
  /** 순환을 이루는 간선 (경로 순). */
  edges: RefEdge[];
}

/** 닫힌 참조 경로 전부 (같은 노드 집합은 한 번). 자기 참조도 순환이다. */
export function cycles(graph: RefGraph): RefCycle[] {
  const adjacency = new Map<string, RefEdge[]>();
  const keys = new Map<string, RefNodeKey>();
  for (const e of graph.edges) {
    const f = nodeKey(e.from);
    keys.set(f, e.from);
    keys.set(nodeKey(e.to), e.to);
    adjacency.set(f, [...(adjacency.get(f) ?? []), e]);
  }
  const state = new Map<string, "gray" | "black">();
  const stack: { key: string; edge?: RefEdge }[] = [];
  const found: RefCycle[] = [];
  const seen = new Set<string>();

  const visit = (key: string): void => {
    state.set(key, "gray");
    for (const e of adjacency.get(key) ?? []) {
      const next = nodeKey(e.to);
      const s = state.get(next);
      if (s === "gray") {
        const start = stack.findIndex((f) => f.key === next);
        const path = [...stack.slice(start + 1).map((f) => f.edge!), e];
        const nodes = [next, ...stack.slice(start + 1).map((f) => f.key)];
        const id = [...nodes].sort().join("|");
        if (!seen.has(id)) {
          seen.add(id);
          found.push({ nodes: nodes.map((k) => keys.get(k)!), edges: path });
        }
        continue;
      }
      if (s === "black") continue;
      stack.push({ key: next, edge: e });
      visit(next);
      stack.pop();
    }
    state.set(key, "black");
  };

  for (const key of keys.keys()) {
    if (state.has(key)) continue;
    stack.push({ key });
    visit(key);
    stack.pop();
  }
  return found;
}

// ───────────────────────────── 깨진 참조 ─────────────────────────────

/** 대상이 선언되지 않은 간선 — 등장 순. */
export function brokenEdges(graph: RefGraph): RefEdge[] {
  return graph.edges.filter((e) => !graph.nodes.has(nodeKey(e.to)));
}

/** 깨진 간선 → 오류 목록 (kind brokenRef · 좌표 = 참조 자리). */
export function brokenIssues(graph: RefGraph): Issue[] {
  return brokenEdges(graph).map((e) => ({
    kind: "brokenRef",
    message: `참조 대상이 없습니다: ${describeKey(e.to)} (${e.via})`,
    at: e.at,
  }));
}

// ───────────────────────────── 규모 (분모) ─────────────────────────────

export interface RefStats {
  /** 선언된 실체 수 전부. */
  nodes: number;
  /** 간선(참조) 수 전부 — 「참조 M 건 중 깨짐 N」의 분모. */
  edges: number;
  /** 고아 판정 대상 수 — 구분자·공용조항·별표. 「참조 노드 N 개 중 고아 M」의 분모다. */
  orphanCandidates: number;
}

/** 문제 개수에 붙일 분모 (디자인원칙 §9.6 — 분모 없는 카운트를 두지 않는다). */
export function refStats(graph: RefGraph): RefStats {
  let orphanCandidates = 0;
  for (const info of graph.nodes.values()) if ((ORPHAN_KINDS as readonly string[]).includes(info.key.kind)) orphanCandidates += 1;
  return { nodes: graph.nodes.size, edges: graph.edges.length, orphanCandidates };
}

/** 코드로 부르는 실체 — 표시명 뒤에 코드를 괄호로 붙인다 (디자인원칙 §9.4 「표시명 (코드)」). */
function codeOf(key: RefNodeKey): string | undefined {
  switch (key.kind) {
    case "discriminator":
    case "clause":
    case "appendix":
    case "attribute":
      return key.code;
    case "enum":
      return key.enumCode;
    default:
      return undefined;
  }
}

/** 상위를 이름으로 부를 때 붙일 자기 자신의 짧은 표기 (상위 정보는 뺀다). */
function selfFragment(key: RefNodeKey): string {
  switch (key.kind) {
    case "field":
      return `필드 ${key.fieldCode}`;
    case "enumValue":
      return `값 ${key.valueCode}`;
    case "clauseOption":
      return `옵션 ${key.optionCode}`;
    case "clauseOptionValue":
      return `선택지 ${key.valueCode}`;
    case "article":
      return `조 ${key.articleId}`;
    case "attributeValue":
      return `유효값 ${key.valueCode}`;
    default:
      return describeKey(key);
  }
}

/**
 * 선언된 표시명으로 만든 경로 — 「일반상해사망 특별약관 › 제2조(보험금의 감액지급)」.
 * 상위의 표시명이 하위 표시명의 접두이면(구분자 → `구분자.필드`) 겹쳐 적지 않는다.
 * 대상 자신이 선언돼 있지 않아도(= 깨진 참조) 상위가 선언돼 있으면 그 이름 아래에 「…(없음)」으로 매단다 —
 * 「알파Plus 보통약관 › 조 g-par-refund-1(없음)」. 아무것도 선언돼 있지 않으면 undefined.
 */
function namedPath(graph: RefGraph, key: RefNodeKey): string | undefined {
  const keys = ancestorKeys(graph, key);
  const self = graph.nodes.get(keys[0]!);
  const labels: string[] = [];
  for (const k of [...keys].reverse()) {
    if (k === keys[0] && !self) continue;
    const info = graph.nodes.get(k);
    if (!info) continue;
    const prev = labels.at(-1);
    if (prev !== undefined && info.label.startsWith(prev)) labels[labels.length - 1] = info.label;
    else labels.push(info.label);
  }
  if (labels.length === 0) return undefined;
  if (self) return labels.join(" › ");
  return [...labels, `${selfFragment(key)}(없음)`].join(" › ");
}

/**
 * 사람이 읽을 노드 표기.
 *
 * `graph` 를 주면 **표시명**으로 부른다 (ADR-0022 「키와 표시를 분리한다」 · 리뷰 #24) —
 * 「조 s-art-reduce (문서 77d5…)」가 아니라 「일반상해사망 특별약관 › 제2조(보험금의 감액지급)」.
 * 그래프가 없거나 대상이 선언돼 있지 않으면(삭제된 대상) id·코드 표기로 돌아간다.
 */
export function describeKey(key: RefNodeKey, graph?: RefGraph): string {
  if (graph) {
    const named = namedPath(graph, key);
    if (named !== undefined) {
      const code = graph.nodes.has(nodeKey(key)) ? codeOf(key) : undefined;
      return code !== undefined ? `${named}(${code})` : named;
    }
  }
  switch (key.kind) {
    case "discriminator":
      return `구분자 ${key.code}`;
    case "field":
      return `필드 ${key.code}.${key.fieldCode}`;
    case "enum":
      return `enum ${key.enumCode}`;
    case "enumValue":
      return `enum 값 ${key.enumCode}/${key.valueCode}`;
    case "clause":
      return `공용조항 ${key.code}`;
    case "clauseOption":
      return `옵션 ${key.clauseCode}.${key.optionCode}`;
    case "clauseOptionValue":
      return `옵션 선택지 ${key.clauseCode}.${key.optionCode}=${key.valueCode}`;
    case "document":
      return `문서 ${key.id}`;
    case "article":
      return `조 ${key.articleId} (문서 ${key.documentId || "?"})`;
    case "appendix":
      return `별표 ${key.code}`;
    case "coverageNode":
      return `${key.level} ${key.id}`;
    case "attribute":
      return `담보속성 ${key.code}`;
    case "attributeValue":
      return `담보속성 유효값 ${key.code}/${key.valueCode}`;
    case "product":
      return `상품 ${key.id}`;
    case "productCoverage":
      return `상품담보 ${key.id}`;
    case "entity":
      return `${key.entityKind} ${key.id}`;
  }
}

// ───────────────────────────── 관계정보 뷰 ─────────────────────────────

export interface RelationView {
  target: RefNodeKey;
  /** 선언된 실체 정보. 없으면 참조만 남은(삭제된) 대상. */
  node?: RefNodeInfo;
  /** 이것(과 하위)이 참조하는 것. */
  outgoing: RefEdge[];
  /** 이것(과 하위)을 참조하는 것 — 옵션 오버라이드는 제외 (따로). */
  incoming: RefEdge[];
  /** 옵션별 오버라이드 사용처 (ADR-0017 결정 4). */
  overrides: RefEdge[];
  /** outgoing 중 대상이 없는 것. */
  broken: RefEdge[];
}

export function relationView(graph: RefGraph, target: RefNodeKey): RelationView {
  const all = usagesOf(graph, target);
  const outgoing = referencesFrom(graph, target);
  return {
    target,
    node: graph.nodes.get(nodeKey(target)),
    outgoing,
    incoming: all.filter((e) => e.via !== "override"),
    overrides: all.filter((e) => e.via === "override"),
    broken: outgoing.filter((e) => !graph.nodes.has(nodeKey(e.to))),
  };
}
