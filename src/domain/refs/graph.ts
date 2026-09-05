/**
 * 참조 그래프 구성 (순수) — 각 영역의 정의·문서·관계를 재료로 노드·간선을 만든다.
 *
 * 재료와 간선:
 * - 카탈로그 정의 → 필드 노드 · enum 타입 간선(`type`) · 파생식 참조(`expression`)
 * - 공용조항 → 옵션·선택지 노드 · 본문/선택지 본문의 식 참조(`when`·`slot`) · 별표 참조
 * - 문서 → 조 노드 · `collectRefs` 의 참조 전부 (구분자 · 담보속성 · 공용조항+옵션 선택 · 조 참조 · 별표 · 조연결) ·
 *   대응 보통약관(`generalDocument`)
 * - 담보 트리 → 담보 노드 · 문서 연결(`document`) · 부착(`attach`)
 * - 상품 → 상품담보 노드 · 탑재(`mount`) · 조합(`combination`) · 옵션 오버라이드(`override`) · 템플릿(`generalDocument`)
 *
 * 식 안의 `attr.X = '값'` · `<enum 자리> = '코드'` 비교는 리터럴까지 읽어 유효값·enum 값 간선을 낸다
 * (담보속성 유효값 · enum 값 삭제 영향의 재료). 문법이 깨진 식은 간선을 내지 않는다.
 */
import type { Discriminator } from "../catalog/types";
import { slotPath } from "../catalog/values";
import type { Block, ClauseNode, Inline } from "../clause/nodes";
import { collectExpressions } from "../clause/body";
import type { Clause } from "../clause/types";
import { nodesOf } from "../coverage/tree";
import type { Coverage } from "../coverage/types";
import { coordinateOf, indexTree } from "../document/nodes";
import { collectRefs } from "../document/refs";
import { extractRefs, parse, refPath, type Expr, type Ref } from "../expression";
import type { Code, Coordinate, FieldType, Id } from "../types";
import type { AttachmentInput, DocumentInput, EdgeVia, GraphInputs, ProductInput, RefEdge, RefGraph, RefNodeInfo, RefNodeKey } from "./types";

// ───────────────────────────── 키 ─────────────────────────────

/** 노드 키의 정규 문자열. */
export function nodeKey(key: RefNodeKey): string {
  switch (key.kind) {
    case "discriminator":
      return `discriminator:${key.code}`;
    case "field":
      return `field:${key.code}.${key.fieldCode}`;
    case "enum":
      return `enum:${key.enumCode}`;
    case "enumValue":
      return `enumValue:${key.enumCode}/${key.valueCode}`;
    case "clause":
      return `clause:${key.code}`;
    case "clauseOption":
      return `clauseOption:${key.clauseCode}/${key.optionCode}`;
    case "clauseOptionValue":
      return `clauseOptionValue:${key.clauseCode}/${key.optionCode}/${key.valueCode}`;
    case "document":
      return `document:${key.id}`;
    case "article":
      return `article:${key.documentId}/${key.articleId}`;
    case "appendix":
      return `appendix:${key.code}`;
    case "coverageNode":
      return `coverageNode:${key.level}/${key.id}`;
    case "attribute":
      return `attribute:${key.code}`;
    case "attributeValue":
      return `attributeValue:${key.code}/${key.valueCode}`;
    case "product":
      return `product:${key.id}`;
    case "productCoverage":
      return `productCoverage:${key.id}`;
    case "entity":
      return `entity:${key.entityKind}/${key.id}`;
  }
}

/** 키 구조만으로 아는 상위 실체 (선언 여부와 무관 — 깨진 대상에도 쓴다). 담보 노드는 트리를 알아야 해서 여기 없다. */
export function structuralParent(key: RefNodeKey): RefNodeKey | undefined {
  switch (key.kind) {
    case "field":
      return { kind: "discriminator", code: key.code };
    case "enumValue":
      return { kind: "enum", enumCode: key.enumCode };
    case "clauseOption":
      return { kind: "clause", code: key.clauseCode };
    case "clauseOptionValue":
      return { kind: "clauseOption", clauseCode: key.clauseCode, optionCode: key.optionCode };
    case "article":
      return { kind: "document", id: key.documentId };
    case "attributeValue":
      return { kind: "attribute", code: key.code };
    default:
      return undefined;
  }
}

