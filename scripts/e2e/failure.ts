/**
 * 실패 진단서 렌더 — 파일 IO 없이 문자열만 만든다.
 *
 * 에이전트는 이 한 장만 읽고 시작한다. 그래서 정본 인용·증거·재현 좌표에 더해
 * **판정 기준과 금지 목록을 문서 안에 함께 박는다** — 별도 규칙 파일을 읽지 않아도
 * 심판과 금지선이 눈앞에 있게 하려는 것이다.
 * 근거: docs/superpowers/specs/2026-09-08-e2e-관측복구-design.md §2.4 · §3.4
 */
import type { EvidenceDump } from "./evidence-types";
import type { Scenario } from "./scenarios";

export interface FailureInput {
  coordinate: string | null;
  testTitle: string;
  /** 좌표가 문서에 없으면 null. */
  scenario: Scenario | null;
  dump: EvidenceDump;
  /** 이미 실패 구간으로 잘린 dev 서버 로그. */
  serverLines: string[];
  errorText: string;
  goldenKey: string;
  fastMode: boolean;
  artifacts: string[];
}

export interface IndexItem {
  coordinate: string | null;
  title: string;
  dir: string;
}

/** 에이전트가 건드리면 안 되는 것 — 여기를 고쳐야 통과한다면 그건 ③이다. */
const FORBIDDEN = ["src/domain/**/__snapshots__/**", "tests/fixtures/terms/*.md", "docs/05_QA/시나리오/*.md"];

/** `문면작성#1.2` → 2. 흐름 단계 번호. */
function stepNumberOf(coordinate: string | null): number | null {
  const n = Number(/#\d+\.(\d+)/.exec(coordinate ?? "")?.[1]);
  return Number.isFinite(n) ? n : null;
}

function 정본절(input: FailureInput): string[] {
  const { scenario, dump } = input;
  if (!scenario) {
    return [
      "## 정본",
      "",
      "이 테스트에는 시나리오 좌표가 없다 (`좌표없음`). 대조할 문서가 없으므로,",
      "무엇이 맞는 동작인지는 코드와 커밋 이력에서 판단해야 한다.",
    ];
  }

  const failedStep = stepNumberOf(dump.failedAction?.coordinate ?? null);
  const steps = scenario.steps.map((step, i) => {
    const mark = failedStep === i + 1 ? "   ← 여기서 실패" : "";
    return `${i + 1}. ${step}${mark}`;
  });

  return [
    `## 정본  (${scenario.file}:${scenario.line})`,
    "",
    `**전제**: ${scenario.premise}`,
    "",
    "**흐름**:",
    ...steps,
    "",
    `**기대 결과**: ${scenario.expected}`,
    ...(scenario.edges.length > 0 ? ["", "**경계·오류**:", ...scenario.edges.map((e) => `- ${e}`)] : []),
  ];
}

function 타임라인절(input: FailureInput): string[] {
  const { dump } = input;
  const lines: string[] = [];

  for (const entry of dump.entries) {
    if (entry.kind !== "action-end") continue;
    const took = entry.durationMs === undefined ? "" : `  ${(entry.durationMs / 1000).toFixed(1)}s`;
    lines.push(`  ${entry.ok ? "✔" : "▶"} ${entry.coordinate ?? ""}  ${entry.text}${took}`);
    if (!entry.ok && dump.lastLocator) lines.push(`       대기: ${dump.lastLocator}`);
  }

  if (lines.length === 0) lines.push("  (액션 경계가 없다 — ev.action 으로 감싸면 어느 조작에서 죽었는지 보인다)");

  return ["## 무슨 일이 있었나", "", "```", ...lines, "", `  ✗ ${input.errorText.split("\n")[0]}`, "```"];
}

function 증거절(input: FailureInput): string[] {
  const { dump, serverLines } = input;
  const window = dump.failedAction;
  const inWindow = (at: string) =>
    !window || (at >= window.startedAt && at <= window.endedAt);

  const browser = dump.entries
    .filter((e) => e.kind !== "action-start" && e.kind !== "action-end" && inWindow(e.at))
    .map((e) => `  [${e.kind.padEnd(13)} ${e.at.slice(11, 23)}] ${e.text}`);

  const server = serverLines.map((line) => {
    const [at, ...rest] = line.split("\t");
    return rest.length === 0 ? `  ${at}` : `  [서버          ${at.slice(11, 23)}] ${rest.join("\t")}`;
  });

  const body = [...server, ...browser];
  return [
    "## 같은 구간의 증거",
    "",
    "```",
    ...(body.length > 0 ? body : ["  (수집된 증거 없음)"]),
    "```",
  ];
}

function 재현절(input: FailureInput): string[] {
  const target = input.coordinate ?? input.testTitle;
  return [
    "## 재현",
    "",
    ...(input.fastMode
      ? [
          "**⚠ E2E_FAST=1 로 실행됐다 — 결정론이 깨져 있다. 재현 전에 E2E_FAST 없이 다시 확인할 것.**",
          "",
        ]
      : []),
    "```bash",
    `# golden=${input.goldenKey}`,
    `npm run test:e2e -- --grep "${target}"`,
    "```",
    ...(input.artifacts.length > 0 ? ["", `증거 파일: ${input.artifacts.join(" · ")}`] : []),
  ];
}

function 판정절(input: FailureInput): string[] {
  const verdicts = [
    "  [ ] ① 테스트가 문서를 잘못 옮겼다   → 테스트 수정 (허용)",
    "  [ ] ② 코드가 문서를 어겼다         → 코드 수정 (허용, 금지목록 제외)",
    ...(input.scenario ? ["  [ ] ③ 문서가 낡았다               → 수정 금지. 멈추고 사람에게 보고"] : []),
  ];

  return [
    "## 판정 — 하나를 고르고 위 「정본」의 문장을 인용할 것",
    "",
    "```",
    ...verdicts,
    "",
    `  금지: ${FORBIDDEN.join("  ·  ")}`,
    "  근거 인용이 없으면 수정 금지. 금지목록을 건드려야 통과한다면 그건 ③이다.",
    "```",
    "",
    "절차: [[05_QA/E2E_복구절차]]",
  ];
}

export function renderFailure(input: FailureInput): string {
  const heading = input.coordinate
    ? `# 실패: ${input.coordinate} — ${input.scenario?.title ?? input.testTitle}`
    : `# 실패: ${input.testTitle}`;

  return [
    heading,
    "",
    ...정본절(input),
    "",
    ...타임라인절(input),
    "",
    ...증거절(input),
    "",
    ...재현절(input),
    "",
    ...판정절(input),
    "",
  ].join("\n");
}

export function renderIndex(items: IndexItem[]): string {
  return [
    `# 실패 ${items.length}건`,
    "",
    "각 진단서를 읽고 ①②③ 을 판정한다. ③ 이면 고치지 말고 멈춘다.",
    "",
    ...items.map((item) => `- **${item.coordinate ?? "(좌표없음)"}** ${item.title} — [\`${item.dir}/FAILURE.md\`](${item.dir}/FAILURE.md)`),
    "",
  ].join("\n");
}
