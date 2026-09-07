/**
 * 커버리지 표 — 시나리오 문서 ↔ E2E 역방향 대조. `npm run e2e:coverage`.
 *
 * `playwright test --list --reporter=json` 이 각 테스트의 annotation 을 그대로 준다
 * (1.62.1 에서 `spec.tests[].annotations` 로 확인). 소스를 정규식으로 긁지 않는다.
 *
 * 커버리지는 **시나리오 단위**다. 흐름 단계 단위는 실행해 봐야 알 수 있어서 정적 표에 못 넣는다 —
 * 단계 수는 규모를 가늠하는 정보 열로만 낸다.
 * 하한선 검사는 두지 않는다 (설계 §6) — 숫자를 채우려는 압력이 얕은 테스트를 만든다. 항상 exit 0.
 */
import { execFileSync } from "node:child_process";

import { loadScenarios, type ScenarioIndex } from "./scenarios";

export interface TaggedTest {
  title: string;
  /** `시나리오` annotation 의 좌표. */
  coordinate: string | null;
  /** `좌표없음` annotation 의 사유. */
  excuse: string | null;
}

interface ListedSuite {
  specs?: { title: string; tests?: { annotations?: { type: string; description?: string }[] }[] }[];
  suites?: ListedSuite[];
}

/** `--list --reporter=json` 출력에서 테스트와 annotation 을 훑는다. */
export function collectTests(listed: { suites?: ListedSuite[] }): TaggedTest[] {
  const out: TaggedTest[] = [];
  const visit = (suite: ListedSuite) => {
    for (const spec of suite.specs ?? []) {
      const annotations = spec.tests?.flatMap((t) => t.annotations ?? []) ?? [];
      out.push({
        title: spec.title,
        coordinate: annotations.find((a) => a.type === "시나리오")?.description ?? null,
        excuse: annotations.find((a) => a.type === "좌표없음")?.description ?? null,
      });
    }
    for (const sub of suite.suites ?? []) visit(sub);
  };
  for (const suite of listed.suites ?? []) visit(suite);
  return out;
}

export function renderCoverage(index: ScenarioIndex, tests: TaggedTest[]): string {
  const covered = new Set(tests.map((t) => t.coordinate).filter((c): c is string => c !== null));
  const slugs = [...new Set(index.scenarios.map((s) => s.slug))];

  const rows = slugs.map((slug) => {
    const mine = index.scenarios.filter((s) => s.slug === slug);
    const hit = mine.filter((s) => covered.has(s.coordinate));
    const miss = mine.filter((s) => !covered.has(s.coordinate));
    return {
      slug,
      count: mine.length,
      steps: mine.reduce((sum, s) => sum + s.steps.length, 0),
      hit: hit.map((s) => `#${s.number}`).join(" ") || "—",
      miss: miss.length === mine.length ? "전부" : miss.map((s) => `#${s.number}`).join(" ") || "—",
    };
  });

  // 한글·한자는 터미널에서 두 칸을 차지한다 — 코드포인트 수로 맞추면 열이 어긋난다.
  const displayWidth = (text: string) =>
    [...text].reduce((sum, ch) => sum + (/[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(ch) ? 2 : 1), 0);
  const width = Math.max(14, ...rows.map((r) => displayWidth(r.slug) + 2));
  const pad = (text: string, n: number) => text + " ".repeat(Math.max(1, n - displayWidth(text)));

  const lines = [
    `${pad("문서", width)}${pad("시나리오", 10)}${pad("흐름단계", 10)}${pad("E2E", 14)}미커버`,
    ...rows.map((r) => `${pad(r.slug, width)}${pad(String(r.count), 10)}${pad(String(r.steps), 10)}${pad(r.hit, 14)}${r.miss}`),
  ];

  const total = index.scenarios.length;
  const percent = total === 0 ? 0 : Math.round((covered.size / total) * 100);
  lines.push("", `${pad("합계", width)}${pad(String(total), 10)}${pad(String(rows.reduce((s, r) => s + r.steps, 0)), 10)}${covered.size} (${percent}%)`);

  const excused = tests.filter((t) => t.excuse !== null);
  if (excused.length > 0) {
    lines.push("", `좌표없음 테스트 ${excused.length}건:`);
    for (const t of excused) lines.push(`  · ${t.title} — ${t.excuse}`);
  }

  const untagged = tests.filter((t) => t.coordinate === null && t.excuse === null);
  if (untagged.length > 0) {
    lines.push("", `⚠ 태그 없는 테스트 ${untagged.length}건 (실행하면 리포터가 실패시킨다):`);
    for (const t of untagged) lines.push(`  · ${t.title}`);
  }

  const unknown = tests.filter((t) => t.coordinate !== null && !index.scenarios.some((s) => s.coordinate === t.coordinate));
  if (unknown.length > 0) {
    lines.push("", `⚠ 문서에 없는 좌표 ${unknown.length}건 (오타 의심):`);
    for (const t of unknown) lines.push(`  · ${t.coordinate} — ${t.title}`);
  }

  lines.push("", `형식 불일치 ${index.malformed.length}건`);
  for (const m of index.malformed) lines.push(`  · ${m.file} 시나리오 ${m.number} — 빠진 라벨: ${m.missing.join(", ")}`);

  return lines.join("\n");
}

function main(): void {
  const raw = execFileSync("npx", ["playwright", "test", "--list", "--reporter=json"], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  console.log(renderCoverage(loadScenarios(), collectTests(JSON.parse(raw))));
}

// tsx 로 직접 실행할 때만 돈다 — 테스트가 import 해도 부수효과가 없어야 한다.
if (process.argv[1]?.endsWith("coverage.ts")) main();
