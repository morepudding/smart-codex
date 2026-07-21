import { execFile } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { CitedProjectFile, ProjectContext, RoutingBrief } from "./types.js";

const IGNORED_DIRECTORIES = new Set([".git", ".next", ".smart-codex-runs", "coverage", "dist", "logs", "node_modules", "out", "target"]);
const SENSITIVE_PATH = /(^|[\\/])(\.env(?:\.|$)|.*(?:credential|secret|token|private[-_. ]?key).*)/i;
const SENSITIVE_LINE = /\b(production|deploiement|deploy|secret|credential|token|base de donnees|database|migration|suppression|delete|generated|genere|partage reseau|network share|ne jamais|interdit|obligatoire|danger)\b/i;
const TEST_COMMAND = /^\s*(?:npm(?:\.cmd)?|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|lint|typecheck|type-check|build|check|validate|smoke|e2e)\b|^\s*(?:pytest|cargo\s+test|go\s+test|dotnet\s+test|mvn\s+test|gradle\s+test|python(?:\.exe)?\s+-m\s+(?:pytest|unittest))\b/i;

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function compactText(content: string, maximum = 1_800): string {
  const lines = unique(content.replace(/^\uFEFF/, "").split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !/^```/.test(line)));
  let result = "";
  for (const line of lines) {
    const next = result ? `${result}\n${line}` : line;
    if (next.length > maximum) break;
    result = next;
  }
  return result || "Non documente.";
}

function documentsNamed(context: ProjectContext, pattern: RegExp): ProjectContext["docs"] {
  return context.docs.filter((document) => pattern.test(path.basename(document.path)));
}

async function collectStructure(root: string): Promise<string[]> {
  const result: string[] = [];
  const entries = (await readdir(root, { withFileTypes: true })).filter((entry) => !IGNORED_DIRECTORIES.has(entry.name)).sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries.slice(0, 40)) {
    result.push(entry.isDirectory() ? `${entry.name}/` : entry.name);
    if (!entry.isDirectory() || result.length >= 60) continue;
    const children = await readdir(path.join(root, entry.name), { withFileTypes: true }).catch(() => []);
    for (const child of children.filter((candidate) => !IGNORED_DIRECTORIES.has(candidate.name)).sort((left, right) => left.name.localeCompare(right.name)).slice(0, 8)) {
      result.push(`${entry.name}/${child.name}${child.isDirectory() ? "/" : ""}`);
    }
  }
  return result.slice(0, 60);
}

function collectStack(context: ProjectContext): string[] {
  const stack = [...context.signals];
  for (const document of context.docs) {
    if (path.basename(document.path).toLowerCase() !== "package.json") continue;
    try {
      const manifest = JSON.parse(document.content) as { packageManager?: unknown; dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> };
      if (typeof manifest.packageManager === "string") stack.push(manifest.packageManager);
      const packages = { ...manifest.dependencies, ...manifest.devDependencies };
      for (const name of ["next", "react", "vue", "@angular/core", "electron", "typescript", "vite", "vitest", "jest"]) {
        if (name in packages) stack.push(name);
      }
    } catch {
      stack.push("package.json non parse");
    }
  }
  return unique(stack);
}

function collectSensitiveAreas(context: ProjectContext): string[] {
  const lines: string[] = [];
  for (const document of context.docs) {
    for (const line of document.content.split(/\r?\n/)) {
      const compact = line.trim();
      if (compact && compact.length <= 300 && SENSITIVE_LINE.test(compact)) lines.push(`${path.basename(document.path)}: ${compact}`);
    }
  }
  return unique(lines).slice(0, 16);
}

function collectTestCommands(context: ProjectContext): string[] {
  const commands: string[] = [];
  for (const document of context.docs) {
    if (path.basename(document.path).toLowerCase() === "package.json") {
      try {
        const manifest = JSON.parse(document.content) as { scripts?: Record<string, unknown> };
        for (const [name] of Object.entries(manifest.scripts ?? {})) {
          if (/^(test|lint|typecheck|type-check|build|check|validate|smoke|e2e)/i.test(name)) commands.push(`npm.cmd run ${name}`);
        }
      } catch {
        // Les commandes documentees restent disponibles ci-dessous.
      }
    }
    for (const line of document.content.split(/\r?\n/)) if (TEST_COMMAND.test(line)) commands.push(line.trim());
  }
  return unique(commands).slice(0, 20);
}

async function collectGitStatus(root: string, hasGit: boolean): Promise<string[]> {
  if (!hasGit) return ["Projet sans depot Git detecte."];
  return new Promise((resolve) => {
    execFile("git", ["status", "--short", "--branch", "--untracked-files=normal"], { cwd: root, encoding: "utf8", windowsHide: true }, (error, stdout) => {
      if (error) resolve(["Etat Git indisponible."]);
      else resolve(stdout.split(/\r?\n/).filter(Boolean).slice(0, 80));
    });
  });
}

function citedPathCandidates(request: string): string[] {
  const matches = request.match(/(?:[A-Za-z]:[\\/])?(?:[\w.@()-]+[\\/])+[\w.@()-]+\.[A-Za-z0-9]{1,12}/g) ?? [];
  const quoted = [...request.matchAll(/[`'"]([^`'"]+[\\/][^`'"]+\.[A-Za-z0-9]{1,12})[`'"]/g)].map((match) => match[1] ?? "");
  return unique([...matches, ...quoted].map((candidate) => candidate.trim().replace(/^[`'"(]+|[`'"),.;:]+$/g, "")));
}

async function collectCitedFiles(request: string, root: string): Promise<CitedProjectFile[]> {
  const rootPrefix = `${path.resolve(root).toLowerCase()}${path.sep}`;
  const files: CitedProjectFile[] = [];
  for (const candidate of citedPathCandidates(request).slice(0, 10)) {
    const resolved = path.resolve(root, candidate);
    const normalized = resolved.toLowerCase();
    if ((normalized !== path.resolve(root).toLowerCase() && !normalized.startsWith(rootPrefix)) || SENSITIVE_PATH.test(resolved)) continue;
    const info = await stat(resolved).catch(() => undefined);
    const exists = Boolean(info?.isFile());
    if (!exists) {
      files.push({ path: candidate, exists: false });
      continue;
    }
    const content = await readFile(resolved, "utf8").catch(() => undefined);
    files.push({ path: path.relative(root, resolved), exists: true, ...(content === undefined ? {} : { summary: compactText(content, 800) }) });
  }
  return files;
}

export async function buildRoutingBrief(request: string, context: ProjectContext): Promise<RoutingBrief> {
  const agents = documentsNamed(context, /^AGENTS\.md$/i);
  const readmes = documentsNamed(context, /^README(?:\.md|\.txt)?$/i);
  const agentsSummary = compactText([...agents].reverse().map((document) => path.basename(document.path) + ": " + compactText(document.content, 700)).join("\n"), 1_600);
  const readmeSummary = compactText(readmes.map((document) => path.basename(document.path) + ": " + compactText(document.content, 700)).join("\n"), 1_600);
  return {
    request,
    projectRoot: context.root,
    agentsSummary,
    readmeSummary,
    documentationSummary: compactText(agentsSummary + "\n" + readmeSummary, 2_800),
    stack: collectStack(context),
    structure: await collectStructure(context.root),
    sensitiveAreas: collectSensitiveAreas(context),
    gitStatus: await collectGitStatus(context.root, context.signals.includes("git")),
    testCommands: collectTestCommands(context),
    citedFiles: await collectCitedFiles(request, context.root),
  };
}
