import { describe, expect, it } from "vitest";

import type { EdgeVia, RefNodeKind } from "@/domain/refs";

import { ALL_EDGE_VIAS, ALL_NODE_KINDS, DEFAULT_VIAS, parsePlotOptions, serializePlotOptions } from "./plot-options";

describe("관계정보 그래프 URL 옵션", () => {
  it("값이 없거나 잘못되면 기본값으로 돌아간다", () => {
    const defaults = parsePlotOptions({});
    expect(defaults).toEqual({
      depth: 1,
      direction: "both",
      kinds: new Set(ALL_NODE_KINDS),
      vias: new Set(DEFAULT_VIAS),
      containment: true,
    });
    expect(parsePlotOptions({ depth: "9", dir: "side", kinds: "bogus", vias: "when,bogus", containment: "bogus" })).toEqual(defaults);
  });

  it("직렬화한 필터를 다시 파싱하면 같은 옵션이다", () => {
    const options = {
      depth: 3,
      direction: "in" as const,
      kinds: new Set([ALL_NODE_KINDS[0], ALL_NODE_KINDS[7]]),
      vias: new Set([ALL_EDGE_VIAS[0], ALL_EDGE_VIAS.at(-1)!]),
      containment: false,
    };
    expect(parsePlotOptions(Object.fromEntries(serializePlotOptions(options)))).toEqual(options);
  });

  it("빈 종류·형태 집합도 URL 왕복에서 기본값으로 바뀌지 않는다", () => {
    const empty = { depth: 1, direction: "out" as const, kinds: new Set<RefNodeKind>(), vias: new Set<EdgeVia>(), containment: true };
    expect(parsePlotOptions(Object.fromEntries(serializePlotOptions(empty)))).toEqual(empty);
  });
});
