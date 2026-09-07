/**
 * 파싱양식(`docs/_자료/파싱양식.md`) `.md` → 구조 (개발 도구 — 제품 기능 아님).
 *
 *   # 제N관 제목       관          ## 제N조(제목) · ## 제N조의M(제목)   조
 *   = 본문             단항 조의 본문   @ 본문                              항
 *     - 본문           호              - 본문 (스페이스 4)                목
 *   ```표 … ```        정적 표         ```용어풀이 … ```                  박스     ```그림 … ```  박스(제목 「그림」)
 *
 * 마커 밖의 줄은 오류다 — 원문 파일이 양식을 어겼다는 뜻이므로 조용히 넘기지 않는다.
 */

export type Line =
  | { kind: "paragraph"; text: string; single?: boolean }
  | { kind: "item"; text: string }
  | { kind: "subitem"; text: string }
  | { kind: "table"; title?: string; rows: { header?: boolean; cells: string[] }[] }
  | { kind: "box"; title: string; lines: string[] };

export interface ParsedArticle {
  /** 원문 번호 — `"27"` · `"27의1"`. 변환 후에는 순번으로 다시 매겨진다 (ADR-0029). */
  number: string;
  title: string;
  body: Line[];
}

export interface ParsedSection {
  /** 관 없는 문서는 제목 `""` 인 관 하나. */
  title: string;
  articles: ParsedArticle[];
}

export interface ParsedDoc {
  title: string;
  sections: ParsedSection[];
}

interface Fence {
  kind: "table" | "box" | "figure";
  lines: string[];
}

function fenceToLine(f: Fence): Line {
  if (f.kind === "box") {
    const [head, ...rest] = f.lines;
    const t = /^【(.*)】$/.exec(head ?? "");
    return t ? { kind: "box", title: t[1], lines: rest } : { kind: "box", title: "", lines: f.lines };
  }
  if (f.kind === "figure") return { kind: "box", title: "그림", lines: f.lines.map((l) => l.replace(/^설명:\s*/, "")) };
  const titleLine = f.lines.find((l) => l.startsWith("제목:"));
  const title = titleLine ? titleLine.slice(3).trim() : "(없음)";
  const rows: { header?: boolean; cells: string[] }[] = [];
  for (const l of f.lines) {
    if (!l.startsWith("|")) continue;
    if (/^\|(\s*-+\s*\|)+$/.test(l)) {
      if (rows.length > 0) rows[rows.length - 1].header = true;
      continue;
    }
    const inner = l.endsWith("|") ? l.slice(1, -1) : l.slice(1);
    rows.push({ cells: inner.split("|").map((c) => c.trim()) });
  }
  return { kind: "table", ...(title !== "(없음)" ? { title } : {}), rows };
}

export function parseTerms(markdown: string): ParsedDoc {
  const doc: ParsedDoc = { title: "", sections: [] };
  let section: ParsedSection | undefined;
  let article: ParsedArticle | undefined;
  let fence: Fence | undefined;

  const ensureSection = (): ParsedSection => {
    if (!section) {
      section = { title: "", articles: [] };
      doc.sections.push(section);
    }
    return section;
  };
  const push = (l: Line): void => {
    if (!article) throw new Error(`조 밖의 본문: ${JSON.stringify(l)}`);
    article.body.push(l);
  };

  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.replace(/<!--.*?-->/g, "").replace(/\s+$/, "");
    if (fence) {
      if (line === "```") {
        push(fenceToLine(fence));
        fence = undefined;
      } else {
        fence.lines.push(line);
      }
      continue;
    }
    if (line === "") continue;
    if (line.startsWith("```표")) { fence = { kind: "table", lines: [] }; continue; }
    if (line.startsWith("```용어풀이")) { fence = { kind: "box", lines: [] }; continue; }
    if (line.startsWith("```그림")) { fence = { kind: "figure", lines: [] }; continue; }
    if (line.startsWith("> ")) continue;

    let m: RegExpExecArray | null;
    if ((m = /^# 제(\d+)관\s+(.*)$/.exec(line))) {
      section = { title: m[2].trim(), articles: [] };
      doc.sections.push(section);
      article = undefined;
      continue;
    }
    if (line.startsWith("# ")) {
      if (!doc.title) doc.title = line.slice(2).trim();
      continue;
    }
    if ((m = /^## 제(\d+)조(?:의(\d+))?\((.*)\)\s*$/.exec(line))) {
      article = { number: m[2] ? `${m[1]}의${m[2]}` : m[1], title: m[3].trim(), body: [] };
      ensureSection().articles.push(article);
      continue;
    }
    if ((m = /^= (.*)$/.exec(line))) { push({ kind: "paragraph", text: m[1].trim(), single: true }); continue; }
    if ((m = /^@ (.*)$/.exec(line))) { push({ kind: "paragraph", text: m[1].trim() }); continue; }
    if ((m = /^ {4}- (.*)$/.exec(line))) { push({ kind: "subitem", text: m[1].trim() }); continue; }
    if ((m = /^ {2}- (.*)$/.exec(line))) { push({ kind: "item", text: m[1].trim() }); continue; }
    throw new Error(`알 수 없는 줄: ${line}`);
  }
  if (fence) throw new Error("닫히지 않은 fenced 블록");
  return doc;
}
