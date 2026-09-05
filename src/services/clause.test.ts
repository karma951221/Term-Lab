import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Block, Inline, Usage } from "@/domain/clause";
import type { Actor } from "@/domain/types";

import { insertDiscriminator } from "@/db/repo/catalog";
import { attach, listAttached } from "@/db/repo/values";
import { createTestDb, type TestDb } from "@/db/test-utils";
import { createClauseService, type Attacher, type ClauseService, type UsageSource } from "./clause";

const admin: Actor = { userId: "00000000-0000-4000-8000-000000000001", role: "admin" };
const editor: Actor = { userId: "00000000-0000-4000-8000-000000000002", role: "editor" };

const 수술비 = "11111111-1111-4111-8111-111111111111";
const 상해사망 = "22222222-2222-4222-8222-222222222222";

function unwrap<T>(r: { ok: true; value: T } | { ok: false; rejection: unknown }): T {
  if (!r.ok) throw new Error(`기대: ok, 실제: ${JSON.stringify(r.rejection)}`);
  return r.value;
}

function reasonOf(r: { ok: true } | { ok: false; rejection: { reason: string } }): string {
  if (r.ok) throw new Error("기대: 거부, 실제: ok");
  return r.rejection.reason;
}

const 준용_본문: Block[] = [
  { id: "p1", kind: "paragraph", children: [
    { id: "t1", kind: "text", text: "이 특별약관에서 정하지 않은 사항은 " },
    { id: "c1", kind: "inlineCond", branches: [
      { id: "b1", when: "D0001", children: [{ id: "t2", kind: "text", text: "최초계약일" }] },
      { id: "b2", children: [{ id: "t3", kind: "text", text: "계약일" }] },
    ] },
  ] },
];

