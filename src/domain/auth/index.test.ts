import { describe, expect, it } from "vitest";

import { type Actor, type Impact, ok, reject } from "../types";
import { assertCan, can, DESTRUCTIVE_ACTIONS, destructive, isDestructiveAction } from "./index";

const admin: Actor = { userId: "u-admin", role: "admin" };
const editor: Actor = { userId: "u-editor", role: "editor" };

describe("역할권한 S1 — 편집자: 파괴적 액션은 서버가 거부", () => {
  it("편집자의 파괴적 액션(구분자 삭제)은 forbidden 으로 거부된다 — 사유에 역할·액션이 실린다", () => {
    expect(can(editor, "catalog.delete")).toBe(false);
    const r = assertCan(editor, "catalog.delete");
    expect(r).toEqual({
      ok: false,
      rejection: { reason: "forbidden", role: "editor", action: "catalog.delete" },
    });
  });

  it("관리자는 파괴적 액션을 할 수 있다", () => {
    expect(can(admin, "catalog.delete")).toBe(true);
    expect(assertCan(admin, "coverage.deleteNode")).toEqual({ ok: true, value: undefined });
  });

  it("파괴적 액션 목록은 정의·타입·필드·enum 값·트리·부착·문면·상품 영역을 미리 덮는다", () => {
    for (const a of [
      "catalog.delete",
      "catalog.changeType",
      "catalog.deleteField",
      "enum.deleteValue",
      "enum.delete",
      "coverage.deleteNode",
      "coverage.detach",
      "clause.delete",
      "document.delete",
      "product.delete",
      "product.unmount",
      "product.detachPlan",
      "appendix.delete",
      "attribute.delete",
      "attribute.deleteValue",
    ]) {
      expect(DESTRUCTIVE_ACTIONS).toContain(a);
      expect(isDestructiveAction(a)).toBe(true);
    }
    expect(isDestructiveAction("catalog.rename")).toBe(false);
  });
});

describe("역할권한 S3·S4 — 파괴적 액션 2단 프로토콜 (ADR-0019)", () => {
  const impact: Impact = { valueRowsLost: 3, brokenRefs: [], cascade: ["F01"] };

  it("1차 호출(confirm 없음) → 영향을 계산해 needsConfirmation 으로 거부하고 실행하지 않는다", async () => {
    let executed = false;
    const r = await destructive({
      actor: admin,
      action: "catalog.deleteField",
      computeImpact: async () => impact,
      execute: async () => {
        executed = true;
        return ok("done");
      },
    });
    expect(r).toEqual({ ok: false, rejection: { reason: "needsConfirmation", impact } });
    expect(executed).toBe(false);
  });

  it("confirm:true 재호출 → 실행하고 결과를 돌려준다", async () => {
    const r = await destructive({
      actor: admin,
      action: "catalog.deleteField",
      confirm: true,
      computeImpact: async () => impact,
      execute: async () => ok("done"),
    });
    expect(r).toEqual({ ok: true, value: "done" });
  });

  it("편집자의 파괴적 호출은 Impact 계산 전에 forbidden — computeImpact 도 호출되지 않는다", async () => {
    let computed = false;
    const r = await destructive({
      actor: editor,
      action: "catalog.deleteField",
      confirm: true,
      computeImpact: async () => {
        computed = true;
        return impact;
      },
      execute: async () => ok("done"),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejection.reason).toBe("forbidden");
    expect(computed).toBe(false);
  });

  it("최소 구조 위반(precheck 거부)은 관리자도 거부 — confirm 이 있어도 실행되지 않는다", async () => {
    let executed = false;
    const r = await destructive({
      actor: admin,
      action: "coverage.deleteNode",
      confirm: true,
      precheck: async () => ({
        ok: false,
        rejection: { reason: "minimumStructure", what: "담보의 마지막 세부보장" },
      }),
      computeImpact: async () => impact,
      execute: async () => {
        executed = true;
        return ok("done");
      },
    });
    expect(r).toEqual({
      ok: false,
      rejection: { reason: "minimumStructure", what: "담보의 마지막 세부보장" },
    });
    expect(executed).toBe(false);
  });

  it("execute 가 Result 를 돌려주면 그대로 전달한다 (notFound 등)", async () => {
    const r = await destructive({
      actor: admin,
      action: "catalog.delete",
      confirm: true,
      computeImpact: async () => impact,
      execute: async () => reject({ reason: "notFound", what: "구분자 D9999" }),
    });
    expect(r).toEqual({ ok: false, rejection: { reason: "notFound", what: "구분자 D9999" } });
  });
});
