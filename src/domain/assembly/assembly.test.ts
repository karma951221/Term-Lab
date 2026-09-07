import { describe, expect, it } from "vitest";

import { assemble, assembleSpecial } from "./booklet";
import { alphaPlusFixture } from "./fixture";
import type { RenderedDoc, RenderedInline } from "./types";

/** 렌더 문서를 사람이 읽는 줄로 — 본문 동일성 단언용 (제목 제외). */
function lines(doc: RenderedDoc): string[] {
  const inline = (list: RenderedInline[]) =>
    list.map((n) => (n.kind === "text" ? n.text : n.kind === "error" ? `⟦${n.issue.kind}⟧` : n.label)).join("");
  const out: string[] = [];
  for (const a of doc.children) {
    if (a.kind === "error") {
      out.push(`⟦${a.issue.kind}⟧`);
      continue;
    }
    out.push(`${a.label}(${a.title})`);
    for (const p of a.children) {
      if (p.kind === "error") {
        out.push(`  ⟦${p.issue.kind}⟧`);
        continue;
      }
      if (p.kind !== "paragraph") {
        out.push(`  [${p.kind}]`);
        continue;
      }
      out.push(`  ${p.label} ${inline(p.children)}`);
      for (const it of p.items ?? []) {
        if (it.kind !== "item") continue;
        out.push(`    ${it.label} ${inline(it.children)}`);
        for (const s of it.subitems ?? []) if (s.kind !== "error") out.push(`      ${s.label} ${inline(s.children)}`);
      }
    }
  }
  return out;
}

describe("★ 관통 1 — 알파Plus(축약): 보통약관 + 일반상해사망보장(+추가) 조립", () => {
  const booklet = assemble(alphaPlusFixture());

  it("문서트리 스냅샷 — 보통약관 · 그룹 「상해 관련 특별약관」 · 특약 2벌 · 별표 목록", () => {
    expect({ general: booklet.general, specials: booklet.specials, appendices: booklet.appendices, omitted: booklet.omitted }).toMatchSnapshot();
  });

  it("조립오류 S1 — 오류 0건 · 완성본 (issues 비어 있고 complete=true)", () => {
    expect(booklet.issues).toEqual([]);
    expect(booklet.complete).toBe(true);
    expect(booklet.undocumented).toEqual([]);
    expect(booklet.baseContracts).toEqual([{ productCoverageId: "pc-base", name: "상해사망(기본계약)", coverageId: "cov-base-death" }]);
  });

  it("특약 2벌 산출 — 본문은 완전 동일하고 제목만 다르다 (문면 1벌 + 탑재 구별)", () => {
    expect(booklet.specials).toHaveLength(1);
    const [group] = booklet.specials;
    expect(group.title).toBe("상해 관련 특별약관");
    expect(group.docs.map((d) => d.title)).toEqual(["일반상해사망 특별약관", "일반상해사망 추가 특별약관"]);
    expect(group.docs.map((d) => d.ownerId)).toEqual(["pc-basic", "pc-addon"]);
    expect(lines(group.docs[0])).toEqual(lines(group.docs[1]));
  });

  it("특약 본문 — 전체수록 · 생략 · 일부준용을 적용하고 준용규정을 자동 보충한다", () => {
    expect(lines(booklet.specials[0].docs[0])).toEqual([
      "제1조(보험금의 지급사유)",
      "   회사는 피보험자가 계약일 이후 상해로 사망한 경우 사망보험금을 지급합니다. 평균공시이율 2.5%를 적용합니다.",
      "제2조(보험금의 감액지급)",
      "  ① 이 특별약관의 보험금의 감액지급은 보통약관 제6조(해약환급금)를 준용합니다.",
      "  ② 계약일부터 24개월 이내에는 감액 지급하며, 보통약관 제6조(해약환급금) 제1항 및 제2항을 확인합니다.",
      "제3조(특별약관의 소멸)",
      "   이 특별약관은 피보험자가 사망한 때 소멸합니다.",
      "제4조(준용규정)",
      "   이 특별약관에서 정하지 않은 사항은 보통약관을 따릅니다.",
    ]);
  });

  it("연결 조 판정은 탑재분마다 전체수록 · 생략 · 일부준용으로 기록된다", () => {
    expect(booklet.omitted.map(({ productCoverageId, articleId, disposition }) => [productCoverageId, articleId, disposition])).toEqual([
      ["pc-basic", "s-art-pay", "full"],
      ["pc-basic", "s-art-exempt", "omitted"],
      ["pc-basic", "s-art-reduce", "applied"],
      ["pc-addon", "s-art-pay", "full"],
      ["pc-addon", "s-art-exempt", "omitted"],
      ["pc-addon", "s-art-reduce", "applied"],
    ]);
  });

  it("보통약관 — 기본계약 연결 조문으로 본문을 교체하고 제외 표시 문단은 그대로 수록한다", () => {
    expect(lines(booklet.general!)).toEqual([
      "제1조(용어의 정의)",
      "   이 계약에서 사용하는 용어의 정의는 다음과 같습니다.",
      "제2조(보험금의 지급사유)",
      "   피보험자가 보험기간 중 상해로 사망한 경우 보험금을 지급합니다.",
      "제3조(보험금 지급에 관한 세부규정)",
      "   보험금 지급에 관한 세부사항은 산출방법서에 따릅니다.",
      "제4조(보험금을 지급하지 않는 사유)",
      "  ① 고의로 사고를 일으킨 경우에는 보험금을 지급하지 않습니다.",
      "  ② 법령에 따라 보험금 지급이 제한되는 경우에는 보험금을 지급하지 않습니다.",
      "제5조(장해의 분류)",
      "   장해의 분류는 【별표1(장해분류표)】 에 따릅니다.",
      "제6조(해약환급금)",
      "  ① 계약이 해지된 경우 해약환급금을 지급합니다.",
      "  ② 해약환급금은 산출방법서에 따라 계산합니다.",
    ]);
  });

  it("별표 — 참조된 장해분류표 1건만, 번호 1, 최초 등장 좌표는 보통약관 제3조 (화상 분류표는 0회)", () => {
    expect(booklet.appendices).toHaveLength(1);
    expect(booklet.appendices[0]).toMatchObject({ code: "APX_DISABILITY", name: "장해분류표", number: 1, firstAt: { document: "general", articleId: "g-art-disability" } });
  });

  it("조립 문맥 조회(D-P6-7) — 특약이 실제로 읽은 값 자리만 상품담보별로 남는다", () => {
    const basic = booklet.trace.find((t) => t.productCoverageId === "pc-basic")!;
    expect(basic.reads.map((r) => `${r.owner.kind}:${r.path}`).sort()).toEqual(["productBenefit:D0003.F01", "productCoverage:D0007"]);
    expect(basic.reads.find((r) => r.path === "D0003.F01")?.masterId).toBe("ben-death");
  });

  it("상품담보 미리보기 — 「일반상해사망보장 추가」 하나만 조립해도 책자와 같은 본문·번호", () => {
    const r = assembleSpecial(alphaPlusFixture(), "pc-addon");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(lines(r.value.doc)).toEqual(lines(booklet.specials[0].docs[1]));
    expect(r.value.complete).toBe(true);
    expect(r.value.appendices.map((a) => a.code)).toEqual(["APX_DISABILITY"]);
    expect(assembleSpecial(alphaPlusFixture(), "pc-none").ok).toBe(false);
  });
});
