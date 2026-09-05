import { describe, expect, it } from "vitest";

import { createAppendix, renameAppendix, setAppendixDescription } from "./appendix";

describe("별표 마스터 (D-P4-23 — 코드 유저 입력 · 등록 후 불변 · 중복 거부)", () => {
  it("코드·이름으로 등록한다 — 설명은 비워도 된다", () => {
    const r = createAppendix({ code: "APX_BURN", name: "화상 분류표" }, []);
    expect(r).toEqual({ ok: true, value: { code: "APX_BURN", name: "화상 분류표", description: "" } });
  });

  it("코드 중복 → duplicate · 빈 코드 · 공백 포함 코드 · 빈 이름 → invalid", () => {
    expect(createAppendix({ code: "APX_BURN", name: "x" }, ["APX_BURN"])).toEqual({
      ok: false,
      rejection: { reason: "duplicate", what: "별표 코드 APX_BURN" },
    });
    for (const code of ["", "  ", "APX BURN"]) {
      const r = createAppendix({ code, name: "x" }, []);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.rejection.reason).toBe("invalid");
    }
    expect(createAppendix({ code: "APX", name: " " }, []).ok).toBe(false);
  });

  it("이름·설명 수정은 코드를 바꾸지 않는다 — 빈 이름은 거부", () => {
    const a = { code: "APX_BURN", name: "화상 분류표", description: "" };
    expect(renameAppendix(a, "화상분류표")).toEqual({ ok: true, value: { ...a, name: "화상분류표" } });
    expect(renameAppendix(a, "").ok).toBe(false);
    expect(setAppendixDescription(a, "설명")).toEqual({ ok: true, value: { ...a, description: "설명" } });
  });
});
