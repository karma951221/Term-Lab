/** 관계정보 그래프 옵션의 URL 계약 — 사람이 고친 잘못된 값은 안전한 기본값으로 되돌린다. */
import type { EdgeVia, RefNodeKind } from "@/domain/refs";

import { EDGE_STYLE, type Direction, type PlotOptions } from "./plot";

export interface PlotOptionQuery {
  depth?: string | string[];
  dir?: string | string[];
  kinds?: string | string[];
  vias?: string | string[];
  containment?: string | string[];
}

export const ALL_NODE_KINDS = [
  "discriminator",
  "field",
  "enum",
  "enumValue",
  "attribute",
  "attributeValue",
  "document",
  "article",
  "clause",
  "clauseOption",
  "clauseOptionValue",
  "appendix",
  "coverageNode",
  "product",
  "productCoverage",
  "entity",
] as const satisfies readonly RefNodeKind[];

export const ALL_EDGE_VIAS = [
  "when",
  "slot",
  "expression",
  "clauseRef",
  "optionSelect",
  "articleRef",
  "link",
  "appendixRef",
  "generalDocument",
  "document",
  "override",
  "attach",
  "type",
  "mount",
  "combination",
] as const satisfies readonly EdgeVia[];

export const DEFAULT_VIAS = ALL_EDGE_VIAS.filter((via) => EDGE_STYLE[via] !== "dotted");

function last(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.at(-1) : value;
}

function parseSet<T extends string>(raw: string | string[] | undefined, all: readonly T[], fallback: readonly T[]): ReadonlySet<T> {
  if (raw === undefined) return new Set(fallback);
  const chunks = Array.isArray(raw) ? raw : [raw];
  const values = chunks.flatMap((chunk) => chunk.split(",")).filter((value) => value !== "");
  const valid = new Set<string>(all);
  if (values.some((value) => !valid.has(value))) return new Set(fallback);
  return new Set(values as T[]);
}

export function parsePlotOptions(query: PlotOptionQuery): PlotOptions {
  const depthRaw = last(query.depth);
  const depth = depthRaw === "1" || depthRaw === "2" || depthRaw === "3" ? Number(depthRaw) : 1;
  const directionRaw = last(query.dir);
  const direction: Direction = directionRaw === "in" || directionRaw === "out" || directionRaw === "both" ? directionRaw : "both";
  const containmentRaw = last(query.containment);
  const containment = containmentRaw === "false" || containmentRaw === "0" ? false : true;
  return {
    depth,
    direction,
    kinds: parseSet(query.kinds, ALL_NODE_KINDS, ALL_NODE_KINDS),
    vias: parseSet(query.vias, ALL_EDGE_VIAS, DEFAULT_VIAS),
    containment,
  };
}

export function serializePlotOptions(options: PlotOptions): URLSearchParams {
  const params = new URLSearchParams();
  params.set("depth", String(options.depth));
  params.set("dir", options.direction);
  params.set("kinds", ALL_NODE_KINDS.filter((kind) => options.kinds.has(kind)).join(","));
  params.set("vias", ALL_EDGE_VIAS.filter((via) => options.vias.has(via)).join(","));
  params.set("containment", String(options.containment));
  return params;
}
