import { readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Booklet } from "@/domain/assembly";
import { diffByArticle, renderedToLines, sourceToLines } from "@/domain/assembly/compare";
import type { Actor } from "@/domain/types";

import { createTestDb, type TestDb } from "@/db/test-utils";
import { createServices } from "@/services/container";

import { loadAlphaPlus } from "./load";

/**
 * ★ 실물 재현 — 알파Plus 시드가 원문(`tests/fixtures/terms`)과 같은 약관을 조립한다.
 * 대조 기준: 조 순서 + 조 명, 조 번호 참조는 조 명으로 정규화, 공백 무시 (compare.ts).
 */

const FIXTURES = path.join(process.cwd(), "tests/fixtures/terms");
const source = (file: string) => sourceToLines(readFileSync(path.join(FIXTURES, file), "utf8"));

/** 다른 조를 사람이 읽을 수 있게 — 실패 메시지용. */
function describeDiffs(diffs: ReturnType<typeof diffByArticle>): string {
  return diffs
    .slice(0, 3)
    .map((d) => `\n── 조 #${d.index + 1} 「${d.title}」\n  기대:\n${d.expected.map((l) => `    ${l}`).join("\n")}\n  실제:\n${d.actual.map((l) => `    ${l}`).join("\n")}`)
    .join("\n");
}

describe("★ 실물 재현 — 알파Plus 시드 → 조립 → 원문 대조", () => {
  let db: TestDb;
  let booklet: Booklet;

  beforeAll(async () => {
    db = await createTestDb();
    const services = createServices(db.db);
    const admin = await services.auth.ensureSeedAdmin();
    const actor: Actor = { userId: admin.id, role: admin.role };
    const { productId } = await loadAlphaPlus(services, actor);
    const r = await services.assembly.preview(productId);
    if (!r.ok) throw new Error(JSON.stringify(r.rejection));
    booklet = r.value;
  }, 60_000);

  afterAll(async () => {
    await db.close();
  });

  it("완성본이다 — 오류 0", () => {
    expect(booklet.issues).toEqual([]);
    expect(booklet.complete).toBe(true);
  });

  it("보통약관 52조(관 7)가 원문과 같다 — 기본계약 대치 포함", () => {
    const diffs = diffByArticle(source("보통약관.md"), renderedToLines(booklet.general!));
    expect(diffs, describeDiffs(diffs)).toEqual([]);
  });

  it.each([
    ["일반상해사망보장 특별약관", "일반상해사망보장.md"],
    ["일반상해사망보장 추가 특별약관", "일반상해사망보장_추가.md"],
    ["일반상해80%이상후유장해 생활자금보장 특별약관", "일반상해80%이상후유장해_생활자금보장.md"],
    ["골절(치아파절 제외)진단비Ⅱ보장 특별약관", "골절(치아파절_제외)진단비Ⅱ보장.md"],
  ])("특약 「%s」이 원문과 같다", (title, file) => {
    const docs = booklet.specials.flatMap((g) => g.docs);
    const doc = docs.find((d) => d.title === title);
    expect(doc, `특약 「${title}」 없음 — 있는 것: ${docs.map((d) => d.title).join(" · ")}`).toBeDefined();
    const diffs = diffByArticle(source(file), renderedToLines(doc!));
    expect(diffs, describeDiffs(diffs)).toEqual([]);
  });
});
