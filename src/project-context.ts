import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { ProjectContext } from "./types.js";

const DOC_NAMES = ["AGENTS.md", "README.md", "README.txt"];
const MANIFEST_NAMES = [
  "package.json",
  "pnpm-workspace.yaml",
  "pyproject.toml",
  "requirements.txt",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "composer.json",
  "Gemfile",
];
const MAX_DOCUMENT_CHARS = 12_000;
const MAX_SELECTED_CONTEXT_FILES = 10;
const MAX_SELECTED_CONTEXT_CHARS = 50_000;

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readTextSafely(filePath: string): Promise<string | undefined> {
  try {
    const content = await readFile(filePath, "utf8");
    return content.slice(0, MAX_DOCUMENT_CHARS);
  } catch {
    return undefined;
  }
}

async function collectParentAgentFiles(root: string): Promise<string[]> {
  const candidates: string[] = [];
  let current = root;

  while (true) {
    const candidate = path.join(current, "AGENTS.md");
    if (await exists(candidate)) candidates.unshift(candidate);

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return candidates;
}

function inferSignals(manifests: string[]): string[] {
  const signals = new Set<string>();
  for (const manifest of manifests) {
    const name = path.basename(manifest).toLowerCase();
    if (name === "package.json" || name === "pnpm-workspace.yaml") signals.add("node");
    if (name === "pyproject.toml" || name === "requirements.txt") signals.add("python");
    if (name === "cargo.toml") signals.add("rust");
    if (name === "go.mod") signals.add("go");
    if (name.includes("gradle") || name === "pom.xml") signals.add("jvm");
  }
  return [...signals];
}

export async function loadProjectContext(projectPath: string): Promise<ProjectContext> {
  const root = path.resolve(projectPath);
  const info = await stat(root).catch(() => undefined);
  if (!info?.isDirectory()) {
    throw new Error(`Le dossier projet n'existe pas: ${root}`);
  }

  const entries = await readdir(root, { withFileTypes: true });
  const rootFiles = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
  const manifests = MANIFEST_NAMES.filter((name) => rootFiles.has(name)).map((name) => path.join(root, name));

  for (const entry of entries) {
    if (entry.isFile() && (/\.sln$/i.test(entry.name) || /\.(cs|fs|vb)proj$/i.test(entry.name))) {
      manifests.push(path.join(root, entry.name));
    }
  }

  const docPaths = new Set(await collectParentAgentFiles(root));
  for (const name of DOC_NAMES) {
    const candidate = path.join(root, name);
    if (rootFiles.has(name)) docPaths.add(candidate);
  }
  for (const manifest of manifests) docPaths.add(manifest);

  const docs: ProjectContext["docs"] = [];
  for (const docPath of docPaths) {
    if (/\.env(?:\.|$)/i.test(path.basename(docPath))) continue;
    const content = await readTextSafely(docPath);
    if (content !== undefined) docs.push({ path: docPath, content });
  }

  const signals = inferSignals(manifests);
  if (await exists(path.join(root, ".git"))) signals.push("git");
  if (await exists(path.join(root, "pnpm-workspace.yaml"))) signals.push("monorepo");

  return { root, docs, manifests, signals };
}

export async function addSelectedContextFiles(context: ProjectContext, selectedPaths: string[]): Promise<ProjectContext> {
  const rootPrefix = context.root.endsWith(path.sep) ? context.root : context.root + path.sep;
  const uniquePaths = [...new Set(selectedPaths.map((selectedPath) => path.resolve(selectedPath)))];
  if (uniquePaths.length > MAX_SELECTED_CONTEXT_FILES) throw new Error(`Tu peux ajouter au maximum ${MAX_SELECTED_CONTEXT_FILES} fichiers de contexte.`);

  const selectedDocs: ProjectContext["docs"] = [];
  for (const selectedPath of uniquePaths) {
    if (selectedPath !== context.root && !selectedPath.toLowerCase().startsWith(rootPrefix.toLowerCase())) throw new Error("Les fichiers de contexte doivent appartenir au projet actif.");
    if (/\.env(?:\.|$)/i.test(path.basename(selectedPath))) throw new Error("Les fichiers .env ne peuvent pas être utilisés comme contexte.");
    const info = await stat(selectedPath).catch(() => undefined);
    if (!info?.isFile()) throw new Error("Un fichier de contexte sélectionné est introuvable.");
    const content = await readFile(selectedPath, "utf8").catch(() => undefined);
    if (content === undefined) throw new Error("Un fichier de contexte n'est pas lisible comme texte UTF-8.");
    selectedDocs.push({ path: selectedPath, content: content.slice(0, MAX_SELECTED_CONTEXT_CHARS) });
  }

  const selectedSet = new Set(selectedDocs.map((doc) => doc.path.toLowerCase()));
  return { ...context, docs: [...context.docs.filter((doc) => !selectedSet.has(doc.path.toLowerCase())), ...selectedDocs] };
}
