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
      out.push(`  ${p.label} ${inline(p.children)}`);
      for (const it of p.items ?? []) {
        if (it.kind === "error") continue;
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
  });

  it("특약 2벌 산출 — 본문은 완전 동일하고 제목만 다르다 (문면 1벌 + 탑재 구별)", () => {
    expect(booklet.specials).toHaveLength(1);
    const [group] = booklet.specials;
    expect(group.title).toBe("상해 관련 특별약관");
    expect(group.docs.map((d) => d.title)).toEqual(["일반상해사망보장 특별약관", "일반상해사망보장 추가 특별약관"]);
    expect(group.docs.map((d) => d.ownerId)).toEqual(["pc-basic", "pc-addon"]);
    expect(lines(group.docs[0])).toEqual(lines(group.docs[1]));
  });

  it("특약 본문 — 인라인 조건(계약일) · const 슬롯(2.5%) · 파생 조건(면책여부합 → 제2조 산다) · number 슬롯 · 옵션 해소 · 준용규정 생략", () => {
    expect(lines(booklet.specials[0].docs[0])).toEqual([
      "제1조(보험금의 지급사유)",
      "  ① 회사는 피보험자가 계약일 이후 상해로 사망한 경우 사망보험금을 지급합니다.",
      "  ② 사망보험금은 보험가입금액에 평균공시이율 2.5% 을 적용하여 계산합니다.",
      "제2조(보험금을 지급하지 않는 사유)",
      "  ① 회사는 다음 중 어느 한 가지로 보험금 지급사유가 발생한 때에는 보험금을 지급하지 않습니다.",
      "    1. 피보험자가 고의로 자신을 해친 경우",
      "    2. 보험수익자가 고의로 피보험자를 해친 경우",
      "      가. 다만, 그 보험수익자가 보험금의 일부 보험수익자인 경우에는 다른 보험수익자에 대한 보험금은 지급합니다.",
      "제3조(보험금의 감액지급)",
      "  ① 계약일부터 24개월 이내에 발생한 사망에 대해서는 사망보험금의 50%를 지급합니다.",
      "제4조(특별약관의 소멸)",
      "  ① 이 특별약관은 다음의 경우 소멸합니다.",
      "  ② 이 특별약관은 피보험자가 사망한 때 소멸합니다.",
    ]);
  });

  it("준용규정 조는 조연결 생략 판정 통과 — 탑재분 둘 다 기록되고 문서에서 빠진다 (ADR-0014)", () => {
    expect(booklet.omitted).toEqual([
      { productCoverageId: "pc-basic", productCoverageName: "일반상해사망보장", articleId: "s-art-apply", articleTitle: "준용규정", linkedArticleId: "g-art-apply" },
      { productCoverageId: "pc-addon", productCoverageName: "일반상해사망보장 추가", articleId: "s-art-apply", articleTitle: "준용규정", linkedArticleId: "g-art-apply" },
    ]);
  });

  it("보통약관 — 담보 레벨 참조(갱신여부)는 기본계약으로 해소 · 상품 레벨 enum 슬롯은 표시명 · 준용 문구의 조 참조는 제1조(용어의 정의)", () => {
    expect(lines(booklet.general!)).toEqual([
      "제1조(용어의 정의)",
      "  ① 이 계약에서 사용하는 용어의 정의는 다음과 같습니다.",
      "제2조(보험금의 지급사유)",
      "  ① 회사는 피보험자가 계약일 이후 기본계약의 보험금 지급사유가 발생한 때 보험금을 지급합니다.",
      "  ② 이 계약은 간편심사 계약입니다.",
      "제3조(장해의 분류)",
      "  ① 장해의 분류는 【별표1(장해분류표)】 에 따릅니다.",
      "제4조(준용규정)",
      "  ① 이 약관에서 정하지 않은 사항은 보통약관 제1조(용어의 정의) 및 관계 법령을 따릅니다.",
    ]);
  });

  it("별표 — 참조된 장해분류표 1건만, 번호 1, 최초 등장 좌표는 보통약관 제3조 (화상 분류표는 0회)", () => {
    expect(booklet.appendices).toHaveLength(1);
    expect(booklet.appendices[0]).toMatchObject({ code: "APX_DISABILITY", name: "장해분류표", number: 1, firstAt: { document: "general", articleId: "g-art-disability" } });
  });

  it("조립 문맥 조회(D-P6-7) — 실행이 읽은 값 자리가 상품담보별로 남는다 (보통약관이 읽은 갱신여부는 기본계약에)", () => {
    const basic = booklet.trace.find((t) => t.productCoverageId === "pc-basic")!;
    expect(basic.reads.map((r) => `${r.owner.kind}:${r.path}`).sort()).toEqual(["product:D0002", "productBenefit:D0003.F01", "productCoverage:D0001", "productCoverage:D0006"]);
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
