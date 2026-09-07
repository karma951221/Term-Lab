/**
 * 시나리오 문서 파서 — `docs/05_QA/시나리오/*.md` 가 E2E 의 정본이다 (C2).
 *
 * 문서는 건드리지 않는다. 좌표는 파일명과 절 번호에서 만든다: `그룹핑별표#5`.
 * 흐름은 산문이라 **실행하지 않는다** — 실패 진단서에 그대로 인용할 뿐이다.
 * 근거: docs/superpowers/specs/2026-09-08-e2e-관측복구-design.md §3.3
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { SCENARIO_DIR } from "./paths";

export interface Scenario {
  /** `<파일슬러그>#<번호>` — 코드에서 annotation 으로 참조하는 값. */
  coordinate: string;
  slug: string;
  number: number;
  title: string;
  /** 저장소 상대경로. */
  file: string;
  /** 1-based — `## 시나리오 N — …` 줄. */
  line: number;
  premise: string;
  steps: string[];
  expected: string;
  edges: string[];
}

export interface Malformed {
  file: string;
  number: number;
  missing: string[];
}

export interface ScenarioIndex {
  scenarios: Scenario[];
  malformed: Malformed[];
}

/** 좌표 체계 밖 — 목차와 절차 문서. */
const EXCLUDED = new Set(["README.md", "실물재현_E2E_시나리오.md"]);

const LABELS = ["전제", "흐름", "기대 결과", "경계·오류"] as const;
type Label = (typeof LABELS)[number];

const HEADING = /^##\s*시나리오\s*(\d+)\s*[—–-]\s*(.+?)\s*$/;
const LABEL = /^\*\*(전제|흐름|기대 결과|경계·오류)\*\*\s*:?\s*(.*)$/;
const STEP = /^\s*(\d+)\.\s+(.*)$/;
const EDGE = /^\s*[-*]\s+(.*)$/;

export function slugOf(filename: string): string | null {
  if (EXCLUDED.has(filename) || !filename.endsWith(".md")) return null;
  const slug = filename.replace(/_(인수)?시나리오\.md$/, "");
  return slug === filename ? null : slug;
}

/** 여러 줄을 한 문단으로 — 줄바꿈은 공백 하나로 접는다. */
function fold(lines: string[]): string {
  return lines
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join(" ")
    .trim();
}

/** 라벨 하나의 몸통을 번호(또는 불릿) 항목 목록으로. 이어지는 줄은 앞 항목에 붙인다. */
function items(lines: string[], head: RegExp): string[] {
  const out: string[] = [];
  let buffer: string[] = [];
  const flush = () => {
    if (buffer.length > 0) out.push(fold(buffer));
    buffer = [];
  };
  for (const line of lines) {
    const match = head.exec(line);
    if (match) {
      flush();
      buffer = [match[match.length - 1]];
    } else if (line.trim() !== "" && buffer.length > 0) {
      buffer.push(line);
    }
  }
  flush();
  return out;
}

export function parseScenarioDoc(source: string, file: string, slug: string): ScenarioIndex {
  const lines = source.split("\n");
  const scenarios: Scenario[] = [];
  const malformed: Malformed[] = [];

  /** 시나리오 머리 줄의 인덱스들. */
  const heads: { index: number; number: number; title: string }[] = [];
  lines.forEach((line, index) => {
    const match = HEADING.exec(line);
    if (match) heads.push({ index, number: Number(match[1]), title: match[2] });
  });

  for (const [n, head] of heads.entries()) {
    // 몸통은 다음 `## ` 또는 파일 끝까지.
    let end = lines.length;
    for (let i = head.index + 1; i < lines.length; i++) {
      if (lines[i].startsWith("## ")) {
        end = i;
        break;
      }
    }
    if (n + 1 < heads.length) end = Math.min(end, heads[n + 1].index);

    const sections = new Map<Label, string[]>();
    let current: Label | null = null;
    for (const line of lines.slice(head.index + 1, end)) {
      const match = LABEL.exec(line);
      if (match) {
        current = match[1] as Label;
        sections.set(current, match[2].trim() === "" ? [] : [match[2]]);
      } else if (current) {
        sections.get(current)?.push(line);
      }
    }

    const missing = LABELS.filter((label) => !sections.has(label));
    if (missing.length > 0) {
      malformed.push({ file, number: head.number, missing });
      continue;
    }

    scenarios.push({
      coordinate: `${slug}#${head.number}`,
      slug,
      number: head.number,
      title: head.title,
      file,
      line: head.index + 1,
      premise: fold(sections.get("전제") ?? []),
      steps: items(sections.get("흐름") ?? [], STEP),
      expected: fold(sections.get("기대 결과") ?? []),
      edges: items(sections.get("경계·오류") ?? [], EDGE),
    });
  }

  return { scenarios, malformed };
}

export function loadScenarios(dir: string = SCENARIO_DIR): ScenarioIndex {
  const scenarios: Scenario[] = [];
  const malformed: Malformed[] = [];

  for (const filename of readdirSync(dir).sort((a, b) => a.localeCompare(b, "ko"))) {
    const slug = slugOf(filename);
    if (!slug) continue;
    const absolute = path.join(dir, filename);
    const file = path.relative(process.cwd(), absolute);
    const parsed = parseScenarioDoc(readFileSync(absolute, "utf8"), file, slug);
    scenarios.push(...parsed.scenarios);
    malformed.push(...parsed.malformed);
  }

  return { scenarios, malformed };
}

export function findScenario(index: ScenarioIndex, coordinate: string): Scenario | null {
  return index.scenarios.find((s) => s.coordinate === coordinate) ?? null;
}
