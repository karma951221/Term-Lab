import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { goldenKey } from "./golden";
import { FAST_MARKER, GOLDEN_KEY_FILE, RUN_DIR } from "./paths";

const root = process.cwd();
const dataDir = path.join(root, ".data");
const key = goldenKey(root, ["drizzle", "src/db/schema", "src/db/seed"]);
const goldenDir = path.join(dataDir, `e2e-golden-${key}`);
const temporaryDir = `${goldenDir}.tmp`;

fs.mkdirSync(dataDir, { recursive: true });

const previousKey = fs.existsSync(GOLDEN_KEY_FILE) ? fs.readFileSync(GOLDEN_KEY_FILE, "utf8").trim() : "";
if (process.env.E2E_FAST === "1" && previousKey === key && fs.existsSync(RUN_DIR)) {
  fs.writeFileSync(FAST_MARKER, "1\n");
  console.log(`[e2e] fast DB 재사용 — golden=${key}`);
  process.exit(0);
}

fs.rmSync(FAST_MARKER, { force: true });

if (!fs.existsSync(goldenDir)) {
  fs.rmSync(temporaryDir, { recursive: true, force: true });
  console.log(`[e2e] golden 생성 — ${key}`);
  const seeded = spawnSync("npx", ["tsx", "src/db/seed/index.ts"], {
    cwd: root,
    env: { ...process.env, PGLITE_DATA_DIR: temporaryDir, DB_DRIVER: "pglite" },
    stdio: "inherit",
  });
  if (seeded.error) throw seeded.error;
  if (seeded.status !== 0) {
    fs.rmSync(temporaryDir, { recursive: true, force: true });
    process.exit(seeded.status ?? 1);
  }
  fs.renameSync(temporaryDir, goldenDir);
} else {
  console.log(`[e2e] golden 있음 — ${key}`);
}

fs.rmSync(RUN_DIR, { recursive: true, force: true });
fs.cpSync(goldenDir, RUN_DIR, { recursive: true });
fs.writeFileSync(GOLDEN_KEY_FILE, `${key}\n`);
console.log(`[e2e] 실행 DB 준비 완료 — golden=${key}`);
