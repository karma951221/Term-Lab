/**
 * E2E 대조 헬퍼 — 원문(파싱양식 `.md`)과 미리보기 DOM 을 같은 규칙으로 「조 제목 + 본문 덩어리」로 만든다.
 *
 * 기준은 `src/domain/assembly/compare.ts` 와 같다: 조 순서 + 조 명, 조 번호 참조는 조 명으로 정규화, 공백 무시.
 * DOM 쪽은 항 마커(①…⑳)와 그림 박스 제목(【그림】)을 지우고, 원문 쪽은 파싱양식 마커·fence·표 구분선을 지운다.
 * 호·목 번호(1. 가.)는 CSS 카운터라 innerText 에 없다.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { normalizeLine, sourceToLines } from "../../../src/domain/assembly/compare";

export interface ArticleText {
  title: string;
  text: string;
}

const FIXTURES = path.join(process.cwd(), "tests/fixtures/terms");

/** 원문 파일 → 조별 (제목, 정규화 본문). */
export function expectedArticles(file: string): ArticleText[] {
  const lines = sourceToLines(readFileSync(path.join(FIXTURES, file), "utf8"));
  const out: ArticleText[] = [];
  for (const raw of lines) {
    const heading = /^##\s*제[^(]*\((.*)\)\s*$/.exec(raw);
    if (heading) {
      out.push({ title: heading[1].replace(/\s+/g, ""), text: "" });
      continue;
    }
    if (out.length === 0 || raw.startsWith("# ")) continue; // 조 앞의 줄 · 관 헤딩(DOM 에서는 조 밖의 h2)
    if (raw.startsWith("```") || /^\|(\s*-+\s*\|)+$/.test(raw) || raw === "제목: (없음)") continue;
    const body = raw
      .replace(/^제목:\s*/, "")
      .replace(/^설명:\s*/, "")
      .replace(/^(= |@ |\s{4}- |\s{2}- )/, "")
      .replace(/\|/g, "");
    out[out.length - 1].text += normalizeLine(body);
  }
  return out;
}

/** 미리보기 DOM 의 조 하나 → (제목, 정규화 본문). `heading` 은 h3 텍스트 「제N조(제목)」, `text` 는 조 요소 innerText. */
export function actualArticle(heading: string, text: string): ArticleText {
  const m = /^제[^(]*\((.*)\)\s*$/.exec(heading.trim());
  const title = (m ? m[1] : heading).replace(/\s+/g, "");
  const body = text
    .slice(text.indexOf(heading) + heading.length)
    .replace(/[①-⑳]/g, "")
    .replace(/【그림】/g, "");
  return { title, text: normalizeLine(body) };
}
