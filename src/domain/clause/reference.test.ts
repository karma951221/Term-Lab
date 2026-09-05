import { describe, expect, it } from "vitest";

import type { Discriminator } from "../catalog/types";
import type { Block, Inline } from "./nodes";
import {
  checkAttachmentForReference,
  expandClause,
  lookupFrom,
  recheckUsages,
  resolveOptions,
  validateOptionSelection,
  type Usage,
} from "./reference";
import type { BlockClause, InlineClause } from "./types";

function unwrap<T>(r: { ok: true; value: T } | { ok: false; rejection: unknown }): T {
  if (!r.ok) throw new Error(`기대: ok, 실제: ${JSON.stringify(r.rejection)}`);
  return r.value;
}

// 카탈로그 픽스처
const catalog: Discriminator[] = [
  { kind: "scalar", code: "D0001", label: "갱신여부", description: "", level: "coverage", alwaysExposed: true, type: { kind: "boolean" } },
  { kind: "scalar", code: "D0002", label: "수술급여기준", description: "", level: "coverage", alwaysExposed: false, type: { kind: "string" } },
  { kind: "struct", code: "D0003", label: "보험금지급", description: "", level: "benefit", alwaysExposed: false, fields: [{ code: "F01", label: "면책여부", type: { kind: "boolean" }, order: 0 }] },
  { kind: "scalar", code: "D0004", label: "고지유형", description: "", level: "product", alwaysExposed: false, type: { kind: "string" } },
  { kind: "const", code: "D0005", label: "평균공시이율", description: "", value: "2.5%" },
  { kind: "derived", code: "D0006", label: "면책여부합", description: "", level: "coverage", expression: "any(D0003.F01)" },
];
const lookup = lookupFrom(catalog);

const 준용규정: BlockClause = {
  code: "C0001",
  label: "준용규정",
  mode: "block",
  description: "",
  body: [
    { id: "p1", kind: "paragraph", children: [
      { id: "t1", kind: "text", text: "이 특별약관에서 정하지 않은 사항은 " },
      { id: "o1", kind: "optionSlot", optionCode: "O01" },
      { id: "t2", kind: "text", text: "을 따릅니다." },
    ] },
    { id: "cb", kind: "condBlock", branches: [
      { id: "b1", when: "D0002 = '기준A'", children: [{ id: "p2", kind: "paragraph", children: [{ id: "t3", kind: "text", text: "기준A 문구" }] }] },
    ] },
  ],
  options: [
    { code: "O01", label: "준용 대상", order: 0, values: [
      { code: "V01", label: "보통약관", order: 0, body: [{ id: "v1", kind: "text", text: "보통약관" }] },
      { code: "V02", label: "기본계약 약관", order: 1, body: [{ id: "v2", kind: "text", text: "기본계약 " }, { id: "v2s", kind: "slot", ref: "D0005" }] },
    ] },
  ],
  required: { discriminators: ["D0002", "D0005"], attributes: [] },
};

describe("공용조항 S2 — 참조 추가 시 부착 검사 (담보 문맥)", () => {
  it("요구 구분자 중 선택적 노출·담보 레벨(이하) 구분자가 부착돼 있지 않으면 미부착 목록에 든다", () => {
    const r = checkAttachmentForReference(준용규정, new Set(), lookup);
    expect(r.missing).toEqual(["D0002"]);
    expect(r.broken).toEqual([]);
  });

  it("부착돼 있으면 비어 있다 — 참조 추가가 성립한다", () => {
    expect(checkAttachmentForReference(준용규정, new Set(["D0002"]), lookup).missing).toEqual([]);
  });

  it("무조건 노출 · const · 파생 · 상품 레벨 구분자는 담보 부착 대상이 아니다", () => {
    const clause: InlineClause = {
      ...준용규정,
      mode: "inline",
      body: [],
      options: [],
      required: { discriminators: ["D0001", "D0004", "D0005", "D0006"], attributes: ["A0001"] },
    };
    expect(checkAttachmentForReference(clause, new Set(), lookup).missing).toEqual([]);
  });

  it("세부보장·급부 레벨 구조체도 담보 하위라 검사 대상이다", () => {
    const clause: InlineClause = { ...준용규정, mode: "inline", body: [], options: [], required: { discriminators: ["D0003"], attributes: [] } };
    expect(checkAttachmentForReference(clause, new Set(), lookup).missing).toEqual(["D0003"]);
  });

  it("카탈로그에 없는 구분자는 깨진 참조로 따로 보고한다", () => {
    const clause: InlineClause = { ...준용규정, mode: "inline", body: [], options: [], required: { discriminators: ["D0099"], attributes: [] } };
    const r = checkAttachmentForReference(clause, new Set(), lookup);
    expect(r.missing).toEqual([]);
    expect(r.broken).toEqual(["D0099"]);
    expect(r.issues.map((i) => i.kind)).toEqual(["brokenRef"]);
  });
});

