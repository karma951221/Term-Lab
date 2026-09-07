/**
 * 증거 수집기 — 브라우저 콘솔·페이지 예외·서버 액션 POST·요청 실패를 한 타임라인에 모은다.
 *
 * 액션 경계(`action`)가 그 타임라인 위에 눈금을 찍는다. 실패하면 리포터가 그 눈금의
 * 시각 구간으로 dev 서버 로그를 잘라 진단서에 붙인다 — 그래야 「몇 번째 조작에서 무엇이
 * 터졌나」가 읽힌다. 근거: docs/superpowers/specs/2026-09-08-e2e-관측복구-design.md §3.2
 */
import { test, type Page } from "@playwright/test";

import type { EvidenceDump, EvidenceEntry, FailedAction } from "../../../scripts/e2e/evidence-types";

/**
 * 에러 메시지에서 기다리던 대상을 뽑는다 — 진단서 첫 화면에 보여줄 한 줄.
 * Playwright 는 `Locator: …` 줄에 전체 체인을 준다. 그게 없을 때만 본문에서 긁는다.
 */
const LOCATOR_LINE = /^\s*Locator:\s*(.+)$/m;
const LOCATOR_ANY = /((?:getBy\w+|locator|frameLocator)\([^\n]*)/;

export class Evidence {
  private readonly entries: EvidenceEntry[] = [];
  private failed: FailedAction | null = null;
  private locator: string | null = null;
  private screenshot: Buffer | null = null;

  constructor(
    private readonly page: Page,
    readonly coordinate: string | null,
  ) {
    page.on("console", (message) => {
      // info·debug 까지 담으면 노이즈가 증거를 덮는다.
      if (message.type() !== "warning" && message.type() !== "error") return;
      this.push("console", `[${message.type()}] ${message.text()}`);
    });
    page.on("pageerror", (error) => this.push("pageerror", error.message));
    page.on("requestfailed", (request) => {
      this.push("requestfailed", `${request.method()} ${this.short(request.url())} — ${request.failure()?.errorText ?? "실패"}`);
    });
    page.on("response", (response) => {
      const request = response.request();
      const isServerAction = request.method() === "POST" || (response.headers()["content-type"] ?? "").includes("text/x-component");
      if (!isServerAction) return;
      let took = "";
      try {
        const timing = request.timing();
        if (timing.responseEnd > 0) took = ` (${Math.round(timing.responseEnd)}ms)`;
      } catch {
        // 타이밍을 못 얻는 응답도 있다 — 상태와 URL 만으로 충분하다.
      }
      this.push("response", `${request.method()} ${this.short(response.url())} → ${response.status()}${took}`);
    });
  }

  private push(kind: EvidenceEntry["kind"], text: string, extra: Partial<EvidenceEntry> = {}): void {
    this.entries.push({ at: new Date().toISOString(), kind, text, ...extra });
  }

  /** 오리진을 떼고 경로만 — 진단서 폭을 아낀다. */
  private short(url: string): string {
    try {
      const parsed = new URL(url);
      return `${parsed.pathname}${parsed.search}`;
    } catch {
      return url;
    }
  }

  /**
   * 사람이 시나리오 문서에 쓴 흐름 한 단계 = 액션 하나.
   * `coordinate` 는 `문면작성#1.2` 처럼 시나리오 좌표에 단계 번호를 붙인 것.
   */
  async action<T>(coordinate: string, name: string, body: () => Promise<T>): Promise<T> {
    try {
      // 실패했을 때만 보존한다 — 매 액션마다 파일로 쓰면 느리고 시끄럽다.
      this.screenshot = await this.page.screenshot();
    } catch {
      // 내비게이션 중이면 못 찍는다. 증거가 하나 없을 뿐 진행을 막지 않는다.
    }
    const startedAt = new Date().toISOString();
    this.push("action-start", name, { coordinate });
    const started = Date.now();
    try {
      const result = await test.step(`${coordinate} ${name}`, body);
      this.push("action-end", name, { coordinate, ok: true, durationMs: Date.now() - started });
      return result;
    } catch (error) {
      const endedAt = new Date().toISOString();
      this.push("action-end", name, { coordinate, ok: false, durationMs: Date.now() - started });
      this.failed = { coordinate, name, startedAt, endedAt };
      const message = error instanceof Error ? error.message : String(error);
      this.locator = (LOCATOR_LINE.exec(message)?.[1] ?? LOCATOR_ANY.exec(message)?.[1] ?? null)?.trim() ?? null;
      throw error;
    }
  }

  lastScreenshot(): Buffer | null {
    return this.screenshot;
  }

  dump(): EvidenceDump {
    return {
      coordinate: this.coordinate,
      entries: [...this.entries].sort((a, b) => a.at.localeCompare(b.at)),
      failedAction: this.failed,
      lastLocator: this.locator,
    };
  }
}
