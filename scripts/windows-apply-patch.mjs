import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const targets = {
  "win32:x64": ["@openai/codex-win32-x64", "x86_64-pc-windows-msvc", "codex.exe"],
  "win32:arm64": ["@openai/codex-win32-arm64", "aarch64-pc-windows-msvc", "codex.exe"],
  "linux:x64": ["@openai/codex-linux-x64", "x86_64-unknown-linux-musl", "codex"],
  "linux:arm64": ["@openai/codex-linux-arm64", "aarch64-unknown-linux-musl", "codex"],
  "darwin:x64": ["@openai/codex-darwin-x64", "x86_64-apple-darwin", "codex"],
  "darwin:arm64": ["@openai/codex-darwin-arm64", "aarch64-apple-darwin", "codex"],
};

function findCodexExecutable() {
  const target = targets[`${process.platform}:${process.arch}`];
  if (!target) throw new Error(`Plateforme non supportee: ${process.platform}/${process.arch}`);
  const [packageName, triple, executableName] = target;
  const packageJson = require.resolve(`${packageName}/package.json`);
  const executable = path.join(realpathSync(path.dirname(packageJson)), "vendor", triple, "bin", executableName);
  if (!existsSync(executable)) throw new Error(`Executable Codex introuvable: ${executable}`);
  return executable;
}

const patch = process.env.SMART_CODEX_PATCH;
if (!patch) {
  console.error("SMART_CODEX_PATCH est vide. Utilise une here-string PowerShell litterale pour definir la variable.");
  process.exit(2);
}
if (Buffer.byteLength(patch, "utf8") > 2_000_000) {
  console.error("Patch refuse: taille superieure a 2 Mo.");
  process.exit(2);
}
const normalized = patch.replaceAll("\r\n", "\n").trimEnd();
if (!normalized.startsWith("*** Begin Patch\n") || !normalized.endsWith("\n*** End Patch")) {
  console.error("Patch invalide: marqueurs Begin Patch / End Patch absents ou mal places.");
  process.exit(2);
}

const result = spawnSync(findCodexExecutable(), ["--codex-run-as-apply-patch", `${normalized}\n`], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
  windowsHide: true,
});
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