describe("clause 서비스 (PGlite)", () => {
  let t: TestDb;
  let svc: ClauseService;
  /** 사용처 흉내 — C1/B3 가 줄 것. 테스트가 직접 채운다. */
  const usages = new Map<string, Usage[]>();
  const usageSource: UsageSource = { documentsReferencing: async (code) => usages.get(code) ?? [] };
  const attachCalls: string[] = [];
  const attacher: Attacher = {
    attach: async (actor, owner, code) => {
      attachCalls.push(`${actor.role}:${owner.id}:${code}`);
      await attach(t.db, owner, code, actor.userId);
      return { ok: true, value: undefined };
    },
  };

  beforeAll(async () => {
    t = await createTestDb();
    svc = createClauseService(t.db, { usage: usageSource, attacher });
    // 카탈로그: 갱신여부(무조건 노출) · 수술급여기준(선택 노출 · 담보) · 고지유형(상품)
    await insertDiscriminator(t.db, { kind: "scalar", code: "D0001", label: "갱신여부", description: "", level: "coverage", alwaysExposed: true, type: { kind: "boolean" } }, admin.userId);
    await insertDiscriminator(t.db, { kind: "scalar", code: "D0002", label: "수술급여기준", description: "", level: "coverage", alwaysExposed: false, type: { kind: "string" } }, admin.userId);
    await insertDiscriminator(t.db, { kind: "scalar", code: "D0003", label: "고지유형", description: "", level: "product", alwaysExposed: false, type: { kind: "string" } }, admin.userId);
  });
  afterAll(async () => {
    await t.close();
  });

  describe("S1 — 정의 · 요구 구분자 · 목록", () => {
    it("편집자가 block 「준용규정」을 채번하면 C0001, 요구 구분자에 갱신여부(D0001)가 자동 추출된다", async () => {
      const c = unwrap(await svc.create(editor, { label: "준용규정", mode: "block", body: 준용_본문 }));
      expect(c.code).toBe("C0001");
      expect(await svc.required("C0001")).toEqual({ discriminators: ["D0001"], attributes: [] });
      expect(await svc.get("C0001")).toEqual(c);
    });

    it("식이 없는 「특별약관의 소멸」의 요구 구분자는 빈 목록 · 표시명 중복은 duplicate", async () => {
      const c = unwrap(await svc.create(editor, { label: "특별약관의 소멸", mode: "block", body: [{ id: "p", kind: "paragraph", children: [{ id: "t", kind: "text", text: "소멸합니다." }] }] }));
      expect(c.code).toBe("C0002");
      expect(c.required.discriminators).toEqual([]);
      expect(reasonOf(await svc.create(editor, { label: "준용규정", mode: "inline" }))).toBe("duplicate");
    });

    it("조건식이 boolean 이 아니면 카탈로그 타입으로 잡아 거부한다 (typeMismatch)", async () => {
      const body: Block[] = [{ id: "cb", kind: "condBlock", branches: [{ id: "b", when: "D0002", children: [] }] }];
      const r = await svc.create(editor, { label: "x", mode: "block", body });
      expect(reasonOf(r)).toBe("invalid");
      if (!r.ok && r.rejection.reason === "invalid") expect(r.rejection.issues[0].kind).toBe("typeMismatch");
    });

    it("없는 구분자를 읽는 식은 brokenRef 로 거부한다", async () => {
      const body: Inline[] = [{ id: "s", kind: "slot", ref: "D0099" }];
      const r = await svc.create(editor, { label: "x", mode: "inline", body });
      if (!r.ok && r.rejection.reason === "invalid") expect(r.rejection.issues[0].kind).toBe("brokenRef");
      expect(r.ok).toBe(false);
    });

    it("목록 요약은 코드 · 표시명 · 모드 · 사용처 수", async () => {
      usages.set("C0001", [
        { documentId: "doc-수술비", ownerKind: "coverage", ownerId: 수술비, ownerName: "수술비", selection: {} },
        { documentId: "doc-상해사망", ownerKind: "coverage", ownerId: 상해사망, ownerName: "일반상해사망", selection: {} },
      ]);
      expect(await svc.summaries()).toEqual([
        { code: "C0001", label: "준용규정", mode: "block", usageCount: 2 },
        { code: "C0002", label: "특별약관의 소멸", mode: "block", usageCount: 0 },
      ]);
      expect((await svc.usages("C0001")).map((u) => u.ownerName)).toEqual(["수술비", "일반상해사망"]);
      expect((await svc.list()).length).toBe(2);
    });

    it("표시명·설명 변경은 편집자 자유, 코드 불변", async () => {
      expect(unwrap(await svc.rename(editor, "C0002", "특별약관의 소멸(일반형)")).label).toBe("특별약관의 소멸(일반형)");
      expect(unwrap(await svc.setDescription(editor, "C0002", "실물 10건 공통")).description).toBe("실물 10건 공통");
      expect(reasonOf(await svc.rename(editor, "C0002", "준용규정"))).toBe("duplicate");
      expect(reasonOf(await svc.rename(editor, "C0099", "x"))).toBe("notFound");
    });
  });

  describe("S2 — 참조 추가 시 부착 검사 · 제안 수락", () => {
    it("준비: 「준용규정」이 선택적 노출 구분자 「수술급여기준」을 읽게 수정 → 저장은 성립하고(D-P3-8) 미부착 담보 2건이 재검사 목록에 오른다", async () => {
      const body: Block[] = [...준용_본문, { id: "cb", kind: "condBlock", branches: [{ id: "b", when: "D0002 = '기준A'", children: [] }] }];
      const { clause, recheck } = unwrap(await svc.setBody(editor, "C0001", body));
      expect(clause.required.discriminators).toEqual(["D0001", "D0002"]);
      expect(recheck.map((e) => [e.usage.ownerName, e.missing])).toEqual([["수술비", ["D0002"]], ["일반상해사망", ["D0002"]]]);
      expect((await svc.get("C0001"))?.required.discriminators).toEqual(["D0001", "D0002"]);
    });

    it("수술비 담보에 참조 추가 시도 → 미부착 「수술급여기준」을 즉시 알린다", async () => {
      const r = unwrap(await svc.checkReference("C0001", { kind: "coverage", id: 수술비 }));
      expect(r.missing).toEqual(["D0002"]);
      expect(r.issues[0].kind).toBe("notAttached");
      expect(reasonOf(await svc.checkReference("C0099", { kind: "coverage", id: 수술비 }))).toBe("notFound");
    });

    it("부착 제안 수락 → 주입된 Attacher 로 그 자리에서 부착되고 검사가 비워진다", async () => {
      const attached = unwrap(await svc.acceptAttachments(editor, "C0001", { kind: "coverage", id: 수술비 }));
      expect(attached).toEqual(["D0002"]);
      expect(attachCalls).toEqual([`editor:${수술비}:D0002`]);
      expect(await listAttached(t.db, { kind: "coverage", id: 수술비 })).toEqual(["D0002"]);
      expect(unwrap(await svc.checkReference("C0001", { kind: "coverage", id: 수술비 })).missing).toEqual([]);
      // 이미 부착돼 있으면 Attacher 를 부르지 않는다
      expect(unwrap(await svc.acceptAttachments(editor, "C0001", { kind: "coverage", id: 수술비 }))).toEqual([]);
      expect(attachCalls.length).toBe(1);
    });

    it("Attacher 미주입이면 수락은 거부된다 (B1 이 연결해야 한다)", async () => {
      const bare = createClauseService(t.db, { usage: usageSource });
      expect(reasonOf(await bare.acceptAttachments(editor, "C0001", { kind: "coverage", id: 상해사망 }))).toBe("invalid");
    });
  });

  describe("S3 — 재검사 목록", () => {
    it("recheck: 부착한 수술비는 빠지고 미부착 일반상해사망만 남는다 (listOwnersAttaching 기반)", async () => {
      const entries = unwrap(await svc.recheck("C0001"));
      expect(entries.map((e) => e.usage.ownerName)).toEqual(["일반상해사망"]);
      expect(entries[0].issues[0].at).toMatchObject({ document: "coverageMaster", ownerId: 상해사망, refPath: "D0002" });
      expect(reasonOf(await svc.recheck("C0099"))).toBe("notFound");
    });

    it("사용처 소스 미주입이면 재검사 목록은 비어 있다 (기본 빈 목록)", async () => {
      const bare = createClauseService(t.db);
      expect(unwrap(await bare.recheck("C0001"))).toEqual([]);
      expect(await bare.summaries()).toMatchObject([{ code: "C0001", usageCount: 0 }, { code: "C0002", usageCount: 0 }]);
    });
  });

  describe("S5 · S7 — 옵션", () => {
    it("옵션 추가 → 기존 사용처(미선택)가 재검사 목록에 오른다 (optionUnselected)", async () => {
      const { clause, recheck } = unwrap(
        await svc.addOption(editor, "C0001", { label: "준용 대상", values: [{ label: "보통약관" }, { label: "기본계약", body: [{ id: "v2", kind: "slot", ref: "D0003" }] }] }),
      );
      expect(clause.options[0].code).toBe("O01");
      expect(clause.required.discriminators).toEqual(["D0001", "D0002", "D0003"]);
      expect(recheck.map((e) => e.issues.map((i) => i.kind))).toEqual([["optionUnselected"], ["notAttached", "optionUnselected"]]);
    });

    it("선택지 추가·표시명·문구·순서 변경, 선택지 삭제(2개 유지 규칙), 옵션 삭제(본문 사용 중이면 거부)", async () => {
      let r = unwrap(await svc.addOptionValue(editor, "C0001", "O01", { label: "특별약관" }));
      expect(r.clause.options[0].values.map((v) => v.code)).toEqual(["V01", "V02", "V03"]);
      expect(unwrap(await svc.renameOption(editor, "C0001", "O01", "준용 문서")).options[0].label).toBe("준용 문서");
      expect(unwrap(await svc.renameOptionValue(editor, "C0001", "O01", "V03", "특약")).options[0].values[2].label).toBe("특약");
      r = unwrap(await svc.setOptionValueBody(editor, "C0001", "O01", "V01", [{ id: "v1", kind: "text", text: "보통약관" }]));
      expect(r.clause.options[0].values[0].body).toEqual([{ id: "v1", kind: "text", text: "보통약관" }]);
      expect(unwrap(await svc.reorderOptionValues(editor, "C0001", "O01", ["V03", "V01", "V02"])).options[0].values[0].code).toBe("V03");
      expect(unwrap(await svc.reorderOptions(editor, "C0001", ["O01"])).options.length).toBe(1);

      r = unwrap(await svc.removeOptionValue(editor, "C0001", "O01", "V03"));
      expect(r.clause.options[0].values.map((v) => v.code)).toEqual(["V01", "V02"]);
      expect(reasonOf(await svc.removeOptionValue(editor, "C0001", "O01", "V02"))).toBe("minimumStructure");

      // 본문이 옵션 자리를 쓰는 동안은 옵션 삭제 거부
      const using: Block[] = [{ id: "p", kind: "paragraph", children: [{ id: "o", kind: "optionSlot", optionCode: "O01" }] }];
      unwrap(await svc.setBody(editor, "C0001", using));
      expect(reasonOf(await svc.removeOption(editor, "C0001", "O01"))).toBe("invalid");
      unwrap(await svc.setBody(editor, "C0001", 준용_본문));
      r = unwrap(await svc.removeOption(editor, "C0001", "O01"));
      expect(r.clause.options).toEqual([]);
      expect(r.clause.required.discriminators).toEqual(["D0001"]);
    });

    it("선택지 삭제로 깨진 선택을 가진 사용처는 재검사 목록에 오른다", async () => {
      const { clause } = unwrap(await svc.addOption(editor, "C0001", { label: "x", values: [{ label: "a" }, { label: "b" }, { label: "c" }] }));
      usages.set("C0001", [{ documentId: "doc-수술비", ownerKind: "coverage", ownerId: 수술비, selection: { [clause.options[0].code]: "V03" } }]);
      const { recheck } = unwrap(await svc.removeOptionValue(editor, "C0001", clause.options[0].code, "V03"));
      expect(recheck[0].issues[0].kind).toBe("optionInvalid");
      usages.delete("C0001");
    });
  });

  describe("모드 변경 · 복제 · 삭제", () => {
    it("모드 변경은 새 본문과 함께 — 요구 구분자 재계산", async () => {
      const { clause } = unwrap(await svc.setMode(editor, "C0002", "inline", [{ id: "s", kind: "slot", ref: "D0003" }]));
      expect(clause.mode).toBe("inline");
      expect(clause.required.discriminators).toEqual(["D0003"]);
    });

    it("복제 — 새 코드 · 「(복제)」 접미 · 본문·옵션 복사 (D-P3-3)", async () => {
      const copy = unwrap(await svc.duplicate(editor, "C0001"));
      expect(copy.code).toBe("C0003");
      expect(copy.label).toBe("준용규정(복제)");
      expect(copy.body).toEqual((await svc.get("C0001"))?.body);
      expect(copy.options.map((o) => o.code)).toEqual(["O01"]);
      expect(await svc.get("C0003")).toEqual(copy);
    });

    it("삭제 — 편집자 forbidden · 관리자 1차는 사용처를 brokenRefs 로 보여주고 · confirm 후 삭제", async () => {
      usages.set("C0003", [{ documentId: "doc-1", ownerKind: "general", ownerId: "gen-1", ownerName: "보통약관 A", refNodeId: "ref-9" }]);
      expect(await svc.remove(editor, "C0003")).toEqual({ ok: false, rejection: { reason: "forbidden", role: "editor", action: "clause.delete" } });

      const first = await svc.remove(admin, "C0003");
      expect(first.ok).toBe(false);
      if (!first.ok && first.rejection.reason === "needsConfirmation") {
        expect(first.rejection.impact.valueRowsLost).toBe(0);
        expect(first.rejection.impact.brokenRefs).toEqual([{ document: "general", ownerId: "gen-1", ownerName: "보통약관 A", nodePath: ["ref-9"] }]);
        // 복제본은 옵션 코드를 자기 범위에서 다시 채번한다 (원본은 O02 였음)
        expect(first.rejection.impact.cascade).toEqual(["옵션 x(O01)"]);
      } else {
        throw new Error("needsConfirmation 기대");
      }
      unwrap(await svc.remove(admin, "C0003", { confirm: true }));
      expect(await svc.get("C0003")).toBeUndefined();
      expect(reasonOf(await svc.remove(admin, "C0003"))).toBe("notFound");
    });
  });
});
