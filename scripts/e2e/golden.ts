import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

function filesIn(root: string, source: string): string[] {
  const absolute = path.join(root, source);
  try {
    if (statSync(absolute).isFile()) return [absolute];
  } catch {
    return [];
  }

  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(entryPath);
      else if (entry.isFile()) files.push(entryPath);
    }
  };
  visit(absolute);
  return files;
}

/** DB golden 스냅샷을 결정하는 소스 트리의 짧은 내용 해시. */
export function goldenKey(root: string, sources: string[]): string {
  const hash = createHash("sha256");
  const files = sources
    .flatMap((source) => filesIn(root, source))
    .sort((left, right) => path.relative(root, left).localeCompare(path.relative(root, right), "en"));

  for (const file of files) {
    hash.update(path.relative(root, file));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 8);
}