describe("공용조항 S5 · S7 — 옵션 선택 검증과 오버라이드 해소 (ADR-0017)", () => {
  it("미선택 옵션은 optionUnselected, 유효 집합 밖 선택은 optionInvalid", () => {
    expect(validateOptionSelection(준용규정, {})).toMatchObject([{ kind: "optionUnselected", at: { refPath: "O01" } }]);
    expect(validateOptionSelection(준용규정, { O01: "V09" })).toMatchObject([{ kind: "optionInvalid" }]);
    expect(validateOptionSelection(준용규정, { O09: "V01", O01: "V01" })).toMatchObject([{ kind: "optionInvalid", at: { refPath: "O09" } }]);
    expect(validateOptionSelection(준용규정, { O01: "V02" })).toEqual([]);
  });

  it("좌표 기본값을 넘기면 Issue 좌표에 합쳐진다", () => {
    const [issue] = validateOptionSelection(준용규정, {}, { document: "coverageMaster", ownerId: "cov-1", nodePath: ["ref-1"] });
    expect(issue.at).toEqual({ document: "coverageMaster", ownerId: "cov-1", nodePath: ["ref-1"], refPath: "O01" });
  });

  it("오버라이드 > 마스터 기본. 결과는 항상 유효 집합 안에서만 — 밖이면 issue", () => {
    expect(resolveOptions(준용규정, { O01: "V01" }, { O01: "V02" })).toEqual({ selection: { O01: "V02" }, issues: [] });
    expect(resolveOptions(준용규정, { O01: "V01" })).toEqual({ selection: { O01: "V01" }, issues: [] });
    const bad = resolveOptions(준용규정, { O01: "V01" }, { O01: "V09" });
    expect(bad.selection).toEqual({ O01: "V09" });
    expect(bad.issues[0].kind).toBe("optionInvalid");
    expect(resolveOptions(준용규정, {}).issues[0].kind).toBe("optionUnselected");
  });
});

describe("공용조항 S6 — 인라인화 헬퍼 expandClause", () => {
  it("block: 옵션 자리를 선택지 본문으로 치환하고 모든 id 를 `${참조노드id}/${원노드id}` 로 유일화. 조건은 해소하지 않는다", () => {
    const out = unwrap(expandClause(준용규정, { O01: "V02" }, "ref-1")) as Block[];
    expect(out).toEqual([
      { id: "ref-1/p1", kind: "paragraph", children: [
        { id: "ref-1/t1", kind: "text", text: "이 특별약관에서 정하지 않은 사항은 " },
        { id: "ref-1/v2", kind: "text", text: "기본계약 " },
        { id: "ref-1/v2s", kind: "slot", ref: "D0005" },
        { id: "ref-1/t2", kind: "text", text: "을 따릅니다." },
      ] },
      { id: "ref-1/cb", kind: "condBlock", branches: [
        { id: "ref-1/b1", when: "D0002 = '기준A'", children: [
          { id: "ref-1/p2", kind: "paragraph", children: [{ id: "ref-1/t3", kind: "text", text: "기준A 문구" }] },
        ] },
      ] },
    ]);
    // 원본은 그대로
    expect(준용규정.body[0]).toMatchObject({ id: "p1" });
  });

  it("inline: 인라인 노드 열을 돌려주고 호·목·인라인 조건 안의 옵션 자리도 치환된다", () => {
    const clause: InlineClause = {
      ...준용규정,
      mode: "inline",
      body: [
        { id: "c", kind: "inlineCond", branches: [
          { id: "b", when: "D0001", children: [{ id: "o", kind: "optionSlot", optionCode: "O01" }] },
        ] },
      ],
    };
    const out = unwrap(expandClause(clause, { O01: "V01" }, "r")) as Inline[];
    expect(out).toEqual([
      { id: "r/c", kind: "inlineCond", branches: [{ id: "r/b", when: "D0001", children: [{ id: "r/v1", kind: "text", text: "보통약관" }] }] },
    ]);
  });

  it("미선택·유효 집합 밖 선택이면 거부 (invalid · optionUnselected / optionInvalid)", () => {
    const r = expandClause(준용규정, {}, "ref-1");
    expect(r.ok).toBe(false);
    if (!r.ok && r.rejection.reason === "invalid") expect(r.rejection.issues[0].kind).toBe("optionUnselected");
    const r2 = expandClause(준용규정, { O01: "V09" }, "ref-1");
    if (!r2.ok && r2.rejection.reason === "invalid") expect(r2.rejection.issues[0].kind).toBe("optionInvalid");
  });

  it("같은 공용조항을 두 자리에서 참조해도 참조 노드 id 가 다르면 전개 결과의 id 가 겹치지 않는다 (D-P3-10)", () => {
    const a = unwrap(expandClause(준용규정, { O01: "V01" }, "ref-a")) as Block[];
    const b = unwrap(expandClause(준용규정, { O01: "V01" }, "ref-b")) as Block[];
    expect(a[0].id).toBe("ref-a/p1");
    expect(b[0].id).toBe("ref-b/p1");
  });
});