/** 식 참조 → 노드 키. builtin(뼈대 속성)은 실체가 아니라 undefined. */
export function refNodeKey(ref: Ref): RefNodeKey | undefined {
  switch (ref.kind) {
    case "discriminator":
      return ref.field === undefined ? { kind: "discriminator", code: ref.code } : { kind: "field", code: ref.code, fieldCode: ref.field };
    case "attr":
      return { kind: "attribute", code: ref.code };
    case "builtin":
      return undefined;
  }
}

/** 값 소유자(값 저장소 owner) → 노드 키. */
export function ownerNodeKey(owner: { kind: string; id: Id }): RefNodeKey {
  switch (owner.kind) {
    case "coverage":
    case "subCoverage":
    case "benefit":
      return { kind: "coverageNode", level: owner.kind, id: owner.id };
    case "product":
      return { kind: "product", id: owner.id };
    case "productCoverage":
      return { kind: "productCoverage", id: owner.id };
    default:
      return { kind: "entity", entityKind: owner.kind, id: owner.id };
  }
}

// ───────────────────────────── 식 보조 ─────────────────────────────

/** `참조 = '문자열'` · `참조 ≠ '문자열'` 비교 — 리터럴이 가리키는 유효값·enum 값을 찾는 재료. */
export function literalCompares(expr: Expr): { ref: Ref; literal: string }[] {
  const out: { ref: Ref; literal: string }[] = [];
  const walk = (e: Expr): void => {
    switch (e.kind) {
      case "compare": {
        if (e.op === "=" || e.op === "≠") {
          const pairs: [Expr, Expr][] = [
            [e.left, e.right],
            [e.right, e.left],
          ];
          for (const [a, b] of pairs) {
            if (a.kind === "ref" && b.kind === "literal" && b.literal.type === "string") out.push({ ref: a.ref, literal: b.literal.value });
          }
        }
        walk(e.left);
        walk(e.right);
        return;
      }
      case "and":
      case "or":
        walk(e.left);
        walk(e.right);
        return;
      case "not":
        walk(e.operand);
        return;
      default:
        return;
    }
  };
  walk(expr);
  return out;
}

// ───────────────────────────── 구성 ─────────────────────────────

class Builder {
  readonly nodes = new Map<string, RefNodeInfo>();
  readonly edges: RefEdge[] = [];
  /** 값 자리 경로 → enum 코드 (enum 값 리터럴 간선용). */
  readonly enumSlots = new Map<string, Code>();

  node(info: RefNodeInfo): void {
    this.nodes.set(nodeKey(info.key), info);
  }

  edge(e: RefEdge): void {
    this.edges.push(e);
  }

  /** 식 하나의 참조 간선 전부 — 구분자·필드·담보속성 + 리터럴이 가리키는 유효값·enum 값. */
  expression(from: RefNodeKey, src: string, via: EdgeVia, at: Coordinate, opts: { slotOnly?: boolean } = {}): void {
    const parsed = parse(src);
    if (!parsed.ok) return;
    if (opts.slotOnly && parsed.value.kind !== "ref") return;
    for (const { ref, path, aggregate } of extractRefs(parsed.value)) {
      const to = refNodeKey(ref);
      if (!to) continue;
      this.edge({ from, to, via, at: { ...at, refPath: path }, ...(aggregate !== undefined ? { aggregate } : {}) });
    }
    for (const { ref, literal } of literalCompares(parsed.value)) {
      const path = refPath(ref);
      if (ref.kind === "attr") {
        this.edge({ from, to: { kind: "attributeValue", code: ref.code, valueCode: literal }, via, at: { ...at, refPath: path } });
      } else if (ref.kind === "discriminator") {
        const enumCode = this.enumSlots.get(path);
        if (enumCode !== undefined) this.edge({ from, to: { kind: "enumValue", enumCode, valueCode: literal }, via, at: { ...at, refPath: path } });
      }
    }
  }
}

function enumOf(type: FieldType): Code | undefined {
  return "enumCode" in type ? type.enumCode : undefined;
}

