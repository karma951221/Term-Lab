import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { goldenKey } from "./golden";

function sourceTree(): string {
  const root = mkdtempSync(path.join(tmpdir(), "terms-studio-golden-"));
  mkdirSync(path.join(root, "drizzle"), { recursive: true });
  mkdirSync(path.join(root, "src/db/schema"), { recursive: true });
  writeFileSync(path.join(root, "drizzle", "0001.sql"), "select 1;\n");
  writeFileSync(path.join(root, "src/db/schema", "index.ts"), "export {};\n");
  return root;
}

const sources = ["drizzle", "src/db/schema", "src/db/seed"];

describe("goldenKey", () => {
  test("같은 소스 트리는 같은 키다", () => {
    const first = sourceTree();
    const second = sourceTree();

    expect(goldenKey(first, sources)).toBe(goldenKey(second, sources));
    expect(goldenKey(first, sources)).toMatch(/^[a-f0-9]{8}$/);
  });

  test("파일 한 바이트가 바뀌면 키가 바뀐다", () => {
    const root = sourceTree();
    const before = goldenKey(root, sources);

    writeFileSync(path.join(root, "drizzle", "0001.sql"), "select 2;\n");

    expect(goldenKey(root, sources)).not.toBe(before);
  });

  test("파일이 추가되면 키가 바뀐다", () => {
    const root = sourceTree();
    const before = goldenKey(root, sources);

    mkdirSync(path.join(root, "src/db/seed"), { recursive: true });
    writeFileSync(path.join(root, "src/db/seed", "extra.ts"), "export const extra = true;\n");

    expect(goldenKey(root, sources)).not.toBe(before);
  });
});