describe("공용조항 S3 — 수정 시 기존 사용처 재검사", () => {
  const usages: Usage[] = [
    { documentId: "doc-1", ownerKind: "coverage", ownerId: "cov-수술비", ownerName: "수술비", selection: { O01: "V01" } },
    { documentId: "doc-2", ownerKind: "coverage", ownerId: "cov-상해사망", ownerName: "일반상해사망", selection: { O01: "V01" } },
    { documentId: "doc-3", ownerKind: "general", ownerId: "gen-1", ownerName: "보통약관 A", selection: { O01: "V02" } },
  ];
  const attached = new Map([["cov-상해사망", new Set(["D0002"])]]);
  const attachedOf = (ownerId: string) => attached.get(ownerId) ?? new Set<string>();

  it("요구 구분자가 늘면 미부착 담보만 목록에 오른다 — 부착된 담보·보통약관(대상 담보 미확정)은 제외", () => {
    const entries = recheckUsages(준용규정, usages, lookup, attachedOf);
    expect(entries).toHaveLength(1);
    expect(entries[0].usage.ownerId).toBe("cov-수술비");
    expect(entries[0].missing).toEqual(["D0002"]);
    expect(entries[0].issues[0]).toMatchObject({ kind: "notAttached", at: { document: "coverageMaster", ownerId: "cov-수술비", ownerName: "수술비", refPath: "D0002" } });
  });

  it("옵션이 나중에 생기거나 삭제되면 미선택·깨진 선택을 가진 사용처가 목록에 오른다 (S5 · S7 경계)", () => {
    const withNewOption: BlockClause = {
      ...준용규정,
      required: { discriminators: [], attributes: [] },
      options: [
        ...준용규정.options,
        { code: "O02", label: "새 옵션", order: 1, values: [
          { code: "V01", label: "a", order: 0, body: [] },
          { code: "V02", label: "b", order: 1, body: [] },
        ] },
      ],
    };
    const entries = recheckUsages(withNewOption, usages, lookup, attachedOf);
    expect(entries.map((e) => e.usage.documentId)).toEqual(["doc-1", "doc-2", "doc-3"]);
    expect(entries[0].issues.map((i) => i.kind)).toEqual(["optionUnselected"]);

    const optionGone: BlockClause = { ...준용규정, required: { discriminators: [], attributes: [] }, options: [] };
    const gone = recheckUsages(optionGone, usages, lookup, attachedOf);
    expect(gone.every((e) => e.issues[0].kind === "optionInvalid")).toBe(true);
  });

  it("요구 구분자를 읽지 않게 되는 수정(제거)은 부착 위반을 만들지 않는다 — 목록이 비어 있다", () => {
    const shrunk: BlockClause = { ...준용규정, required: { discriminators: [], attributes: [] } };
    expect(recheckUsages(shrunk, usages, lookup, attachedOf)).toEqual([]);
  });

  it("선택 정보가 없는 사용처는 옵션 검사를 건너뛴다 (부착만 본다)", () => {
    const noSel: Usage[] = [{ documentId: "d", ownerKind: "coverage", ownerId: "cov-상해사망" }];
    expect(recheckUsages(준용규정, noSel, lookup, attachedOf)).toEqual([]);
  });
});
