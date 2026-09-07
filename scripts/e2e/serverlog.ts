/**
 * dev 서버 로그(`ISO\t본문`)를 액션의 시각 구간으로 자른다.
 *
 * 진단서에는 실패한 액션 동안 서버에서 벌어진 일만 붙인다 — 전체를 붙이면 증거가 노이즈에 묻힌다.
 * 타임스탬프가 없는 줄(스택트레이스 이어짐)은 앞 줄의 시각을 따른다.
 */

// ESC 문자를 소스에 직접 넣지 않으려고 이스케이프 시퀀스로 조립한다.
const ANSI = new RegExp("\u001B" + "\\[[0-9;]*m", "g");
const STAMPED = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\t/;

/** Next dev 로그는 색을 입고 나온다 — 진단서에는 벗겨서 붙인다. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI, "");
}

/** `from` 에서 `preRollMs` 만큼 앞선 시각부터 `to` 까지. */
export function sliceServerLog(lines: string[], from: string, to: string, preRollMs = 2000): string[] {
  const start = Date.parse(from) - preRollMs;
  const end = Date.parse(to);
  if (Number.isNaN(start) || Number.isNaN(end)) return [];

  const out: string[] = [];
  let inside = false;
  for (const raw of lines) {
    const line = stripAnsi(raw);
    const stamp = STAMPED.exec(line);
    if (stamp) {
      const at = Date.parse(stamp[1]);
      inside = !Number.isNaN(at) && at >= start && at <= end;
    }
    // 타임스탬프 없는 줄은 직전 줄의 판정을 그대로 따른다.
    if (inside) out.push(line);
  }
  return out;
}
