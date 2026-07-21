import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { GitChangeMetrics, ProjectFileChange } from "./types.js";

export type GitStatusSnapshot = Map<string, ProjectFileChange["kind"]>;
export type GitLineSnapshot = Map<string, { additions: number; deletions: number }>;

function execGit(root: string, args: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile("git", args, { cwd: root, encoding: "utf8", windowsHide: true }, (error, stdout) => resolve(error ? undefined : stdout));
  });
}

export function parseGitShortStatusZ(output: string): GitStatusSnapshot {
  const snapshot: GitStatusSnapshot = new Map();
  const entries = output.split("\0");
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry || entry.length < 4) continue;
    const code = entry.slice(0, 2);
    let filePath = entry.slice(3);
    if ((code.includes("R") || code.includes("C")) && entries[index + 1]) {
      index += 1;
    }
    const kind = code === "??" || code.includes("A")
      ? "add"
      : code.includes("D")
        ? "delete"
        : "update";
    snapshot.set(filePath, kind);
  }
  return snapshot;
}

export async function captureGitStatus(root: string): Promise<GitStatusSnapshot> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["status", "--short", "-z", "--untracked-files=all"],
      { cwd: root, encoding: "utf8", windowsHide: true },
      (error, stdout) => resolve(error ? new Map() : parseGitShortStatusZ(stdout)),
    );
  });
}

export async function captureGitHead(root: string): Promise<string | undefined> {
  return (await execGit(root, ["rev-parse", "HEAD"]))?.trim() || undefined;
}

export async function captureGitLineSnapshot(root: string): Promise<GitLineSnapshot> {
  const snapshot: GitLineSnapshot = new Map();
  const numstat = await execGit(root, ["diff", "--numstat", "HEAD", "--"]);
  for (const line of numstat?.split(/\r?\n/) ?? []) {
    const match = /^(\d+|-)\s+(\d+|-)\s+(.+)$/.exec(line);
    if (!match) continue;
    snapshot.set(match[3]!, { additions: match[1] === "-" ? 0 : Number(match[1]), deletions: match[2] === "-" ? 0 : Number(match[2]) });
  }

  const untracked = await execGit(root, ["ls-files", "--others", "--exclude-standard", "-z"]);
  for (const filePath of untracked?.split("\0").filter(Boolean) ?? []) {
    const absolute = path.join(root, filePath);
    const info = await stat(absolute).catch(() => undefined);
    if (!info?.isFile()) continue;
    const content = info.size <= 2_000_000 ? await readFile(absolute, "utf8").catch(() => "") : "";
    snapshot.set(filePath, { additions: content ? content.split(/\r?\n/).length : 0, deletions: 0 });
  }
  return snapshot;
}

export function lineMetricsSince(before: GitLineSnapshot, after: GitLineSnapshot): GitChangeMetrics {
  let filesModified = 0;
  let linesAdded = 0;
  let linesDeleted = 0;
  for (const [filePath, current] of after) {
    const previous = before.get(filePath) ?? { additions: 0, deletions: 0 };
    const added = Math.max(0, current.additions - previous.additions);
    const deleted = Math.max(0, current.deletions - previous.deletions);
    if (added > 0 || deleted > 0 || !before.has(filePath)) filesModified += 1;
    linesAdded += added;
    linesDeleted += deleted;
  }
  return { filesModified, linesAdded, linesDeleted };
}

export function changesSince(before: GitStatusSnapshot, after: GitStatusSnapshot): ProjectFileChange[] {
  const changes: ProjectFileChange[] = [];
  for (const [filePath, kind] of after) {
    if (before.get(filePath) !== kind) changes.push({ path: filePath, kind });
  }
  return changes;
}

export function mergeFileChanges(...groups: ProjectFileChange[][]): ProjectFileChange[] {
  const merged = new Map<string, ProjectFileChange["kind"]>();
  for (const group of groups) for (const change of group) merged.set(change.path, change.kind);
  return [...merged].map(([path, kind]) => ({ path, kind }));
}
