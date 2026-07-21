import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const defaultRoots = ["AGENTS.md", "README.md", ".editorconfig", ".gitattributes", "package.json", "src", "tests", "scripts", "fixtures"];
const roots = process.argv.length > 2 ? process.argv.slice(2) : defaultRoots;
const textExtensions = new Set([".ts", ".cts", ".mjs", ".js", ".json", ".md", ".html", ".css", ".txt"]);
const ignoredDirectories = new Set(["node_modules", "dist", ".git", ".e2e-work", ".smart-codex-runs"]);
const decoder = new TextDecoder("utf-8", { fatal: true });
const mojibake = new RegExp("\\u00c3.|\\u00c2.|\\u00e2[\\u20ac\\u2122\\u0153\\u201c\\u201d\\u2026\\u2013\\u2014]|\\ufffd", "u");
const failures = [];

async function collect(target) {
  const entries = await readdir(target, { withFileTypes: true }).catch(() => undefined);
  if (!entries) return [target];
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const child = path.join(target, entry.name);
    if (entry.isDirectory()) files.push(...await collect(child));
    else if (textExtensions.has(path.extname(entry.name).toLowerCase())) files.push(child);
  }
  return files;
}

for (const file of (await Promise.all(roots.map(collect))).flat()) {
  const buffer = await readFile(file);
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    failures.push(`${file}: BOM UTF-8 interdit`);
    continue;
  }
  try {
    const text = decoder.decode(buffer);
    if (mojibake.test(text)) failures.push(`${file}: séquence de mojibake détectée`);
    if (text.includes("\r\n")) failures.push(`${file}: fins de ligne CRLF détectées`);
  } catch {
    failures.push(`${file}: UTF-8 invalide`);
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("UTF-8 sans BOM et fins de ligne LF: OK");
