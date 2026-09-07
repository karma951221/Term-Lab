/**
 * 대조기 — 조립 결과(`RenderedDoc`)를 파싱양식 텍스트로 되돌려 원문 `.md` 와 조 단위로 비교한다.
 *
 * 기준 (2026-09-07 실물 재현 설계):
 * - 가지번호를 쓰지 않으므로(ADR-0029) 조·관 번호 참조는 조 명 기준으로 정규화한다 — 「제27조의1(」 도 「제28조(」 도 「제§조(」.
 * - PDF 추출 공백 잡음을 피하려 공백을 전부 지우고 비교한다. 별표 번호는 남긴다 (상품 별표 목록 순서 — ADR-0030).
 * - 단항 조는 `= `, 다항 조는 `@ `. 표·박스는 파싱양식의 fenced 블록 그대로.
 *
 * DB·React import 금지 (순수층). Node `fs` 도 쓰지 않는다 — 파일 읽기는 호출자 몫.
 */

import type { RenderedArticle, RenderedDoc, RenderedInline, RenderedParagraph, RenderedStatic } from "./types";

const inlineText = (list: readonly RenderedInline[]): string =>
  list.map((n) => (n.kind === "text" ? n.text : n.kind === "error" ? `⟦${n.issue.kind}⟧` : n.label)).join("");

function staticLines(n: RenderedStatic): string[] {
  if (n.kind === "box") return ["```용어풀이", `【${n.title}】`, ...n.lines, "```"];
  const separator = `|${n.columns.map(() => "---").join("|")}|`;
  const out = ["```표", `제목: ${n.title ?? "(없음)"}`];
  let separated = false;
  for (const row of n.rows) {
    out.push(`|${row.cells.join("|")}|`);
    if (row.header && !separated) {
      out.push(separator);
      separated = true;
    }
  }
  // 제목줄이 없는 표는 파싱양식(markdown)상 첫 행 뒤에 구분선이 온다
  if (!separated && n.rows.length > 0) out.splice(3, 0, separator);
  out.push("```");
  return out;
}

function articleLines(a: RenderedArticle): string[] {
  const out = [`## ${a.label}(${a.title})`];
  const paragraphs = a.children.filter((c): c is RenderedParagraph => c.kind === "paragraph");
  const marker = paragraphs.length === 1 ? "=" : "@";
  for (const c of a.children) {
    if (c.kind === "error") {
      out.push(`${marker} ⟦${c.issue.kind}⟧`);
      continue;
    }
    if (c.kind !== "paragraph") {
      out.push(...staticLines(c));
      continue;
    }
    out.push(`${marker} ${inlineText(c.children)}`);
    for (const it of c.items ?? []) {
      if (it.kind === "error") continue;
      if (it.kind !== "item") {
        out.push(...staticLines(it));
        continue;
      }
      out.push(`  - ${inlineText(it.children)}`);
      for (const s of it.subitems ?? []) if (s.kind === "subitem") out.push(`    - ${inlineText(s.children)}`);
    }
  }
  return out;
}

/** 조립 결과 문서 → 파싱양식 줄. */
export function renderedToLines(doc: RenderedDoc): string[] {
  const out: string[] = [];
  for (const c of doc.children) {
    if (c.kind === "error") continue;
    if (c.kind === "section") {
      out.push(`# ${c.label} ${c.title}`);
      for (const a of c.children) if (a.kind === "article") out.push(...articleLines(a));
    } else {
      out.push(...articleLines(c));
    }
  }
  return out;
}

/** 원문 `.md` → 비교용 줄. 문서 제목(`# …` 첫 줄, 관 헤딩 제외) · `> ` 머리/통계 · HTML 주석 · 빈 줄을 버린다. */
export function sourceToLines(markdown: string): string[] {
  return markdown
    .split(/\r?\n/)
    .map((l) => l.replace(/<!--.*?-->/g, "").replace(/\s+$/, ""))
    .filter((l) => l.trim() !== "" && !l.startsWith("> ") && !(l.startsWith("# ") && !/^# 제\d+관/.test(l)));
}

/** 조 번호 참조·관 번호를 지우고 공백을 전부 없앤다. */
export function normalizeLine(line: string): string {
  return line
    .replace(/제\d+조(?:의\d+)?\(/g, "제§조(")
    .replace(/제\d+관/g, "제§관")
    .replace(/\s+/g, "");
}

export interface ArticleDiff {
  /** 조 순번 (0부터). */
  index: number;
  title: string;
  expected: string[];
  actual: string[];
}

interface Chunk {
  title: string;
  lines: string[];
}

/** `## 제N조(제목)` 로 잘라 조 덩어리로. 조 앞의 관 헤딩은 직전 덩어리 끝에 붙는다 (양쪽 같은 규칙이라 대조에 무해). */
function chunks(lines: readonly string[]): Chunk[] {
  const out: Chunk[] = [];
  for (const l of lines) {
    const m = /^##\s*제[^(]*\((.*)\)\s*$/.exec(l);
    if (m) out.push({ title: m[1], lines: [] });
    else if (out.length === 0) out.push({ title: "(머리)", lines: [l] });
    else out[out.length - 1].lines.push(l);
  }
  return out;
}

const squash = (s: string) => s.replace(/\s+/g, "");

/** 정규화 후 조 단위 비교 — 다른 조만. */
export function diffByArticle(expected: readonly string[], actual: readonly string[]): ArticleDiff[] {
  const e = chunks(expected);
  const a = chunks(actual);
  const n = Math.max(e.length, a.length);
  const out: ArticleDiff[] = [];
  for (let i = 0; i < n; i++) {
    const x = e[i];
    const y = a[i];
    const same = x !== undefined && y !== undefined && squash(x.title) === squash(y.title) && x.lines.map(normalizeLine).join("\n") === y.lines.map(normalizeLine).join("\n");
    if (!same) out.push({ index: i, title: x?.title ?? y?.title ?? "", expected: x?.lines ?? [], actual: y?.lines ?? [] });
  }
  return out;
}
