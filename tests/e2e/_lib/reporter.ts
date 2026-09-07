/**
 * 실패 진단서 리포터 — 실패 1건마다 `test-results/failures/<슬러그>/` 에 한 벌을 떨군다.
 *
 * FAILURE.md · timeline.json · server.log(실패 구간) · before.png · at-failure.png · trace.zip
 *
 * 좌표 검사도 여기서 한다. 모든 테스트는 `시나리오`(문서 좌표) 또는 `좌표없음`(사유) 중
 * 하나를 annotation 으로 가져야 하고, 없으면 실행 전체를 실패로 만든다 — 태그를 빠뜨리면
 * 커버리지 표가 조용히 거짓말을 하기 때문이다.
 * 근거: docs/superpowers/specs/2026-09-08-e2e-관측복구-design.md §3.4
 */
import fs from "node:fs";
import path from "node:path";

import type { FullResult, Reporter, TestCase, TestResult } from "@playwright/test/reporter";

import type { EvidenceDump } from "../../../scripts/e2e/evidence-types";
import { renderFailure, renderIndex, type IndexItem } from "../../../scripts/e2e/failure";
import { FAILURES_DIR, FAST_MARKER, GOLDEN_KEY_FILE, SERVER_LOG } from "../../../scripts/e2e/paths";
import { findScenario, loadScenarios, type ScenarioIndex } from "../../../scripts/e2e/scenarios";
import { sliceServerLog } from "../../../scripts/e2e/serverlog";

const EMPTY: EvidenceDump = { coordinate: null, entries: [], failedAction: null, lastLocator: null };

function read(file: string): string {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

/** 파일 이름으로 쓸 수 있게 — 좌표의 `#` 는 경로에서 다루기 성가시다. */
function slugify(text: string): string {
  return text.replace(/#/g, "-").replace(/[/\\:*?"<>|]/g, "_").replace(/\s+/g, "_").slice(0, 80);
}

export default class FailureReporter implements Reporter {
  private index: ScenarioIndex = { scenarios: [], malformed: [] };
  private goldenKey = "(모름)";
  private fastMode = false;
  private failures: IndexItem[] = [];
  private untagged: string[] = [];
  private unknownCoordinates: string[] = [];

  onBegin(): void {
    this.index = loadScenarios();
    this.goldenKey = read(GOLDEN_KEY_FILE).trim() || "(모름)";
    this.fastMode = fs.existsSync(FAST_MARKER);
    fs.rmSync(FAILURES_DIR, { recursive: true, force: true });
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const coordinate = test.annotations.find((a) => a.type === "시나리오")?.description ?? null;
    const excused = test.annotations.some((a) => a.type === "좌표없음");
    if (!coordinate && !excused) this.untagged.push(test.title);
    if (coordinate && !findScenario(this.index, coordinate)) this.unknownCoordinates.push(`${coordinate} (${test.title})`);

    if (result.status !== "failed" && result.status !== "timedOut") return;

    const dir = path.join(FAILURES_DIR, slugify(coordinate ?? test.title));
    fs.mkdirSync(dir, { recursive: true });

    const dump = this.dumpOf(result);
    const artifacts = this.copyArtifacts(result, dir);
    const window = dump.failedAction;
    const serverLines = window
      ? sliceServerLog(read(SERVER_LOG).split("\n"), window.startedAt, window.endedAt)
      : sliceServerLog(read(SERVER_LOG).split("\n"), new Date(result.startTime).toISOString(), new Date(result.startTime.getTime() + result.duration).toISOString());

    fs.writeFileSync(path.join(dir, "timeline.json"), JSON.stringify(dump, null, 2));
    if (serverLines.length > 0) fs.writeFileSync(path.join(dir, "server.log"), `${serverLines.join("\n")}\n`);

    fs.writeFileSync(
      path.join(dir, "FAILURE.md"),
      renderFailure({
        coordinate,
        testTitle: test.title,
        scenario: coordinate ? findScenario(this.index, coordinate) : null,
        dump,
        serverLines,
        errorText: result.error?.message ?? result.status,
        goldenKey: this.goldenKey,
        fastMode: this.fastMode,
        artifacts,
      }),
    );

    this.failures.push({ coordinate, title: test.title, dir: path.basename(dir) });
  }

  private dumpOf(result: TestResult): EvidenceDump {
    const attachment = result.attachments.find((a) => a.name === "evidence");
    const raw = attachment?.body?.toString("utf8") ?? (attachment?.path ? read(attachment.path) : "");
    if (!raw) return EMPTY;
    try {
      return JSON.parse(raw) as EvidenceDump;
    } catch {
      return EMPTY;
    }
  }

  /** 스크린샷·trace 를 진단서 옆으로 복사한다 — 한 디렉토리에 모여 있어야 읽기 쉽다. */
  private copyArtifacts(result: TestResult, dir: string): string[] {
    const saved: string[] = [];
    for (const attachment of result.attachments) {
      if (attachment.name === "evidence") continue;
      const name = attachment.name.includes(".") ? attachment.name : `${attachment.name}${path.extname(attachment.path ?? "")}`;
      const target = path.join(dir, name);
      try {
        if (attachment.body) fs.writeFileSync(target, attachment.body);
        else if (attachment.path) fs.copyFileSync(attachment.path, target);
        else continue;
        saved.push(name);
      } catch {
        // 증거 하나를 못 옮겨도 진단서는 나와야 한다.
      }
    }
    return saved;
  }

  // Playwright 는 onEnd 의 반환으로 실행 전체의 상태를 덮어쓸 수 있게 해준다 — Promise 여야 한다.
  async onEnd(result: FullResult): Promise<{ status?: FullResult["status"] } | void> {
    if (this.failures.length > 0) {
      fs.mkdirSync(FAILURES_DIR, { recursive: true });
      fs.writeFileSync(path.join(FAILURES_DIR, "INDEX.md"), renderIndex(this.failures));
      console.log(`\n[e2e] 실패 진단서 ${this.failures.length}건 → ${path.relative(process.cwd(), FAILURES_DIR)}/INDEX.md`);
    }

    const problems: string[] = [];
    if (this.untagged.length > 0) {
      problems.push(
        `좌표 없는 테스트 ${this.untagged.length}건 — 모든 test 는 { type: "시나리오", description: "<좌표>" } 또는 { type: "좌표없음", description: "<사유>" } 를 가져야 한다:\n` +
          this.untagged.map((t) => `    · ${t}`).join("\n"),
      );
    }
    if (this.unknownCoordinates.length > 0) {
      problems.push(`문서에 없는 좌표 ${this.unknownCoordinates.length}건 (오타 의심):\n` + this.unknownCoordinates.map((t) => `    · ${t}`).join("\n"));
    }

    if (problems.length === 0) return;
    console.error(`\n[e2e] 좌표 검사 실패\n  ${problems.join("\n  ")}\n`);
    return { status: result.status === "passed" ? "failed" : result.status };
  }
}
