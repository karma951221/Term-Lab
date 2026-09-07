import path from "node:path";

const ROOT = process.cwd();

export const RUN_DIR = path.join(ROOT, ".data", "e2e-run");
export const SERVER_LOG = path.join(ROOT, ".data", "e2e-server.log");
export const GOLDEN_KEY_FILE = path.join(ROOT, ".data", "e2e-golden-key");
export const FAST_MARKER = path.join(ROOT, ".data", "e2e-fast");
export const FAILURES_DIR = path.join(ROOT, "test-results", "failures");
export const SCENARIO_DIR = path.join(ROOT, "docs", "05_QA", "시나리오");