function addDiscriminator(b: Builder, def: Discriminator): void {
  const key: RefNodeKey = { kind: "discriminator", code: def.code };
  b.node({ key, label: def.label, detail: def.kind, ...(def.kind !== "const" ? { level: def.level } : {}) });
  if (def.kind === "scalar") {
    const e = enumOf(def.type);
    if (e !== undefined) {
      b.enumSlots.set(slotPath(def.code), e);
      b.edge({ from: key, to: { kind: "enum", enumCode: e }, via: "type", at: { refPath: slotPath(def.code), ownerName: def.label } });
    }
  } else if (def.kind === "struct") {
    for (const f of def.fields) {
      const fkey: RefNodeKey = { kind: "field", code: def.code, fieldCode: f.code };
      b.node({ key: fkey, label: `${def.label}.${f.label}`, parent: key, level: def.level, detail: f.type.kind });
      const e = enumOf(f.type);
      if (e !== undefined) {
        b.enumSlots.set(slotPath(def.code, f.code), e);
        b.edge({ from: fkey, to: { kind: "enum", enumCode: e }, via: "type", at: { refPath: slotPath(def.code, f.code), ownerName: `${def.label}.${f.label}` } });
      }
    }
  }
}

function addDerived(b: Builder, def: Discriminator): void {
  if (def.kind !== "derived") return;
  b.expression({ kind: "discriminator", code: def.code }, def.expression, "expression", { ownerId: def.code, ownerName: def.label });
}

/** 공용조항 본문 노드 전부 (경로 포함) — 별표 참조 수집용. 식은 collectExpressions 가 따로 본다. */
function walkClauseNodes(body: readonly (Inline | Block)[], basePath: Id[], visit: (node: ClauseNode, path: Id[]) => void): void {
  const inline = (n: Inline, path: Id[]) => {
    const here = [...path, n.id];
    visit(n, here);
    if (n.kind === "inlineCond") for (const br of n.branches) for (const c of br.children) inline(c, [...here, br.id]);
  };
  const block = (n: Block, path: Id[]) => {
    const here = [...path, n.id];
    visit(n, here);
    if (n.kind === "paragraph") {
      for (const c of n.children) inline(c, here);
      for (const it of n.items ?? []) {
        const ip = [...here, it.id];
        visit(it, ip);
        for (const c of it.children) inline(c, ip);
        for (const si of it.subitems ?? []) {
          const sp = [...ip, si.id];
          visit(si, sp);
          for (const c of si.children) inline(c, sp);
        }
      }
    } else {
      for (const br of n.branches) for (const c of br.children) block(c, [...here, br.id]);
    }
  };
  for (const n of body) {
    if (n.kind === "paragraph" || n.kind === "condBlock") block(n, basePath);
    else inline(n, basePath);
  }
}

function addClause(b: Builder, clause: Clause): void {
  const key: RefNodeKey = { kind: "clause", code: clause.code };
  b.node({ key, label: clause.label, detail: clause.mode });
  for (const o of clause.options) {
    const okey: RefNodeKey = { kind: "clauseOption", clauseCode: clause.code, optionCode: o.code };
    b.node({ key: okey, label: o.label, parent: key });
    for (const v of o.values) b.node({ key: { kind: "clauseOptionValue", clauseCode: clause.code, optionCode: o.code, valueCode: v.code }, label: v.label, parent: okey });
  }
  const base: Coordinate = { document: "clause", ownerId: clause.code, ownerName: clause.label };
  const bodies: { body: readonly (Inline | Block)[]; path: Id[] }[] = [
    { body: clause.body, path: [] },
    ...clause.options.flatMap((o) => o.values.map((v) => ({ body: v.body, path: [o.code, v.code] }))),
  ];
  for (const { body, path } of bodies) {
    for (const e of collectExpressions(body as Inline[] | Block[], path)) {
      b.expression(key, e.source, e.role === "slot" ? "slot" : "when", { ...base, nodePath: e.nodePath }, { slotOnly: e.role === "slot" });
    }
    walkClauseNodes(body, path, (n, nodePath) => {
      if (n.kind === "appendixRef") b.edge({ from: key, to: { kind: "appendix", code: n.appendixCode }, via: "appendixRef", at: { ...base, nodePath } });
    });
  }
}

/** 문서 안 노드 id → 조 키(조 안이면) 또는 문서 키. */
function anchorOf(doc: DocumentInput, articleId: Id | undefined): RefNodeKey {
  return articleId !== undefined ? { kind: "article", documentId: doc.id, articleId } : { kind: "document", id: doc.id };
}

