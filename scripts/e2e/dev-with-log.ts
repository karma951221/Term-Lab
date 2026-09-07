/**
 * `next dev` 래퍼 — stdout/stderr 를 부모에게 그대로 흘리면서,
 * 줄마다 ISO 타임스탬프를 붙여 `.data/e2e-server.log` 에도 남긴다.
 *
 * 이게 없으면 Playwright 의 `webServer` 가 dev 서버 출력을 삼켜서
 * 서버 액션 예외·Drizzle 에러가 실패 진단에 한 줄도 안 남는다.
 * 리포터가 실패한 액션의 시각 구간으로 이 파일을 잘라 쓴다.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { SERVER_LOG } from "./paths";

fs.mkdirSync(path.dirname(SERVER_LOG), { recursive: true });
fs.writeFileSync(SERVER_LOG, "");
const log = fs.createWriteStream(SERVER_LOG, { flags: "a" });

const child = spawn("npx", ["next", "dev", ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"],
});

/** chunk 경계가 줄 중간을 자르므로 미완성 줄은 버퍼에 남긴다. */
function tee(source: NodeJS.ReadableStream, sink: NodeJS.WriteStream): void {
  let rest = "";
  source.on("data", (chunk: Buffer) => {
    sink.write(chunk);
    rest += chunk.toString("utf8");
    const lines = rest.split("\n");
    rest = lines.pop() ?? "";
    for (const line of lines) log.write(`${new Date().toISOString()}\t${line}\n`);
  });
  source.on("end", () => {
    if (rest) log.write(`${new Date().toISOString()}\t${rest}\n`);
  });
}

tee(child.stdout, process.stdout);
tee(child.stderr, process.stderr);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code, signal) => {
  log.end();
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