function addDocument(b: Builder, doc: DocumentInput): Map<Id, RefNodeKey> {
  const key: RefNodeKey = { kind: "document", id: doc.id };
  b.node({ key, label: doc.title, detail: doc.kind, ownerId: doc.ownerId ?? doc.id });
  const base: Coordinate = { document: doc.kind, ownerId: doc.ownerId ?? doc.id, ownerName: doc.title };
  const ix = indexTree(doc.tree, base);
  /** 문서 안 모든 노드 id → 그 노드가 속한 조 키(또는 문서 키) — 오버라이드의 매개 노드 찾기용. */
  const anchors = new Map<Id, RefNodeKey>();
  for (const e of ix.nodes.values()) {
    if (e.node.kind === "article") b.node({ key: { kind: "article", documentId: doc.id, articleId: e.node.id }, label: e.node.title, parent: key });
    anchors.set(e.node.id, anchorOf(doc, e.articleId));
  }
  const generalOf = (id: Id): RefNodeKey => ({ kind: "article", documentId: doc.generalDocumentId ?? "", articleId: id });

  for (const r of collectRefs(doc.tree, base)) {
    const from = anchorOf(doc, r.at.articleId);
    switch (r.kind) {
      case "discriminator":
        b.edge({ from, to: r.field !== undefined ? { kind: "field", code: r.code, fieldCode: r.field } : { kind: "discriminator", code: r.code }, via: r.via, at: r.at });
        break;
      case "attribute":
        b.edge({ from, to: { kind: "attribute", code: r.code }, via: "when", at: r.at });
        break;
      case "builtin":
        break;
      case "clause":
        b.edge({ from, to: { kind: "clause", code: r.clauseCode }, via: "clauseRef", at: r.at, options: r.options });
        for (const [optionCode, valueCode] of Object.entries(r.options)) {
          b.edge({ from, to: { kind: "clauseOptionValue", clauseCode: r.clauseCode, optionCode, valueCode }, via: "optionSelect", at: { ...r.at, refPath: `${r.clauseCode}.${optionCode}` } });
        }
        break;
      case "article":
        b.edge({ from, to: r.scope === "self" ? { kind: "article", documentId: doc.id, articleId: r.articleId } : generalOf(r.articleId), via: "articleRef", at: r.at });
        break;
      case "appendix":
        b.edge({ from, to: { kind: "appendix", code: r.appendixCode }, via: "appendixRef", at: r.at });
        break;
      case "link":
        b.edge({ from, to: generalOf(r.linkedArticleId), via: "link", at: r.at });
        break;
    }
  }
  // 조건식의 리터럴 비교 (유효값 · enum 값 간선) — collectRefs 는 리터럴을 주지 않으므로 가지를 한 번 더 훑는다.
  for (const be of ix.branches.values()) {
    if (be.branch.when === undefined) continue;
    const parsed = parse(be.branch.when);
    if (!parsed.ok) continue;
    const at = coordinateOf(ix, be, base);
    for (const { ref, literal } of literalCompares(parsed.value)) {
      const from = anchorOf(doc, be.articleId);
      if (ref.kind === "attr") b.edge({ from, to: { kind: "attributeValue", code: ref.code, valueCode: literal }, via: "when", at: { ...at, refPath: refPath(ref) } });
      else if (ref.kind === "discriminator") {
        const enumCode = b.enumSlots.get(refPath(ref));
        if (enumCode !== undefined) b.edge({ from, to: { kind: "enumValue", enumCode, valueCode: literal }, via: "when", at: { ...at, refPath: refPath(ref) } });
      }
    }
  }
  if (doc.generalDocumentId !== undefined) b.edge({ from: key, to: { kind: "document", id: doc.generalDocumentId }, via: "generalDocument", at: base });
  return anchors;
}

function addCoverage(b: Builder, tree: Coverage): void {
  const root: RefNodeKey = { kind: "coverageNode", level: "coverage", id: tree.id };
  for (const n of nodesOf(tree)) {
    const parent = n.ancestors.at(-1);
    b.node({ key: { kind: "coverageNode", level: n.level, id: n.id }, label: n.name, level: n.level, ...(parent ? { parent: { kind: "coverageNode", level: parent.level, id: parent.id } } : {}) });
  }
  if (tree.documentId !== undefined) {
    b.edge({ from: root, to: { kind: "document", id: tree.documentId }, via: "document", at: { document: "coverageMaster", ownerId: tree.id, ownerName: tree.name } });
  }
}

function addAttachment(b: Builder, a: AttachmentInput): void {
  const from = ownerNodeKey(a.owner);
  const info = b.nodes.get(nodeKey(from));
  const document: Coordinate["document"] | undefined = from.kind === "coverageNode" ? "coverageMaster" : from.kind === "product" ? "product" : from.kind === "productCoverage" ? "special" : undefined;
  b.edge({
    from,
    to: { kind: "discriminator", code: a.discriminatorCode },
    via: "attach",
    at: { ...(document ? { document } : {}), ownerId: a.owner.id, ...(info ? { ownerName: info.label } : {}), refPath: a.discriminatorCode },
  });
}

function addProduct(b: Builder, p: ProductInput, anchors: Map<Id, RefNodeKey>): void {
  const key: RefNodeKey = { kind: "product", id: p.id };
  b.node({ key, label: p.name });
  const base: Coordinate = { document: "product", ownerId: p.id, ownerName: p.name };
  if (p.generalDocumentId !== undefined) b.edge({ from: key, to: { kind: "document", id: p.generalDocumentId }, via: "generalDocument", at: base });
  const names = new Map<Id, string>();
  for (const pc of p.coverages) {
    const pkey: RefNodeKey = { kind: "productCoverage", id: pc.id };
    names.set(pc.id, pc.name);
    b.node({ key: pkey, label: pc.name, parent: key });
    const at: Coordinate = { document: "special", ownerId: pc.id, ownerName: pc.name };
    b.edge({ from: pkey, to: { kind: "coverageNode", level: "coverage", id: pc.coverageId }, via: "mount", at });
    for (const a of pc.attributes) {
      b.edge({ from: pkey, to: { kind: "attributeValue", code: a.kindCode, valueCode: a.valueCode }, via: "combination", at: { ...at, refPath: `attr.${a.kindCode}` } });
    }
  }
  for (const o of p.overrides) {
    const from: RefNodeKey = o.scope.kind === "product" ? key : { kind: "productCoverage", id: o.scope.id };
    const at: Coordinate = {
      document: o.scope.kind === "product" ? "product" : "special",
      ownerId: o.scope.id,
      ownerName: o.scope.kind === "product" ? p.name : (names.get(o.scope.id) ?? ""),
      nodePath: [o.nodeId],
    };
    const through = anchors.get(o.nodeId);
    for (const [optionCode, valueCode] of Object.entries(o.options)) {
      b.edge({
        from,
        to: { kind: "clauseOptionValue", clauseCode: o.clauseCode, optionCode, valueCode },
        via: "override",
        at: { ...at, refPath: `${o.clauseCode}.${optionCode}` },
        ...(through ? { through } : {}),
      });
    }
  }
}

/** 재료 전부로 그래프를 만든다. 순수 함수 — 같은 입력이면 같은 그래프. */
export function buildGraph(inputs: GraphInputs): RefGraph {
  const b = new Builder();
  const defs = inputs.discriminators ?? [];
  for (const d of defs) addDiscriminator(b, d);
  for (const e of inputs.enums ?? []) {
    const key: RefNodeKey = { kind: "enum", enumCode: e.code };
    b.node({ key, label: e.label });
    for (const v of e.values) b.node({ key: { kind: "enumValue", enumCode: e.code, valueCode: v.code }, label: v.label, parent: key });
  }
  for (const a of inputs.appendices ?? []) b.node({ key: { kind: "appendix", code: a.code }, label: a.name });
  for (const k of inputs.attributeKinds ?? []) {
    const key: RefNodeKey = { kind: "attribute", code: k.code };
    b.node({ key, label: k.label });
    for (const v of k.values) b.node({ key: { kind: "attributeValue", code: k.code, valueCode: v.code }, label: v.label, parent: key });
  }
  for (const c of inputs.coverages ?? []) addCoverage(b, c);
  // 간선은 노드 선언이 끝난 뒤 (enum 자리 · 소유자 이름을 알아야 한다)
  for (const d of defs) addDerived(b, d);
  for (const c of inputs.clauses ?? []) addClause(b, c);
  const anchors = new Map<Id, RefNodeKey>();
  for (const d of inputs.documents ?? []) for (const [id, key] of addDocument(b, d)) anchors.set(id, key);
  for (const p of inputs.products ?? []) addProduct(b, p, anchors);
  // 부착은 맨 뒤 — 소유자(담보 노드 · 상품 · 상품담보)의 이름을 좌표에 싣는다
  for (const a of inputs.attachments ?? []) addAttachment(b, a);
  return { nodes: b.nodes, edges: b.edges };
}

export type { DocumentInput, ProductInput } from "./types";
